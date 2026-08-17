# Winston — структурированное логирование

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/config/logger.ts`](../../../apps/api/src/config/logger.ts)

## Зачем именно Winston (а не `console.log`)

Один настроенный логгер вместо разбросанных по коду `console.log`/`console.error` даёт три вещи
сразу: единый формат строки (таймстемп + уровень + сообщение) для всех логов процесса, управляемый
через env уровень логирования (можно приглушить `debug`/`info` в проде, оставив только `warn`/
`error`, не трогая код), и единую точку, куда в будущем можно добавить второй transport (файл,
внешний лог-агрегатор) не меняя вызовы `logger.info(...)` по всему коду.

## Код: настройка логгера

→ [`logger.ts`](../../../apps/api/src/config/logger.ts) (файл целиком, 10 строк)

```ts
import winston from "winston";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`),
  ),
  transports: [new winston.transports.Console()],
});
```

1. **`level: process.env.LOG_LEVEL ?? "info"`** — уровень логирования конфигурируется через env,
   не захардкожен; по умолчанию `"info"` (то есть `debug`-уровневые вызовы, если бы они где-то
   были, молчат, пока `LOG_LEVEL=debug` явно не выставлен).
2. **`format.combine(timestamp(), printf(...))`** — итоговый формат строки:
   `2026-08-17T10:15:00.000Z [info] API listening on http://localhost:4000`. Это **не** JSON-формат
   (`format.json()` не используется) — несмотря на заголовок "структурированное логирование" в
   README/CLAUDE.md, здесь это про наличие единого формата и уровня, а не про машинно-парсимый
   вывод. Для MVP с единственным Console-транспортом читаемая человеком строка важнее, чем JSON,
   который потом никто не парсит (нет ELK/агрегатора логов, подключенного к этому выводу).
3. **`transports: [new winston.transports.Console()]`** — единственный transport. Winston
   поддерживает несколько одновременно (файл, HTTP-эндпоинт, сторонние сервисы) — сейчас
   подключён только stdout/stderr консоли, куда естественно смотрит `docker compose logs`/терминал
   разработчика в dev-режиме.

## Где используется: два разных уровня логов, которые не стоит путать

В проекте два параллельных, независимых "лога":

- **Winston (`logger`)** — процессные/операционные логи: старт сервера, ошибки на уровне API,
  проблемы с ES-индексом. Живёт только в stdout, ничего не пишет в базу, теряется при рестарте
  процесса (кроме того, что попало в терминал/docker logs).
- **`CrawlLog` (Postgres)** — пользовательский аудит-трейл конкретного `CrawlRun`, который видно
  на странице Source detail в UI (см. `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`).
  Это не Winston, а обычная запись через Prisma
  (→ [`crawlRunner.ts#L53`](../../../apps/api/src/crawler/crawlRunner.ts#L53)):
  ```ts
  await prisma.crawlLog.create({ data: { runId, message } });
  await prisma.crawlLog.create({ data: { runId, level: "WARN", message } });
  await prisma.crawlLog.create({ data: { runId, level: "ERROR", message } });
  ```

Оба пишутся из одного и того же `crawlRunner.ts` рядом друг с другом, но отвечают на разные
вопросы: Winston — "что вообще происходило с процессом API" (для разработчика/оператора), `CrawlLog`
— "что произошло с конкретным запуском краула источника X" (для пользователя в UI).

## Примеры реальных вызовов `logger`

→ [`index.ts#L28`](../../../apps/api/src/index.ts#L28) — старт сервера:

```ts
app.listen(port, () => {
  logger.info(`API listening on http://localhost:${port}`);
});
```

→ [`crawlerResultsIndex.ts#L119`](../../../apps/api/src/search/crawlerResultsIndex.ts#L119) —
несовпадение версии схемы ES-индекса (см.
[ELASTICSEARCH_SEARCH_INDEX.md](ELASTICSEARCH_SEARCH_INDEX.md)):

```ts
logger.warn(
  `[search] crawler_results schema version ${liveVersion ?? "unversioned"} != ` +
    `${CRAWLER_RESULTS_SCHEMA_VERSION}; rebuilding index. Crawl history and DB records are ` +
    `untouched — re-crawl (per source or "crawl all") to repopulate search data.`,
);
```

→ [`crawlRunner.ts#L138`](../../../apps/api/src/crawler/crawlRunner.ts#L138) — упавший краул:

```ts
logger.error(`Failed to crawl source ${source.name} (run ${run.id}): ${String(error)}`);
```

→ [`utils/errors.ts#L14`](../../../apps/api/src/utils/errors.ts#L14) — общий helper для
неожиданных ошибок в контроллерах, переиспользуемый и в auth (`auth.controller.ts`'s
`handleAuthError`), и в других модулях:

```ts
export function handleError(res: Response, error: unknown, context: string): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(`Unexpected ${context} error: ${String(error)}`);
  res.status(500).json({ error: "Internal server error" });
}
```

Практический вывод из этого паттерна: **ожидаемые** ошибки (`ApiError` — валидация, конфликт,
401/404 и т.п.) в Winston вообще не попадают, только в HTTP-ответ клиенту — `logger.error`
вызывается только для **неожиданных** ошибок (`else`-ветка), то есть Winston-лог уровня `error`
почти всегда сигнализирует о реальном баге/непредвиденном сбое, а не о штатной бизнес-ошибке
(типа "email уже зарегистрирован").
