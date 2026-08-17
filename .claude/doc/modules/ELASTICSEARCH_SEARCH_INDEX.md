# Elasticsearch — поисковый индекс вакансий

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/search/crawlerResultsIndex.ts`](../../../apps/api/src/search/crawlerResultsIndex.ts)

Elasticsearch хранит сами вакансии (`crawler_results` индекс) — единственное место, где живут
собранные краулером данные. В отличие от Postgres (см.
[POSTGRESQL_PRISMA_MODELS.md](POSTGRESQL_PRISMA_MODELS.md)) это **не источник правды**, а
производный, пересобираемый индекс: любую вакансию можно заново получить повторным краулом
(`upsert` идемпотентен по `sourceId:externalId`), поэтому индекс можно удалить и пересоздать без
потери "настоящих" данных.

## Зачем именно Elasticsearch (а не Postgres full-text search)

Постгрес умеет full-text search (`tsvector`), но не даёт из коробки то, что нужно здесь одновременно
и дёшево: релевантность по нескольким полям сразу (`multi_match` по `title`+`company`+
`description`), фасетные агрегации ("сколько вакансий на каждое значение specialization/seniority/
company" одним запросом, с учётом остальных активных фильтров) и autocomplete по префиксу
(`terms` агрегация с `include`-regex). Это ровно то, для чего проектировался Elasticsearch —
поисковый движок в первую очередь, а не транзакционное хранилище.

## Индекс как пересобираемая проекция

→ [`crawlerResultsIndex.ts#L117`](../../../apps/api/src/search/crawlerResultsIndex.ts#L117)

```ts
export const CRAWLER_RESULTS_SCHEMA_VERSION = 3;

export async function ensureCrawlerResultsIndex(): Promise<void> {
  if (indexEnsured) return;

  const exists = await esClient.indices.exists({
    index: CRAWLER_RESULTS_INDEX,
  });
  if (exists) {
    const liveVersion = await readLiveSchemaVersion();
    if (liveVersion === CRAWLER_RESULTS_SCHEMA_VERSION) {
      indexEnsured = true;
      return;
    }
    // версия не совпадает — индекс устарел под текущий маппинг
    await esClient.indices.delete(
      { index: CRAWLER_RESULTS_INDEX },
      { ignore: [404] },
    );
  }

  await createCrawlerResultsIndex();
  indexEnsured = true;
}
```

