# Puppeteer / RemoteOK Strategy

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/crawler/strategies/remoteOkStrategy.ts`](../../../apps/api/src/crawler/strategies/remoteOkStrategy.ts)

Puppeteer используется только там, где сайт технически требует настоящего браузера — как
только HTML получен, дальнейший парсинг идёт через тот же лёгкий Cheerio, что и для
статических источников.

## Зачем именно Puppeteer

`remoteok.com` отдаёт `403 Forbidden` на обычный не-браузерный HTTP-запрос (Cloudflare
bot-check). Axios+Cheerio (как для `habr_career`) тут не проходит — сайт распознаёт запрос
как не-браузерный. Puppeteer поднимает headless Chrome, который для Cloudflare выглядит как
обычный посетитель.

## Структура страницы, которую мы достаём

Каждая вакансия — строка `<tr class="job">` с данными в HTML-атрибутах и опциональным
JSON-LD блоком (JSON-LD = "JSON for Linked Data" — стандартный формат для встраивания
структурированных данных в HTML через `<script type="application/ld+json">`; сайты используют его,
чтобы поисковики вроде Google понимали содержимое страницы, не парся вёрстку):

```html
<tr
  class="job"
  data-id="111"
  data-href="/remote-jobs/foo-111"
  data-company="Acme Remote"
  data-epoch="1700000000"
>
  <td><h2>Senior Backend Engineer</h2></td>
  <td class="tags">
    <span class="tag">React</span>
    <span class="tag">Node</span>
  </td>
  <script type="application/ld+json">
    {
      "@context": "http://schema.org",
      "@type": "JobPosting",
      "description": "<p>Great backend role.</p>"
    }
  </script>
</tr>
```

отсюда мы берём информацию для полей [`RawVacancy`](../../../apps/api/src/crawler/types.ts#L3):

| Поле            | Источник в HTML                                                            |
| --------------- | -------------------------------------------------------------------------- |
| `externalId`    | `data-id`                                                                  |
| `url`           | `data-href`                                                                |
| `title`         | текст `<h2>`                                                               |
| `company`       | `data-company`                                                             |
| `postedAt`      | `data-epoch` (unix-время)                                                  |
| `skillsSummary` | `.tags .tag`, дедуплицированы (одинаковые теги встречаются в HTML дважды — на странице есть скрытая десктоп-вёрстка и скрытая мобильная, у обеих свой набор `.tag`; без дедупликации каждый навык попал бы в список дважды) |
| `description`   | `description` из JSON-LD (при невалидном JSON — `null`)                    |
| `isRemote`      | `true` (захардкожено — источник целиком remote)                            |

`baseSalary`, `jobLocationType`, `jobLocation` из JSON-LD не сохраняются — это одинаковый
boilerplate на всех строках, не реальные данные вакансии. Это SEO-разметка для Google Jobs: Google
показывает специальный расширенный блок вакансий в поиске, если страница содержит JSON-LD с
`@type: "JobPosting"` в нужном формате (это требование самого Google, задокументированное в их
Search Central) — сайты добавляют такую разметку, чтобы вакансии индексировались в этом блоке, а
не для того, чтобы дать краулерам вроде нашего реальные структурированные данные. RemoteOK,
похоже, генерирует эти три поля одинаковыми заглушками на каждой строке, а не индивидуально по
вакансии — поэтому они бесполезны для нас и не сохраняются.

## Код: получение HTML

→ [`remoteOkStrategy.ts#L116`](../../../apps/api/src/crawler/strategies/remoteOkStrategy.ts#L116)

```ts
import puppeteer from 'puppeteer';
import { getOrFetch } from '../pageCache.js';
import { waitForSlot } from '../rateLimiter.js';
// USER_AGENT, NAVIGATION_TIMEOUT_MS — константы файла, см. верх remoteOkStrategy.ts

const { html, cacheHit } = await getOrFetch(source.id, pageUrl, async () => {
  await waitForSlot(source.id, source.defaultDelayMs);
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(pageUrl, {
      waitUntil: 'networkidle2',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    return await page.content();
  } finally {
    await browser.close();
  }
});
```

