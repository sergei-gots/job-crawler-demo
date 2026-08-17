# Coveo-like слой — фасетный поиск поверх Elasticsearch

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/search/queryVacancies.ts`](../../../apps/api/src/search/queryVacancies.ts),
[`apps/api/src/search/suggestVacancies.ts`](../../../apps/api/src/search/suggestVacancies.ts)

Это не отдельная библиотека, а тонкий слой поверх `@elastic/elasticsearch`, который собирает
одним запросом три вещи, которые в enterprise-поиске (Coveo, Elastic App Search) обычно идут
вместе: свободный текстовый поиск, фасетную фильтрацию и цифры для самих фасетов ("сколько
результатов у каждого значения"). Разбор самого индекса (маппинг, версионирование схемы) — в
[ELASTICSEARCH_SEARCH_INDEX.md](ELASTICSEARCH_SEARCH_INDEX.md); здесь — разбор запроса поверх него.

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