1. **`CRAWLER_RESULTS_SCHEMA_VERSION`** — число, вручную увеличиваемое при каждом изменении
   маппинга, которое существующие документы не переживут (новое поле-факт, изменённый тип,
   изменённый sub-field). Записывается в `_meta` индекса при создании
   ([`#L89`](../../../apps/api/src/search/crawlerResultsIndex.ts#L89)).
2. **`readLiveSchemaVersion()`** читает версию из `_meta` уже существующего индекса и сравнивает
   с текущей константой в коде.
3. **Несовпадение → удалить и пересоздать индекс пустым**, а не production-style zero-downtime
   reindex (новый индекс + alias-swap). Это осознанное упрощение для MVP: раз индекс — не
   источник правды, а `CrawlRun`/`CrawlLog` в Postgres при этом не трогаются вообще, следующий
   краул (по источнику или "crawl all") просто заново наполнит пустой индекс — это дешевле, чем
   писать reindex-логику, а для данных, которые и так пересобираемы, безопасно.
4. **`indexEnsured` (module-level `boolean`)** — после первой успешной проверки за время жизни
   процесса дальнейшие вызовы `ensureCrawlerResultsIndex()` (а его вызывает каждый
   `upsertVacancy`/`searchVacancies`/`suggestVacancies`) не бьют по Elasticsearch повторно — сброс
   этого флага (`resetCrawlerResultsIndexCache()`) нужен только когда индекс удалили "снаружи"
   обычного пути, например admin-действием "Clear search data" ниже.

## Маппинг: `text` vs `keyword` vs multi-field

→ [`crawlerResultsIndex.ts#L58`](../../../apps/api/src/search/crawlerResultsIndex.ts#L58)

```ts
const CRAWLER_RESULTS_PROPERTIES = {
  title: {
    type: 'text' as const,
    fields: {
      suggest: { type: 'keyword' as const, normalizer: 'lowercase_normalizer' },
    },
  },
  company: {
    type: 'text' as const,
    fields: {
      keyword: { type: 'keyword' as const },
      suggest: { type: 'keyword' as const, normalizer: 'lowercase_normalizer' },
    },
  },
  location: {
    type: 'text' as const,
    fields: { keyword: { type: 'keyword' as const } },
  },
  specialization: { type: 'keyword' as const },
  seniority: { type: 'keyword' as const },
  isRemote: { type: 'boolean' as const },
};
```

| Тип поля                     | Для чего                                                                                                                                                                                         | Пример здесь                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `text`                       | Токенизируется (разбивается на слова), участвует в full-text релевантном поиске (`multi_match`)                                                                                                  | `title`, `company`, `description`  |
| `keyword`                    | Хранится как единая неделимая строка, участвует в точных фильтрах и `terms`-агрегациях (фасеты)                                                                                                  | `specialization`, `seniority`      |
| `text` + `.keyword` под-поле | Одно и то же значение доступно **и** для полнотекстового поиска, **и** для фасетной агрегации — `text`-поле само по себе агрегировать нельзя                                                     | `company`, `location`              |
| `text` + `.suggest` под-поле | Отдельное от `.keyword` keyword-поле с `lowercase_normalizer` — под autocomplete по префиксу, независимо от регистра, не трогая `.keyword` (тот должен остаться в исходном регистре для фасетов) | `title.suggest`, `company.suggest` |

Ключевой нюанс: `company.keyword` и `company.suggest` — два **разных** под-поля с разным
назначением, специально не объединены в одно. `company.keyword` управляет фасетом "Company"
(точный фильтр + отображение бакетов) и обязан сохранять исходный регистр
("JetBrains" ≠ "jetbrains" в фасете). `company.suggest` — только для case-insensitive
prefix-match автокомплита, поэтому у него `normalizer: "lowercase_normalizer"`
([`#L45`](../../../apps/api/src/search/crawlerResultsIndex.ts#L45)) — приведение к нижнему
регистру прямо в под-поле. Смешать их в одно поле означало бы либо сломать регистр в фасете, либо
не получить case-insensitive автокомплит.

## Upsert по детерминированному ID

→ [`upsertVacancy.ts#L10`](../../../apps/api/src/search/upsertVacancy.ts#L10)

```ts
export async function upsertVacancy(raw: RawVacancy): Promise<void> {
  await ensureCrawlerResultsIndex();

  const id = `${raw.sourceId}:${raw.externalId}`;
  const now = new Date().toISOString();

  const detailFields = {
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    ...(raw.location !== undefined ? { location: raw.location } : {}),
    // ...остальные detail-поля тем же паттерном
  };

  await esClient.update({
    index: CRAWLER_RESULTS_INDEX,
    id,
    doc: { sourceId: raw.sourceId, /* ... */ lastSeenAt: now, ...detailFields },
    upsert: {
      sourceId: raw.sourceId,
      /* ... */ firstSeenAt: now,
      lastSeenAt: now,
      ...detailFields,
    },
  });
}
```

1. **`id = "{sourceId}:{externalId}"`** — не автогенерируемый ES ID, а детерминированный: одна и
   та же вакансия, повторно увиденная на следующем краула этого источника, попадает в **тот же**
   документ (обновление `lastSeenAt`), а не дублируется. `sourceId` в префиксе важен: у двух
   разных источников `externalId` может случайно совпасть (оба нумеруют вакансии от 1).
2. **`esClient.update({ doc, upsert })`** — один вызов покрывает оба случая: если документ уже
   существует — применяется `doc` (частичный merge полей); если нет — Elasticsearch создаёт его
   из `upsert`. `firstSeenAt` есть только в `upsert`-варианте — выставляется один раз, при
   первой вставке, и больше никогда не перезаписывается повторными `doc`-обновлениями.
3. **`detailFields` строится через `!== undefined`, не `!== null`** — принципиально: `null` для
   detail-поля — это **известное** отсутствие данных у источника (например, у вакансии правда
   нет `location`), а `undefined` — поле ещё не собрано (обычный `upsertVacancy` вызывается сразу
   после листингового прохода, до `enrichDetails`). Условие `!== undefined` гарантирует, что
   листинговый upsert (без ещё собранных `description`/`location`/...) не затрёт эти поля
   пустотой у документа, уже обогащённого предыдущим `enrichDetails` — то же различие "нет блока
   вообще vs. блок есть, но поле `null`", что описано в
   [AXIOS_CHEERIO_HABR_STRATEGY.md](AXIOS_CHEERIO_HABR_STRATEGY.md).

## Поиск с фасетами

→ [`queryVacancies.ts#L92`](../../../apps/api/src/search/queryVacancies.ts#L92)

```ts
const FACET_FIELDS = {
  specialization: 'specialization',
  seniority: 'seniority',
  isRemote: 'isRemote',
  location: 'location.keyword',
  company: 'company.keyword',
} as const;

export async function searchVacancies(
  filters: VacancySearchFilters,
): Promise<VacancySearchResult> {
  const filter: QueryDslQueryContainer[] = [
    { range: { lastSeenAt: { gte: staleCutoffIso() } } },
  ];
  if (filters.specialization?.length)
    filter.push({ terms: { specialization: filters.specialization } });
  // ...остальные фасетные фильтры тем же паттерном (terms по каждому активному filters.*)

  const must: QueryDslQueryContainer[] = filters.q
    ? [
        {
          multi_match: {
            query: filters.q,
            fields: ['title', 'company', 'description'],
          },
        },
      ]
    : [];

  const result = await esClient.search({
    index: CRAWLER_RESULTS_INDEX,
    query: { bool: { filter, must } },
    from,
    size: pageSize,
    track_total_hits: true,
    aggregations: Object.fromEntries(
      Object.entries(FACET_FIELDS).map(([name, field]) => [
        name,
        { terms: { field, size: 20 } },
      ]),
    ),
  });
  // ...сборка facets из result.aggregations, total из result.hits.total
}
```

1. **`filter` vs `must` в `bool`-запросе** — разница принципиальная, не стилистическая:
   `filter` (фасетные условия — specialization/seniority/isRemote/location/company/возрастной
   cutoff) не участвует в подсчёте релевантности (`_score`) и, в отличие от `must`, кэшируется
   Elasticsearch; `must` (текстовый `multi_match` по `q`) как раз влияет на релевантность —
   именно по нему результаты можно осмысленно сортировать "по релевантности". Фасетный фильтр не
   должен делать одну вакансию "более релевантной", чем другую — только сужать выборку.
2. **`aggregations` строятся из того же `FACET_FIELDS`**, что и фильтры — единственный источник
   истины для "какие поля вообще фасетируемы", вместо дублирования списка полей в фильтрах и в
   агрегациях по отдельности.
3. **`track_total_hits: true`** — без этого Elasticsearch по умолчанию останавливает точный
   подсчёт на 10 000 и возвращает "≥10000"; с ним `total` — точное число мэтчей по всем страницам
   (нужно для "Страница X из N" в UI), а не только по текущей странице.
4. **Известное упрощение (осознанное, не баг)**: агрегации считаются по тому же `filter`-набору,
   что и сам поиск — то есть бакет-каунт фасета "Specialization" уже учитывает активный фильтр
   "Specialization: Backend" (если он выбран), а не показывает "сколько ещё результатов добавится,
   если включить эту опцию" (для этого нужен `post_filter`, который здесь не реализован — детали
   компромисса в `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`).

## Автокомплит: `terms` + regex-`include` + `top_hits`

→ [`suggestVacancies.ts#L33`](../../../apps/api/src/search/suggestVacancies.ts#L33)

```ts
const SUGGEST_FIELDS = {
  title: 'title.suggest',
  company: 'company.suggest',
} as const;

const include = `${escapeRegExp(prefix.trim().toLowerCase())}.*`;

const result = await esClient.search({
  index: CRAWLER_RESULTS_INDEX,
  size: 0,
  aggregations: Object.fromEntries(
    Object.entries(SUGGEST_FIELDS).map(([field, subField]) => [
      field,
      {
        terms: { field: subField, include, size: 5 },
        aggregations: { original: { top_hits: { size: 1, _source: [field] } } },
      },
    ]),
  ),
});
```

1. **`size: 0`** — сам поиск не интересует ни один документ-хит, только агрегации: экономит
   передачу данных, которые всё равно бы отбросили.
2. **`terms.include: "prefix.*"` regex по `.suggest`-полю** — `.suggest` уже приведён к нижнему
   регистру нормалайзером на этапе индексации (см. таблицу маппинга выше), поэтому регэксп с
   `prefix.toLowerCase()` матчит независимо от того, каким регистром набрал пользователь.
3. **Вложенный `top_hits` под именем `original`** — сама `terms`-агрегация вернула бы значение
   **нормализованное** (нижний регистр — тот бакет-key и есть значение поля `.suggest`), но
   пользователю нужно показать "JetBrains", а не "jetbrains". `top_hits: { size: 1, _source:
[field] }` достаёт один реальный документ из этого бакета и берёт `field` (`title`/`company`,
   исходное `text`-поле, не `.suggest`) из него — оригинальный регистр восстанавливается через
   реальный документ, а не через саму агрегацию.
4. **`MIN_PREFIX_LENGTH = 2`** — короче двух символов запрос не уходит в Elasticsearch вообще
   (пустой список сразу) — на однобуквенном префиксе бакетов было бы слишком много, а сигнала для
   пользователя — мало.

## Пересборка индекса: admin-действие "Clear search data"

→ [`admin.service.ts#L30`](../../../apps/api/src/admin/admin.service.ts#L30)

```ts
export async function clearSearchData(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ select: { id: true } });
  await Promise.all(sources.map(({ id }) => stopAndWaitForSource(id)));

  await esClient.indices.delete(
    { index: CRAWLER_RESULTS_INDEX },
    { ignore: [404] },
  );
  resetCrawlerResultsIndexCache();
  await ensureCrawlerResultsIndex();
  await prisma.crawlRun.deleteMany({});
}
```

В отличие от `clearCache()` (Redis, см. [REDIS_RATE_LIMIT_CACHE.md](REDIS_RATE_LIMIT_CACHE.md)),
это более тяжёлая операция: она удаляет весь корпус вакансий **и** всю историю `CrawlRun`/
`CrawlLog` в Postgres — источник вправду возвращается в состояние "никогда не краулился". Сначала
останавливаются все активные краулы (`stopAndWaitForSource`, параллельно по всем источникам) —
удалять индекс из-под ещё выполняющегося краула означало бы, что его `upsertVacancy` попадёт в уже
не существующий (или пересоздаваемый) индекс. Индекс пересоздаётся сразу же (`ensureCrawlerResultsIndex()`
здесь, не оставляется на ленивое создание при первом апсерте) — иначе в тестировании была замечена
реальная гонка: краул, стартовавший сразу после очистки, мог обратиться к ещё не готовому шарду
только что созданного индекса.