1. `getOrFetch` — Redis-кэш страницы, чтобы не запрашивать сайт повторно.
2. `waitForSlot` — rate limiter на Redis ([`rateLimiter.ts#L12`](../../../apps/api/src/crawler/rateLimiter.ts#L12)). Задача: не бить по `remoteok.com` чаще, чем раз в
   `source.defaultDelayMs` миллисекунд — даже если несколько crawl-джобов по этому источнику
   идут параллельно. Как это устроено внутри:
   - Для источника есть один Redis-ключ `rate:source:{sourceId}` (например `rate:source:2`).
     Redis — не локальная переменная процесса, а отдельный сервис, поэтому этот ключ общий
     для всех процессов/джобов, которые могут одновременно крутить краул этого источника —
     ключевое отличие от `setTimeout`/переменной в памяти, которая работала бы только в
     рамках одного процесса.
   - Значение ключа — timestamp (`Date.now()`) последнего запроса к этому источнику,
     записанный туда предыдущим вызовом `waitForSlot`.
   - При каждом вызове: читаем этот timestamp (`redis.get(key)`), считаем `elapsed = сейчас -
     timestamp` и `remaining = delayMs - elapsed`. Если `remaining > 0` — значит с прошлого
     запроса прошло меньше положенной паузы, и функция реально ждёт: `await sleep(remaining)`,
     где `sleep` — это `Promise`, обёрнутый вокруг `setTimeout` (строка 4 `rateLimiter.ts`).
     `await` здесь означает, что выполнение краула буквально приостанавливается на
     `remaining` мс, ничего не делая, прежде чем продолжить к `puppeteer.launch`.
   - Если ключа в Redis ещё нет (первый запрос к источнику) или `remaining <= 0` (пауза уже
     и так прошла) — ждать не нужно, идём дальше сразу.
   - После (не)ожидания функция перезаписывает ключ текущим timestamp'ом командой `redis.set(key,
     Date.now(), "PX", delayMs)`. `PX delayMs` — это TTL самого ключа в Redis (в миллисекундах):
     ключ сам исчезнет из Redis ровно через `delayMs`, если до этого никто не перезапишет его
     новым вызовом. Это подстраховка, а не часть основной логики паузы (та считается через
     разницу timestamp'ов, а не через существование ключа) — просто не даёт в Redis копиться
     ключи для источников, которые давно не краулили.
   - Итог: если два джоба одновременно пытаются вызвать `waitForSlot` для одного и того же
     источника, оба читают/пишут один и тот же Redis-ключ, поэтому фактические запросы к сайту
     всё равно окажутся разнесены минимум на `defaultDelayMs` — именно это и делает лимитер
     общим ("shared"), а не по одному на процесс.
3. `puppeteer.launch({ headless: true })` — один браузер на весь `crawl()`, не на страницу.
4. `page.setUserAgent(USER_AGENT)` — подмена UA на настоящий десктопный Chrome (Puppeteer по
   умолчанию отдаёт UA с "HeadlessChrome").
5. `page.goto(..., { waitUntil: "networkidle2" })` — ждём, пока сетевая активность утихнет,
   чтобы JS успел дорендерить контент.
6. `page.content()` — отрендеренный HTML идёт дальше в `parseListingPage` (Cheerio).
7. `finally { browser.close() }` — гарантированное закрытие браузера, иначе процессы
   Chromium утекают.

## Парсинг: Cheerio по уже полученному HTML

→ [`remoteOkStrategy.ts#L70`](../../../apps/api/src/crawler/strategies/remoteOkStrategy.ts#L70)

```ts
import * as cheerio from 'cheerio';

const $ = cheerio.load(html);

$('tr.job').each((_, el) => {
  const row = $(el);
  const externalId = row.attr('data-id');
  const href = row.attr('data-href') || row.attr('data-url');
  const title = row.find('h2').first().text().trim();
  if (!externalId || !href || !title) return;
  // ...
});
```

Пагинации нет — обходится только `/remote-dev-jobs` один раз за запуск (проверено вручную:
`?page=2` возвращает те же строки, "load more" идёт через AJAX-эндпоинт, запрещённый
`robots.txt`).
