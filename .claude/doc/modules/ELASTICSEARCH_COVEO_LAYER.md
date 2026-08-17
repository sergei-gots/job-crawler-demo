# Coveo-like слой — фасетный поиск поверх Elasticsearch

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/search/queryVacancies.ts`](../../../apps/api/src/search/queryVacancies.ts),
[`apps/api/src/search/suggestVacancies.ts`](../../../apps/api/src/search/suggestVacancies.ts)

Это не отдельная библиотека, а тонкий слой поверх `@elastic/elasticsearch`, который собирает
одним запросом три вещи, которые в enterprise-поиске (Coveo, Elastic App Search) обычно идут
вместе: свободный текстовый поиск, фасетную фильтрацию и цифры для самих фасетов ("сколько
результатов у каждого значения"). Разбор самого индекса (маппинг, версионирование схемы) — в
[ELASTICSEARCH_SEARCH_INDEX.md](ELASTICSEARCH_SEARCH_INDEX.md); здесь — разбор запроса поверх него.

## Определение: что такое фасет

Фасет — список фильтров-чекбоксов с числом рядом с каждым значением, который пересчитывается под
текущую выборку результатов. Тот же паттерн — в фильтрах Ozon/Wildberries/Booking.com: колонка
"Бренд" или "Цена" с числом в скобках у каждого значения ("Nike (128)", "Adidas (54)"). Список не
статичный (не все бренды, которые вообще существуют), а состоит из значений, реально
встречающихся в текущей выборке, с количеством документов у каждого.

В этом проекте роль "Бренда"/"Размера" играют колонки **Specialization / Seniority level /
Remote-On-site / Location / Company** на странице `/search`
(→ [`search-page.tsx#L104-149`](../../../apps/web/widgets/search/ui/search-page.tsx#L104)) —
карточка "Facets" слева с чекбоксами вида `Backend (12)`, `Frontend (7)`.

Elasticsearch хранит проиндексированные вакансии плоским списком документов (JSON-объекты с
полями `title`, `company`, `specialization`, `seniority`, `location`, `isRemote`...). Подсчёт
фасета по Specialization — та же операция, что SQL `SELECT specialization, COUNT(*) FROM
vacancies GROUP BY specialization`. В ES эта операция называется **aggregation** (агрегация) —
конкретно `terms` aggregation: сгруппировать документы по значению поля и посчитать размер каждой
группы. "Фасет" — название паттерна использования этой агрегации (agg → чекбоксы с числом), а не
отдельная технология поверх ES: сам ES ничего не знает о UI-чекбоксах, он отдаёт пары "значение →
количество документов".

### Пример на конкретных данных

Пусть в индексе `crawler_results` сейчас 20 вакансий, и у поля `seniority` такое распределение:
9 документов `"Middle"`, 6 — `"Senior"`, 5 — `"Junior"`.

1. **ES-агрегация** (см. код ниже, `FACET_FIELDS`/`aggregations` в `searchVacancies`) вернёт для
   `seniority`:
   ```json
   { "buckets": [
     { "key": "Middle", "doc_count": 9 },
     { "key": "Senior", "doc_count": 6 },
     { "key": "Junior", "doc_count": 5 }
   ]}
   ```
2. **API** (`GET /vacancies/search`) превращает это через `bucketsFor(...)` в
   `facets.seniority: [{ value: "Middle", count: 9 }, { value: "Senior", count: 6 }, { value: "Junior", count: 5 }]`
   и кладёт в JSON-ответ рядом с самими вакансиями (`hits`) — см. `VacancySearchResult` ниже.
3. **Фронтенд** получает этот JSON и рендерит его как есть — цикл `.map` по бакетам, каждый бакет
   становится одним чекбоксом с надписью `${value} (${count})`. Это буквально:
   ```tsx
   // facet-group.tsx#L21
   {buckets.map((bucket) => (
     <label key={bucket.value}>
       <Checkbox checked={selected.has(bucket.value)} onCheckedChange={() => onToggle(bucket.value)} />
       <span>{bucket.value}</span>
       <span>({bucket.count})</span>
     </label>
   ))}
   ```
   Никакой отдельной "фасетной" логики на фронтенде нет — он просто рисует то, что прислал API.

