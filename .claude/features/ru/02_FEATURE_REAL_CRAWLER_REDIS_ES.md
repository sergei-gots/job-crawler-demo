# FEATURE: Реальный краулер + Redis + минимальный Elasticsearch (Increment 2)

*Перевод на русский для презентации. Исходник: [английская версия](../02_FEATURE_REAL_CRAWLER_REDIS_ES.md).*

## Обзор

Заменяет **мок**-раннер в том же процессе из Increment 1 на реальный краулинг MVP-источника, добавляет
Redis для rate limiting на уровне источника и кэш сырых страниц с коротким TTL, а также добавляет
минимальное хранилище вакансий на базе Elasticsearch, чтобы результаты краулинга были действительно
видны. Строится поверх `.claude/features/01_FEATURE_SOURCES_AND_JOBS.md` (Sources и Crawler Jobs CRUD,
Increment 1).

**Цель**: `POST /crawler-jobs/:id/start` выполняет реальный краулинг `habr_career` через Axios+Cheerio,
записывает реальный прогресс в `JobLog`, сохраняет распарсенные вакансии в Elasticsearch и отдаёт их
через два read-эндпоинта. AI-обогащение и полноценный слой поиска/фасетов в стиле Coveo остаются вне
рамок.

## Статус

**Реализовано и проверено вручную.** `apps/api/src/crawler/` (стратегия Axios+Cheerio, Redis rate
limiter, Redis-кэш страниц) и `apps/api/src/search/` (клиент Elasticsearch, индекс, upsert, запросы) —
настоящие; `apps/api/src/crawler-jobs/crawler-jobs.runner.ts` выполняет реальный краулинг вместо
таймеров-моков из Increment 1. Проверено end-to-end: реальный краулинг `career.habr.com` возвращает
25 вакансий, `JobLog` показывает реальный прогресс fetch/parse, `GET /sources/:id/vacancies` и
`GET /crawler-jobs/:id/vacancies` возвращают реальные данные, повторный запуск в пределах TTL кэша даёт
cache hit без дублей в ES, нереализованный источник (RemoteOK) пишет `WARN` и всё равно завершается
успешно, а `POST /crawler-jobs/:id/start` теперь возвращается сразу (fire-and-forget) вместо блокировки
на время краулинга. AI-обогащение и полноценный слой поиска/фасетов в стиле Coveo остаются вне рамок,
как и планировалось.

## Терминология

Скрапленный элемент называется **vacancy** (вакансия) в прозе/UI/маршрутах/сообщениях `JobLog` — этот
термин выбран вместо "posting"/"listing", потому что он соответствует собственным URL `habr_career`
вида `/vacancies/{id}` и является стандартным термином в британском/международном английском (также
формальный термин в "vacancy announcements" на `usajobs.gov`). Это следует тому же паттерну, что уже
применён для `CrawlerJob` (формальное имя модели) против "Crawler Job" (фраза в UI): формальное имя
сущности в Elasticsearch остаётся `CrawlerResult`, это уже закреплено в `ARCHITECTURE.md` — не
переименовывается. "Vacancy" — это обиходное слово, наложенное поверх, в путях маршрутов, сообщениях
логов и будущей копии UI.

## Решения по объёму, зафиксированные с пользователем

- **Источник**: только `habr_career`, согласно принципу "один источник, сделанный хорошо" из CLAUDE.md
  для MVP. Craigslist, Moikrug (уже исчез — редиректит на `career.habr.com`), WeWorkRemotely и RemoteOK
  остаются отложенными/неиспользуемыми.
- **Результат спайка** (read-only `curl` к `career.habr.com/vacancies`, без выполнения JS): листинг
  полностью рендерится на сервере — 25 элементов `.vacancy-card` пришли в ответ на обычный запрос.
  **Puppeteer не нужен.** `habr_career` краулится через Axios+Cheerio, даже несмотря на то, что его
  `CrawlSource.type` в сиде сейчас указан как `DYNAMIC` (это потребовало повторной проверки согласно
  примечанию, уже присутствующему в таблице Data Sources в `CLAUDE.md`). `PuppeteerStrategy` **не
  строится в этом инкременте** — только `AxiosCheerioStrategy`, подключённая универсально через
  `CrawlSource.type`, так что будущий `DYNAMIC`-источник сможет добавить её позже без изменения
  диспетчера.
