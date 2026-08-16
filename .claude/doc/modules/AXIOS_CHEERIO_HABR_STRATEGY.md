# Axios + Cheerio / Habr Career Strategy

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/crawler/strategies/habrCareerStrategy.ts`](../../../apps/api/src/crawler/strategies/habrCareerStrategy.ts)
(тесты и фикстуры: [`habrCareerStrategy.test.ts`](../../../apps/api/src/crawler/strategies/habrCareerStrategy.test.ts),
[`__fixtures__/habrCareerListing.html`](../../../apps/api/src/crawler/strategies/__fixtures__/habrCareerListing.html))

Axios+Cheerio — связка для источников, где сервер сразу отдаёт готовый HTML (без выполнения
JS на странице). В отличие от [Puppeteer/RemoteOK](PUPPETEER_REMOTEOK_STRATEGY.md), здесь нет
браузера вообще: Axios просто скачивает HTML одним HTTP-запросом, а дальше используется тот же
Cheerio, что и в связке с Puppeteer — разница только в том, **чем получен** HTML, парсинг
одинаковый в обоих случаях.

## Зачем именно Axios+Cheerio (а не Puppeteer)

`career.habr.com` подтверждённо server-rendered — то есть весь нужный HTML (и листинг вакансий, и
страница отдельной вакансии) уже есть в ответе сервера, до какого-либо JS. Это проверено вручную
через `curl` (без браузера, без выполнения JS) — если бы контент дорисовывался JS-ом на клиенте,
`curl` вернул бы пустой каркас страницы. Раз JS не нужен для получения данных, поднимать headless
Chrome (как для RemoteOK) — лишний расход ресурсов и времени: Axios делает то же самое одним лёгким
HTTP-запросом вместо запуска целого браузерного процесса. Отсюда `CrawlSource.type: STATIC` для
этого источника (см. `CLAUDE.md`, таблица Data Sources).

## Два прохода: листинг + детальная страница

В отличие от RemoteOK (там один проход по листингу, все нужные поля уже есть в JSON-LD каждой
строки — см. [PUPPETEER_REMOTEOK_STRATEGY.md](PUPPETEER_REMOTEOK_STRATEGY.md)), у `habr_career`
краул устроен в **два прохода**, потому что на листинге нет описания вакансии, локации и
специализации — они есть только на странице конкретной вакансии:

1. **`crawl()`** — обходит страницы листинга `/vacancies`, собирает по каждой карточке только
   базовые поля (`externalId`, `title`, `company`, `url`, `postedAt`).
2. **`enrichDetails()`** — по каждой найденной на шаге 1 вакансии отдельно запрашивает её
   `url` (страницу самой вакансии) и достаёт оттуда `description`, `location`, `isRemote`,
   `skillsSummary`, `seniority`, `specialization` через её собственный JSON-LD-блок.

Это соответствует `CrawlStrategy.enrichDetails` — необязательному второму методу интерфейса
(см. [`types.ts#L39`](../../../apps/api/src/crawler/types.ts#L39)): у RemoteOK его нет вообще
(там всё уже на листинге), у `habr_career` — есть.

## Структура листинга

Каждая вакансия на `/vacancies` — блок `.vacancy-card`:

```html
<div class="vacancy-card">
  <a class="vacancy-card__title-link" href="/vacancies/1000123">Backend Developer</a>
  <div class="vacancy-card__company">
    <a href="/companies/acme">Acme</a>
  </div>
  <div class="vacancy-card__date">
    <time class="basic-date" datetime="2026-08-10T12:00:00+03:00">10 августа</time>
  </div>
</div>
```