### Путь одного клика: от чекбокса до Elasticsearch и обратно

Ниже — последовательность шагов при клике на чекбокс `Middle (9)`:

| # | Что происходит | Файл:строка |
|---|---|---|
| 1 | Клик по чекбоксу вызывает `onToggle("Middle")` | [`facet-group.tsx#L28`](../../../apps/web/widgets/search/ui/facet-group.tsx#L28) |
| 2 | `toggleSeniority("Middle")` добавляет `"Middle"` в React-state `Set` (`seniority`) | [`use-vacancy-search.ts#L119`](../../../apps/web/features/search-vacancies/lib/use-vacancy-search.ts#L119) |
| 3 | Изменение state триггерит `useEffect`, который после 300ms дебаунса вызывает `runSearch` | [`use-vacancy-search.ts#L92-99`](../../../apps/web/features/search-vacancies/lib/use-vacancy-search.ts#L92) |
| 4 | `runSearch` собирает все текущие фильтры (`query`, все выбранные фасеты, `page`) в один объект и зовёт `searchVacancies(...)` | [`use-vacancy-search.ts#L59-72`](../../../apps/web/features/search-vacancies/lib/use-vacancy-search.ts#L59) |
| 5 | `searchVacancies` сериализует фильтры в query-string (`?seniority=Middle&page=1&...`) и делает `GET /vacancies/search?...` | [`search-vacancies.ts#L11-31`](../../../apps/web/features/search-vacancies/api/search-vacancies.ts#L11) |
| 6 | На бэкенде контроллер парсит `req.query.seniority` обратно в массив строк | [`vacancies.controller.ts#L31-38`](../../../apps/api/src/vacancies/vacancies.controller.ts#L31) |
| 7 | `searchVacancies(filters)` (та функция, что разобрана ниже в этом файле) строит ES-запрос: `"Middle"` уходит в `bool.filter` как `terms`, и **одновременно** пересчитываются агрегации по всем пяти полям заново — уже среди вакансий, отфильтрованных по `seniority: Middle` | `queryVacancies.ts#L92` (разбор ниже) |
| 8 | ES возвращает и новые `hits` (только Middle-вакансии), и новые бакеты для всех пяти фасетов (например, у Location или Company числа в скобках теперь меньше — они посчитаны только среди Middle-вакансий) | — |
| 9 | Фронтенд кладёт ответ в state (`setHits`, `setFacets`) — React перерисовывает и список вакансий, и панель фасетов с новыми числами | [`use-vacancy-search.ts#L73-75`](../../../apps/web/features/search-vacancies/lib/use-vacancy-search.ts#L73) |

На шаге 7 фасеты пересчитываются заново при каждом запросе, а не берутся из заранее посчитанного
справочника. Выбор "Middle" не только фильтрует список вакансий — он также меняет числа у
остальных фасетов (Location, Company и т.д.), поскольку агрегации в ES считаются над тем же
отфильтрованным набором документов, что и сами результаты. Это и есть механизм, за счёт которого
список фасетов "подстраивается" под текущую выборку, как в примере с Ozon/Wildberries выше.

## Глоссарий терминов

Таблица ниже расшифровывает термины, использованные в этом файле, с привязкой к тому, где каждый
из них встречается.

| Термин | Значение | Где встречается здесь |
|---|---|---|
| **Индекс (index)** | Аналог "таблицы" в реляционной БД — именованная коллекция документов одной формы. У нас один индекс — `crawler_results`. | `CRAWLER_RESULTS_INDEX` в `crawlerResultsIndex.ts`, разбор — [ELASTICSEARCH_SEARCH_INDEX.md](ELASTICSEARCH_SEARCH_INDEX.md) |
| **Документ (document)** | Аналог "строки таблицы" — один JSON-объект в индексе. У нас один документ = одна вакансия. | `CrawlerResultDoc` |
| **Маппинг (mapping)** | Аналог "схемы таблицы" — заранее объявленный список полей документа и их типов (`text`, `keyword`, `boolean`...). Определяет, *как* ES будет анализировать/индексировать каждое поле, то есть что вообще можно с ним потом делать в запросах. | `crawlerResultsIndex.ts`, разбор — [ELASTICSEARCH_SEARCH_INDEX.md](ELASTICSEARCH_SEARCH_INDEX.md) |
| **Поле типа `text` vs `keyword`** | `text` — значение разбивается на отдельные слова (токены) при индексации, чтобы работал полнотекстовый поиск ("найди 'developer' внутри длинного описания"). `keyword` — значение хранится целиком, без разбивки, для точного совпадения ("Location = ровно 'Berlin', а не любой текст со словом berlin"). | Раздел "Код: комбинация текста и фильтров" ниже — `location` (text) vs `location.keyword` (keyword) |
| **Aggregation (агрегация)** | Операция "сгруппировать документы по значению поля и что-то посчитать" — аналог SQL `GROUP BY` + `COUNT(*)`. Именно агрегации лежат в основе фасетов — см. пример с Seniority выше. | `aggregations: {...}` в `searchVacancies` |
| **`terms` aggregation** | Конкретный вид агрегации: "сгруппируй по точным значениям этого поля" (в отличие от, например, `range`-агрегации — группировки по числовым диапазонам, которая здесь не используется). | `FACET_FIELDS` → `{ terms: { field, size: FACET_AGG_SIZE } }` |
| **Bucket (бакет)** | Одна "корзина"/группа внутри результата агрегации — пара "значение + сколько документов в него попало", например `{ key: "Middle", doc_count: 9 }`. Ровно то, что превращается в один пункт фасета. | `bucketsFor(...)`, пример с Seniority выше |
| **Facet (фасет)** | Не отдельная ES-технология, а название UI-паттерна: результат `terms`-агрегации, отрисованный как список чекбоксов-фильтров с числами. См. раздел "Что такое фасет" выше. | Вся эта дока |
| **Query DSL / `bool` query** | Язык, на котором ES-запрос описывается как JSON (Query DSL). `bool` — способ скомбинировать несколько условий через логику: `filter` (обязательно, но не влияет на релевантность), `must` (обязательно и влияет на релевантность), есть ещё `should`/`must_not` (здесь не используются). | `query: { bool: { filter, must } }` |
| **`filter` vs `must`** | Оба обязательны ("документ должен пройти"), разница — в скоринге. `filter` — да/нет условие без веса (facet-фильтры: специализация, локация...), может кэшироваться ES. `must` — условие, которое ещё и влияет на `score` (текстовый поиск: чем лучше совпадение, тем выше в списке). | Раздел "Код: комбинация текста и фильтров" |
| **Relevance / `_score`** | Число, которым ES ранжирует результаты текстового поиска — чем больше, тем "релевантнее" запросу считается документ. Без текстового запроса (`must` пуст) скоринг вырождается, все документы формально равны. | Упоминается в разделе про `filter`/`must` |
| **`multi_match`** | Конкретный тип текстового запроса: "ищи эту строку сразу в нескольких полях" (`title`, `company`, `description`), а не в одном. | `must: [{ multi_match: {...} }]` |
| **`track_total_hits`** | Флаг "посчитай точное количество совпадений, а не остановись после первых 10 000". По умолчанию ES экономит и не досчитывает точно — без этого флага `total` мог бы просто показывать "10000+". | Раздел "Код: комбинация текста и фильтров", пункт 4 |
| **`from`/`size` (offset-пагинация)** | Классическая постраничная выдача: `from` — сколько результатов пропустить, `size` — сколько вернуть. Аналог SQL `OFFSET`/`LIMIT`. | Раздел "Пагинация: почему `MAX_PAGE_SIZE = 50`" |
| **`max_result_window`** | Системный лимит ES: `from + size` не может превышать это значение (по умолчанию 10 000) — защита от слишком "глубокой" постраничной выдачи, которая дорого стоит по производительности. | Там же |
| **`post_filter`** | Продвинутая техника (здесь **не используется**, специально описана как "known simplification"): позволяет каждому фасету при подсчёте своих бакетов игнорировать *свой же* фильтр, чтобы показывать "сколько будет, если добавить ещё и это" вместо "сколько уже есть у текущего выбора". | Раздел "Известное упрощение" ниже |
| **Coveo** | Реальный коммерческий enterprise-поисковый продукт (SaaS), на паттерны которого ("фасетная навигация + релевантность + автокомплит в одном запросе") ориентируется этот учебный слой — отсюда "Coveo-like" в названии, не потому что используется код/API Coveo. | Название файла/раздела |

## Зачем именно "Coveo-like", а не просто "поиск по Elasticsearch"

Разница не в технологии (это всё тот же ES `_search`), а в форме ответа API. Обычный
full-text-поиск вернул бы просто список хитов. Здесь `searchVacancies` возвращает хиты **и**
фасеты в одном ответе — фронтенд не должен делать отдельный запрос "а какие вообще есть
Specialization/Seniority/Location", чтобы построить панель фильтров: агрегации считаются в том же
запросе, что и сам поиск, за один round-trip к ES. Это тот самый паттерн, который в enterprise
search-системах (Coveo и подобных) называется faceted navigation.

## Код: комбинация текста и фильтров

→ [`queryVacancies.ts#L92`](../../../apps/api/src/search/queryVacancies.ts#L92)

```ts
export interface VacancySearchFilters {
  q?: string;
  specialization?: string[];
  seniority?: string[];
  isRemote?: boolean[];
  location?: string[];
  company?: string[];
  page?: number;
  pageSize?: number;
}

export async function searchVacancies(filters: VacancySearchFilters): Promise<VacancySearchResult> {
  await ensureCrawlerResultsIndex();

  const filter: QueryDslQueryContainer[] = [{ range: { lastSeenAt: { gte: staleCutoffIso() } } }];
  if (filters.specialization?.length) filter.push({ terms: { specialization: filters.specialization } });
  if (filters.seniority?.length) filter.push({ terms: { seniority: filters.seniority } });
  if (filters.isRemote?.length) filter.push({ terms: { isRemote: filters.isRemote } });
  if (filters.location?.length) filter.push({ terms: { "location.keyword": filters.location } });
  if (filters.company?.length) filter.push({ terms: { "company.keyword": filters.company } });

  const must: QueryDslQueryContainer[] = filters.q
    ? [{ multi_match: { query: filters.q, fields: ["title", "company", "description"] } }]
    : [];

  const result = await esClient.search<CrawlerResultDoc, Record<keyof typeof FACET_FIELDS, AggregationsStringTermsAggregate>>({
    index: CRAWLER_RESULTS_INDEX,
    query: { bool: { filter, must } },
    from,
    size: pageSize,
    track_total_hits: true,
    aggregations: Object.fromEntries(
      Object.entries(FACET_FIELDS).map(([name, field]) => [
        name,
        { terms: { field, size: FACET_AGG_SIZE } },
      ]),
    ),
  });
  // ...
}
```

1. **`filter` vs `must`** — ключевое архитектурное решение ES-запроса. Все фасеты
   (specialization/seniority/isRemote/location/company) уходят в `bool.filter`: это
   **не-скорящие** условия — они сужают набор результатов, но не влияют на релевантность/сортировку
   (плюс ES умеет их кэшировать). Свободный текст (`q`) уходит в `bool.must` через `multi_match` —
   это единственная часть запроса, которая реально считает score и определяет порядок результатов.
   Если `q` не задан, `must` пустой — запрос становится "match all в рамках фильтров",
   отсортированный по умолчанию (`_score` вырождается, ES отдаёт в порядке индекса/сортировки).
2. **`location.keyword`/`company.keyword`** — у этих полей два представления в индексе: обычное
   текстовое (участвует в `multi_match` полнотекстового поиска) и `.keyword` sub-field (точное,
   нетокенизированное значение) — фильтр по фасету должен матчить ровно "Berlin", а не любой
   документ, где слово "berlin" где-то встретилось.
3. **`staleCutoffIso()`** (line 11) всегда в `filter` первым элементом — и поиск, и фасеты
   молчаливо исключают вакансии старше `MAX_VACANCY_AGE_DAYS` (по умолчанию 14 дней), так что
   фасетные счётчики никогда не покажут "устаревшую" вакансию как часть результата.
4. **`track_total_hits: true`** — без этого ES по умолчанию останавливает точный подсчёт на 10 000
   и просто пишет "10000+"; для контрола пагинации ("Page X из N") нужен точный `total`.

## Код: агрегации → фасеты

→ [`queryVacancies.ts#L70`](../../../apps/api/src/search/queryVacancies.ts#L70)

```ts
const FACET_FIELDS = {
  specialization: "specialization",
  seniority: "seniority",
  isRemote: "isRemote",
  location: "location.keyword",
  company: "company.keyword",
} as const;

const FACET_AGG_SIZE = 20;

function bucketsFor(name: keyof typeof FACET_FIELDS): FacetBucket[] {
  const buckets = result.aggregations?.[name]?.buckets;
  if (!Array.isArray(buckets)) return [];
  return buckets.map((bucket) => {
    const keyAsString = (bucket as { key_as_string?: string }).key_as_string;
    return { value: keyAsString ?? String(bucket.key), count: bucket.doc_count };
  });
}
```

1. **`FACET_FIELDS` → `Object.fromEntries(...)`** (line 118) программно строит пять `terms`-
   агрегаций из одной таблицы соответствий "имя фасета → индексируемое поле" — вместо того, чтобы
   писать пять почти одинаковых блоков `aggregations: { specialization: {...}, seniority: {...} }`
   вручную.
2. **`key_as_string` для boolean-поля** — `isRemote` в ES бакетится внутренне по `0`/`1`
   (числовое представление boolean), но ES дополнительно кладёт в ответ человекочитаемый
   `key_as_string` (`"true"`/`"false"`). Клиентские типы `@elastic/elasticsearch` его не объявляют
   на базовой форме бакета, но поле реально приходит по сети — `bucketsFor` предпочитает его, чтобы
   фронтенду не пришлось самому превращать `1`/`0` обратно в true/false.
3. **`FACET_AGG_SIZE = 20`** — фасет с более чем 20 уникальными значениями (например Company)
   просто обрежет "хвост" редких значений; для MVP-корпуса этого достаточно, полноценный "Show more"
   для длинного хвоста не реализован.

## Известное упрощение: фасеты не исключают себя из своего же подсчёта

Комментарий прямо в коде (lines 85-91): полноценная faceted navigation считала бы количество
результатов для фасета X **без** учёта фильтра, наложенного самим фасетом X (обычно через
`post_filter` или "filtered aggregations") — тогда счётчик отвечает на вопрос "сколько результатов
будет, если я добавлю ещё и это значение". Здесь агрегации считаются над тем же итоговым `filter`,
что и сами хиты — счётчик отвечает на более простой вопрос "сколько результатов у текущего
выбора". Это осознанное упрощение MVP (см.
`.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`, Phase 3b), не баг.

## Пагинация: почему `MAX_PAGE_SIZE = 50`

→ [`queryVacancies.ts#L80`](../../../apps/api/src/search/queryVacancies.ts#L80)

```ts
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
```

Offset-пагинация в ES (`from`/`size`) официально ограничена `index.max_result_window` (по
умолчанию 10 000: `from + size` не может его превышать). `MAX_PAGE_SIZE = 50` — это не про размер
корпуса конкретно этого проекта, а защита от клиента, который случайно запросит слишком большую
страницу и упрётся в этот системный лимит ES.

## Автокомплит: типоагед-поиск без фасетов

→ [`suggestVacancies.ts#L33`](../../../apps/api/src/search/suggestVacancies.ts#L33)

`suggestVacancies(prefix)` — отдельная, более простая функция под другой юзкейс (typeahead в
строке поиска, не итоговые результаты). Использует `terms`-агрегацию с `include`-префиксом по
lowercase-нормализованным `.suggest` keyword-полям (`title.suggest`, `company.suggest`) плюс
`top_hits` под-агрегацию, чтобы вернуть оригинальный (не lowercase) регистр значения. Минимальная
длина префикса — 2 символа (`MIN_PREFIX_LENGTH`), не более 5 подсказок на поле (`BUCKET_SIZE`),
результат дедуплицируется по паре `field:value`, чтобы одно и то же значение не подсказывалось
дважды, если совпало в двух полях.