- **Подтверждённые селекторы** для `habr_career`:
  - карточка: `.vacancy-card`
  - заголовок: `.vacancy-card__title-link` (текст)
  - внешний id / URL: `href="/vacancies/{id}"` (также присутствует как `.vacancy-card__backdrop-link`)
  - компания: `.vacancy-card__company a` (текст)
  - дата публикации: `.vacancy-card__date time.basic-date` → атрибут `datetime` (строка ISO)
- **Объём для Redis**: rate limiting (минимальная задержка на источник, с учётом
  `CrawlSource.defaultDelayMs`) + кэш сырых страниц с коротким TTL (избегает повторного получения
  одной и той же страницы источника двумя параллельными crawler jobs). В этом инкременте нет очереди
  задач/пула воркеров — раннер остаётся in-process, той же формы, что и мок.
- **Crawler Job и fetch — разные уровни**: каждый запуск `CrawlerJob` по-прежнему получает собственный
  полный след `JobLog` и переход статуса, даже если его сырая страница пришла из кэша, а не из свежего
  запроса.
- **Ключи используют `CrawlSource.id` (неизменяемый), никогда не `CrawlSource.name`**: `name` уникален,
  но это изменяемая отображаемая метка, а не стабильный идентификатор. Все ключи Redis (rate limiter,
  кэш страниц) и id документа Elasticsearch привязаны к числовому `CrawlSource.id`.
- **Хранилище**: теперь Elasticsearch, а не временная таблица в Postgres — документы `CrawlerResult`,
  пока без полей AI-обогащения, апсертятся по детерминированному id = `${sourceId}:${externalId}`, так
  что повторные краулинги обновляют `lastSeenAt` вместо создания дублей. Этот составной ключ — уникальный
  идентификатор вакансии во всём пространстве.
- **Фильтрация по ключевым словам для нескольких пользователей происходит на этапе чтения**, а не
  краулинга: краулинг сохраняет всё найденное на (1-2) страницах листинга независимо от того, какой
  crawler job его инициировал; ключевые слова из `CrawlerJob.keywords` применяются как запрос к ES при
  построении вида вакансий для этого crawler job.
- **Устаревание**: одна глобальная переменная окружения `MAX_VACANCY_AGE_DAYS` (по умолчанию 14),
  применяется только как фильтр ES на этапе чтения (`lastSeenAt >= now - N days`). Нет cron/задачи
  очистки, нет переопределения на уровне пользователя или crawler job, нет админ-UI/таблицы настроек в
  этом инкременте.
- **Ограничение объёма страниц**: новое поле `CrawlSource` — `maxPagesPerRun` (int, по умолчанию 1-2).
  Загружаются только страницы листинга — краулинга детальных страниц по каждой вакансии нет (это работа
  эпохи AI-обогащения).