Откуда берутся поля [`RawVacancy`](../../../apps/api/src/crawler/types.ts#L3) на этом шаге:

| Поле         | Источник в HTML                                                                 |
| ------------ | -------------------------------------------------------------------------------- |
| `externalId` | число из `href` ссылки `a[href^="/vacancies/"]` (регэксп `/\/vacancies\/(\d+)/`) |
| `title`      | текст `.vacancy-card__title-link`                                                |
| `company`    | текст `.vacancy-card__company a` (`null`, если блок компании отсутствует)        |
| `url`        | тот же `href`, превращённый в абсолютный через `new URL(href, source.baseUrl)`   |
| `postedAt`   | атрибут `datetime` у `.vacancy-card__date time.basic-date`                       |

На этом шаге ещё нет `description`/`location`/`skillsSummary` и т.п. — они появятся только после
`enrichDetails()`. Поэтому в `types.ts` эти поля помечены как опциональные
(`description?`, `location?`, ...) с комментарием "Detail-page fields below are only present once
a source's enrichDetails has run" — это буквально то, что здесь происходит.

## Структура детальной страницы (JSON-LD)

Страница конкретной вакансии несёт тот же `JobPosting` JSON-LD, что и RemoteOK, но здесь он
единственный источник данных (не boilerplate) — у habr в нём реальные `description`/`jobLocation`.
Упрощённый пример:

```html
<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    "description": "<p>Навыки: Python, Django. Квалификация: Middle. Специализации: Backend.</p>",
    "jobLocation": [{ "address": "Москва" }],
    "jobLocationType": "TELECOMMUTE"
  }
</script>
```

Особенность: страница может содержать **несколько** `<script type="application/ld+json">` блоков
подряд (например ещё `Organization`, `BreadcrumbList` для SEO/хлебных крошек) — не только тот, что
про вакансию. Поэтому парсинг не берёт "первый попавшийся" ld+json блок, а явно ищет среди них тот,
где `"@type": "JobPosting"` — это то, что делает `findJobPosting()` ниже.

Откуда берутся детальные поля:

| Поле             | Источник                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `description`     | `description` из JSON-LD, HTML внутри превращён в чистый текст через `htmlToText`           |
| `location`        | `jobLocation[0].address` (`null`, если поля нет)                                            |
| `isRemote`        | `jobLocationType === "TELECOMMUTE"`                                                          |
| `skillsSummary`   | первый абзац `description`, если он начинается с "Навыки" (шаблонное вступление habr)        |
| `seniority`       | вырезано из `skillsSummary` по метке `"Квалификация:"` регэкспом                            |
| `specialization`  | вырезано из `skillsSummary` по метке `"Специализации:"` регэкспом                           |

`salary` намеренно не сохраняется — ручная проверка ~150 карточек листинга показала, что везде
стоит "зарплата не указана", а видна только рыночная оценка "похожие специалисты получают..." —
это не реальная цифра от работодателя, поэтому и не пишем её как будто это данные вакансии (та же
логика, что у отброшенных `baseSalary`/`jobLocation` в RemoteOK, см.
[PUPPETEER_REMOTEOK_STRATEGY.md](PUPPETEER_REMOTEOK_STRATEGY.md)).

## Код: получение HTML листинга

→ [`habrCareerStrategy.ts#L141`](../../../apps/api/src/crawler/strategies/habrCareerStrategy.ts#L141)

```ts
import axios from "axios";
import { getOrFetch } from "../pageCache.js";
import { waitForSlot } from "../rateLimiter.js";
// USER_AGENT, REQUEST_TIMEOUT_MS — константы файла, см. верх habrCareerStrategy.ts

for (let page = 1; page <= source.maxPagesToCrawl; page += 1) {
  const pageUrl = new URL("/vacancies", source.baseUrl);
  if (page > 1) pageUrl.searchParams.set("page", String(page));

  const { html, cacheHit } = await getOrFetch(source.id, pageUrl.toString(), async () => {
    await waitForSlot(source.id, source.defaultDelayMs);
    const response = await axios.get<string>(pageUrl.toString(), {
      headers: { "User-Agent": USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  });

  const pageVacancies = parseHabrCareerPage(html, source);
  vacancies.push(...pageVacancies);
}
```

1. Цикл `for (page = 1; page <= source.maxPagesToCrawl; ...)` — сколько страниц листинга обойти,
   задаётся полем самого источника (`CrawlSource.maxPagesToCrawl`), а не хардкодом в стратегии.
2. `pageUrl.searchParams.set("page", ...)` — на первой странице параметр `page` не добавляется
   вообще (сайт и без него отдаёт страницу 1), со второй — обычная query-string пагинация (в
   отличие от RemoteOK, где `?page=2` подтверждённо возвращает те же строки и пагинации нет).
3. `getOrFetch` — тот же Redis-кэш страницы, что у RemoteOK (см.
   [`pageCache.ts`](../../../apps/api/src/crawler/pageCache.ts)); ключ строится по хешу URL, так
   что разные страницы листинга кэшируются отдельно друг от друга.
4. `waitForSlot(source.id, source.defaultDelayMs)` — тот же rate limiter, что и у RemoteOK,
   подробный разбор механизма — в [PUPPETEER_REMOTEOK_STRATEGY.md](PUPPETEER_REMOTEOK_STRATEGY.md#код-получение-html).
   Здесь он общий для листинга *и* всех детальных запросов ниже — то есть все запросы к
   `habr_career` в рамках одного краула (сколько бы вакансий ни было) идут не чаще, чем раз в
   `defaultDelayMs`.
5. `axios.get<string>(url, { headers, timeout })` — сам HTTP GET. `headers: { "User-Agent":
   USER_AGENT }` — настоящий десктопный UA (та же причина, что у Puppeteer: не выглядеть ботом),
   `timeout: REQUEST_TIMEOUT_MS` — без него Node будет ждать зависший ответ бесконечно и
   заблокирует весь прогон краула вместо того, чтобы уйти в обработку ошибки.
6. `response.data` — тело ответа, уже строка HTML (Axios сам её не парсит) — идёт в
   `parseHabrCareerPage` (Cheerio), как `page.content()` у Puppeteer идёт в `parseListingPage`.

## Код: парсинг листинга

→ [`habrCareerStrategy.ts#L18`](../../../apps/api/src/crawler/strategies/habrCareerStrategy.ts#L18)

```ts
import * as cheerio from "cheerio";
import type { CrawlSource } from "@prisma/client";
import type { RawVacancy } from "../types.js";

export function parseHabrCareerPage(html: string, source: CrawlSource): RawVacancy[] {
  const $ = cheerio.load(html);
  const vacancies: RawVacancy[] = [];

  $(".vacancy-card").each((_, card) => {
    const el = $(card);
    const href = el.find('a[href^="/vacancies/"]').first().attr("href");
    const externalId = href?.match(/\/vacancies\/(\d+)/)?.[1];
    const title = el.find(".vacancy-card__title-link").first().text().trim();
    if (!externalId || !title) return;

    const company = el.find(".vacancy-card__company a").first().text().trim() || null;
    const postedAt = el.find(".vacancy-card__date time.basic-date").first().attr("datetime") ?? null;

    vacancies.push({
      externalId,
      title,
      company,
      url: new URL(href, source.baseUrl).toString(),
      postedAt,
      sourceId: source.id,
    });
  });

  return vacancies;
}
```

1. `$(".vacancy-card").each(...)` — перебор всех карточек вакансий на странице, как у RemoteOK
   `$("tr.job").each(...)` — тот же паттерн Cheerio, разная разметка источника.
2. `if (!externalId || !title) return;` — карточка без ID или заголовка (например, рекламный блок
   с похожей вёрсткой) молча пропускается, а не падает всей функцией.
3. `new URL(href, source.baseUrl).toString()` — `href` в HTML относительный (`/vacancies/123`),
   здесь он превращается в абсолютный URL через базовый адрес источника — этот `url` потом
   используется как раз для запроса детальной страницы в `enrichDetails`.

## Код: детальный краул (`enrichDetails`) и парсинг детальной страницы

→ [`habrCareerStrategy.ts#L171`](../../../apps/api/src/crawler/strategies/habrCareerStrategy.ts#L171)
(парсинг: [`habrCareerStrategy.ts#L96`](../../../apps/api/src/crawler/strategies/habrCareerStrategy.ts#L96))

```ts
import { getOrFetch } from "../pageCache.js";
import { waitForSlot } from "../rateLimiter.js";
import { htmlToText } from "../htmlToText.js";

// findJobPosting($) ищет среди всех <script type="application/ld+json"> блоков страницы
// именно тот, где "@type": "JobPosting" — страница может нести и другие ld+json блоки
// (Organization, BreadcrumbList), не только вакансию.

for (const [index, vacancy] of vacancies.entries()) {
  if (isCancelled()) break;

  let html: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts && html === undefined; attempt += 1) {
    try {
      const result = await getOrFetch(source.id, vacancy.url, async () => {
        await waitForSlot(source.id, source.defaultDelayMs);
        const response = await axios.get<string>(vacancy.url, {
          headers: { "User-Agent": USER_AGENT },
          timeout: REQUEST_TIMEOUT_MS,
        });
        return response.data;
      });
      html = result.html;
    } catch (error) {
      // retry once on transient network errors; see full source for logging
    }
  }

  if (html === undefined) continue; // failed after retries — logged as ERROR, vacancy skipped

  const details = parseHabrVacancyDetail(html); // throws if no JobPosting block at all
  await upsertVacancy({ ...vacancy, ...details });
}
```

Ключевые решения (полный код с логированием — в самом файле, здесь сокращено ради читаемости):

1. **Один и тот же `getOrFetch`/`waitForSlot`**, что и для листинга — детальные запросы не
   обходят рейт-лимитер отдельным путём, они разделяют его с листингом. Из-за этого полный прогон
   с сотнями вакансий на сидированной паузе (12с) может занять несколько минут — осознанный
   компромисс: вежливость к источнику важнее скорости прогона (см. комментарий в исходнике над
   `enrichDetails`).
2. **Retry только на fetch, не на parse** (`maxAttempts = 2`): сетевая ошибка (например,
   `ETIMEDOUT`) может быть случайной и стоит повторной попытки, а вот ошибка парсинга — нет, она
   детерминирована для того же HTML: `getOrFetch` на повторной попытке просто вернёт тот же
   закэшированный HTML из Redis, так что повтор парсинга не может исправить ситуацию и только
   выдал бы настоящую, устойчивую проблему за "временную".
3. **`parseHabrVacancyDetail` бросает исключение**, только если на странице вообще нет блока
   `JobPosting` — тогда вызывающий код обязан пропустить `upsertVacancy` целиком (вакансия
   останется без обогащения), а не записать её так, будто "у вакансии правда нет локации/навыков".
   Если же блок `JobPosting` найден, но в нём, скажем, нет `jobLocation` — это уже настоящее,
   актуальное отсутствие данных у источника, и `location: null` — корректный результат, эти два
   случая (нет блока вообще vs. блок есть, но поле пустое) сознательно не смешиваются.
4. **`isCancelled()`** проверяется в начале каждой итерации по вакансии — если пользователь
   остановил краул через UI, цикл прерывается между вакансиями, а не только между страницами
   листинга.
5. **Нет отдельного лимита** на число вакансий, получающих детальное обогащение — обогащается
   каждая вакансия из прошедшего листинга, каждый прогон; единственная граница объёма —
   `source.maxPagesToCrawl`, уже применённый на шаге листинга. Более ранний вариант с отдельным
   лимитом на детальные запросы отбросили: он создавал "рваные" данные — один и тот же первый
   десяток вакансий обогащался бы каждый раз, а остальные не обогащались бы никогда.

## `extractLabeledClause` — как достаём `seniority`/`specialization`

→ [`habrCareerStrategy.ts#L77`](../../../apps/api/src/crawler/strategies/habrCareerStrategy.ts#L77)

Habr генерирует вступительный абзац вакансии по шаблону вида
`"Навыки: Python, Django. Квалификация: Middle. Специализации: Backend."` — но не все части
шаблона всегда присутствуют (например, специализация может отсутствовать). Поэтому вместо того,
чтобы резать строку по позиции (первая часть — навыки, вторая — квалификация, ...), для каждой
метки ищется свой независимый регэксп `` `${label}:\s*([^.]+)\.` `` — так отсутствие одной метки
не сдвигает и не путает извлечение остальных.