- **Нет UI для просмотра/отладки сырых страниц** — кэш страниц является чисто внутренней инфраструктурой;
  видимость обеспечивается через существующие строки `JobLog` (например, "fetched habr_career page 1
  (cache: miss, 25 vacancies)").
- **Источники, отличные от habr**: по-прежнему выбираемы в UI Crawler Job (без изменений), но раннер
  пишет `JobLog` уровня `WARN` ("crawling not yet implemented for {source.name}") и корректно пропускает
  их, а не проваливает весь crawler job.
- **Два read-эндпоинта**, оба возвращают вакансии, но с разным охватом:
  - `GET /sources/:sourceId/vacancies` — сырая лента по одному источнику, фильтрация только по
    возрасту, без фильтра по ключевым словам для конкретного пользователя (не привязана к какому-либо
    одному crawler job).
  - `GET /crawler-jobs/:id/vacancies` — те же исходные данные, дополнительно отфильтрованные по
    `keywords` этого crawler job среди выбранных им источников (персонализированный вид).

## План реализации

### 1. Инфраструктура
- `docker-compose.yml`: добавить `redis` (redis:7-alpine, хост-порт например 6380→6379) и
  `elasticsearch` (single-node, security отключён для локальной разработки), по образцу существующего
  сервиса `db` (именованный volume, healthcheck).
- `apps/api/.env(.example)`: добавить `REDIS_URL`, `ELASTICSEARCH_URL`, `MAX_VACANCY_AGE_DAYS`.
- `apps/api/package.json`: добавить `axios`, `cheerio`, `ioredis`, `@elastic/elasticsearch`.
  (`puppeteer` намеренно **не** добавляется — см. результат спайка выше.)

### 2. Схема Prisma
- `CrawlSource`: добавить `maxPagesPerRun Int @default(1)`. Новая миграция.
- Новых таблиц в Postgres нет — `CrawlerResult` живёт только в Elasticsearch.

### 3. `apps/api/src/crawler/` (новый модуль)
- `types.ts` — `RawVacancy { externalId, title, company, url, postedAt, sourceId }`,
  `CrawlStrategy { crawl(source: CrawlSource): Promise<RawVacancy[]> }`.
- `strategies/axiosCheerioStrategy.ts` — получает (через rate-limited/кэшированный fetcher ниже) до
  `source.maxPagesPerRun` страниц листинга, парсит с помощью подтверждённых выше селекторов.
- `index.ts` — `getStrategy(source): CrawlStrategy | null`, диспетчеризация по `source.type`, фактически
  резолвится в `AxiosCheerioStrategy` для единственного реализованного источника (`habr_career`);
  возвращает `null` (→ `WARN` + пропуск) для всего, для чего парсера ещё нет.
- `rateLimiter.ts` — Redis-based `waitForSlot(sourceId, delayMs)`: чтение/установка ключа с меткой
  времени `rate:source:{sourceId}`, ожидание оставшейся дельты при необходимости.
- `pageCache.ts` — `getOrFetch(sourceId, pageUrl, fetchFn)`: ключ Redis
  `page:raw:{sourceId}:{pageUrl-hash}`, короткий TTL (несколько минут), при попадании в кэш возвращает
  закэшированный HTML (при этом полностью пропуская rate limiter, поскольку нового запроса не
  происходит).
- `redisClient.ts` — единственный экземпляр `ioredis` из `REDIS_URL`, переиспользуется обоими файлами
  выше.

### 4. `apps/api/src/search/` (новый модуль, минимальный)
- `esClient.ts` — клиент `@elastic/elasticsearch` из `ELASTICSEARCH_URL`.
- `crawlerResultsIndex.ts` — константа имени индекса (`crawler_results`) + маппинг (`sourceId,
  externalId, title, company, url, postedAt, firstSeenAt, lastSeenAt`).
- `upsertVacancy.ts` — `upsert(raw: RawVacancy)`: id = `${sourceId}:${externalId}`,
  `doc_as_upsert` устанавливает `lastSeenAt: now` всегда, `firstSeenAt` только при вставке.
- `queryVacancies.ts` — две функции запросов, обе с фильтром по возрасту
  (`lastSeenAt >= now - MAX_VACANCY_AGE_DAYS`):
  - `queryVacanciesForSource(sourceId): Promise<CrawlerResultDoc[]>` — без фильтров, кроме возраста.
  - `queryVacanciesForJob(job: CrawlerJob): Promise<CrawlerResultDoc[]>` — то же самое, дополнительно
    отфильтровано по выбранным `sourceId` этого job и (если присутствует `job.keywords`) простым
    `match` по `title`/`company`.
  Это единственная "поисковая" поверхность в этом инкременте — ни фасетов, ни слоя Coveo пока нет.

### 5. Реальный раннер — заменяет `apps/api/src/crawler-jobs/crawler-jobs.runner.ts`
Сохраняет ту же самую экспортируемую сигнатуру и механику защиты от гонок, что и сегодняшний мок
(`startMockRun(jobId, sources)` / `stopMockRun(jobId)`, вызовы `updateMany` с условием по статусу,
записи `JobLog`), так что двум точкам вызова в `crawler-jobs.service.ts` не нужно менять форму — меняется
только тело мока на реальную логику:
- На каждый источник: `JobLog` "Starting crawl of {name}"; `getStrategy(source)` — если `null`,
  `JobLog` уровня `WARN` + переход к следующему источнику; иначе выполняются `waitForSlot` +
  `getOrFetch` + парсинг стратегией, `JobLog` "fetched page N (cache: hit/miss, M vacancies)", затем
  `upsertVacancy` по каждому элементу, `JobLog` "Found M vacancies for {name}".
- Работа по каждому источнику обёрнута в try/catch → `JobLog` уровня `ERROR` + переход к следующему
  источнику (падение одного источника не должно проваливать весь crawler job), а не прерывание работы.
- Эквивалент `stopMockRun`: тот же подход к совместной (cooperative) отмене — проверка флага "stopped"
  между `await`, максимально близко повторяя поведение очистки таймеров сегодняшнего решения средствами
  async/await.

### 6. Новые read-эндпоинты
- `GET /sources/:sourceId/vacancies` (новый маршрут/контроллер/сервисная функция рядом с
  `sources.routes.ts` → `sources.controller.ts` → `sources.service.ts`) — защищён аутентификацией,
  вызывает `queryVacanciesForSource`.
- `GET /crawler-jobs/:id/vacancies` (тот же слоистый подход, что и `crawler-jobs.routes.ts` →
  `crawler-jobs.controller.ts` → `crawler-jobs.service.ts`) — защищён аутентификацией, как и весь
  остальной `/crawler-jobs`, вызывает `queryVacanciesForJob`.
  В этом инкременте нет работы над UI (только API, проверяется точечно через curl/Postman), если только
  пользователь не захочет добавить быстрый список вакансий на страницу деталей crawler job — сначала
  нужно спросить, прежде чем строить UI.

## Проверка (вручную, согласно Testing Philosophy из `CLAUDE.md`)

- `docker compose up -d` — убедиться, что контейнеры `redis` и `elasticsearch` здоровы наряду с
  существующим `db`.
- `npx prisma migrate dev` для новой колонки `maxPagesPerRun`; повторно запустить сид.
- Создать Crawler Job с выбором `habr_career`, `POST /crawler-jobs/:id/start`, наблюдать, как записи
  `JobLog` (через UI Crawler Jobs или `GET /crawler-jobs/:id`) показывают реальный прогресс fetch/parse
  вместо фейковых сообщений таймера, убедиться, что `status` доходит до `COMPLETED`.
- `GET /crawler-jobs/:id/vacancies` возвращает реальные заголовки/компании/url вакансий с
  `career.habr.com`; `GET /sources/:sourceId/vacancies` (id для habr_career) возвращает те же исходные
  вакансии без фильтрации по ключевым словам.
- Запустить два crawler job подряд против `habr_career` в пределах TTL кэша — убедиться через `JobLog`,
  что второй показывает cache **hit** (без дублирующего исходящего запроса), и убедиться, что в ES нет
  дублирующихся документов (один и тот же `sourceId:externalId` повторно апсертится, `lastSeenAt`
  обновляется).
- Создать crawler job для нереализованного источника (например, RemoteOK) — убедиться, что он пишет
  `WARN` и всё равно доходит до `COMPLETED`, а не до `FAILED`.

## Шаги реализации

- [x] Добавить `redis`/`elasticsearch` в `docker-compose.yml`; добавить переменные окружения; добавить
      npm-зависимости.
- [x] Добавить миграцию для `CrawlSource.maxPagesPerRun`.
- [x] Собрать `apps/api/src/crawler/` (интерфейс стратегии, стратегия Axios/Cheerio, rate limiter,
      кэш страниц, клиент Redis).
- [x] Собрать `apps/api/src/search/` (клиент ES, маппинг индекса, upsert, функции запросов).
- [x] Заменить мок-раннер на реальный; сохранить сигнатуру/защиту от гонок без изменений.
- [x] Добавить два read-эндпоинта для вакансий.
- [x] Ручная проверка по чек-листу выше.
