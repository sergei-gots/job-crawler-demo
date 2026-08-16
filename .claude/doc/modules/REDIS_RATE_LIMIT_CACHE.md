# Redis — rate limiting и page cache

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/crawler/rateLimiter.ts`](../../../apps/api/src/crawler/rateLimiter.ts),
[`apps/api/src/crawler/pageCache.ts`](../../../apps/api/src/crawler/pageCache.ts)

Redis в проекте закрывает ровно два независимых юзкейса — оба эфемерные (не жалко потерять при
рестарте), оба нужны именно как **общий** (shared) стейт между процессами, а не переменная в
памяти одного процесса:

1. **Rate limiter** — не долбить сайт-источник чаще, чем раз в `defaultDelayMs`.
2. **Page cache** — не запрашивать повторно один и тот же URL в течение часа.

## Зачем именно Redis (а не переменная в памяти / Postgres)

`setTimeout`/обычная переменная процесса работала бы только в рамках одного Node-процесса. Если
краул одного источника случайно инициируют две параллельные джобы (или два инстанса API за
балансировщиком) — у каждой была бы своя, не связанная с другой, пауза, и сайт-источник получил бы
запросы чаще, чем задумано. Redis — отдельный сервис, поэтому оба его ключа (`rate:source:{id}`,
`page:raw:{id}:{hash}`) видны всем процессам одинаково. Postgres тут не подошёл бы просто из-за
характера данных: это TTL-истекающие ключи (Redis `EX`/`PX` — TTL на уровне самого хранилища), а
не записи, которые нужно хранить бессрочно и с историей, как `CrawlRun`/`CrawlLog` — см.
[POSTGRESQL_PRISMA_MODELS.md](POSTGRESQL_PRISMA_MODELS.md).

## Важный нюанс: чего в Redis **нет**

Конкурентный guard "не больше одного активного краула на источник одновременно" и флаг отмены
(`stopCrawlRun`) — **не** в Redis, а в обычном in-memory `Map` в
[`crawlRunner.ts#L13`](../../../apps/api/src/crawler/crawlRunner.ts#L13):

```ts
interface RunState {
  cancelled: boolean;
}

// Keyed by sourceId, not runId — crawling is per-source and at most one run is active per
// source at a time (see reserveCrawlSlot).
const activeRuns = new Map<number, RunState>();

export function reserveCrawlSlot(sourceId: number): void {
  activeRuns.set(sourceId, { cancelled: false });
}
```

Это сознательный выбор, а не недосмотр: `reserveCrawlSlot` должен сработать *синхронно*, без
единого `await` между проверкой `isSourceCrawling` и резервированием слота, чтобы Node-овский
однопоточный event loop гарантированно не прервал эту пару вызовов другим запросом посередине —
поход в Redis по сети всегда асинхронный (`await redis.set(...)`), а значит между проверкой и
записью открылось бы окно для той самой гонки, которую слот должен закрывать. Раз в этом проекте
один API-процесс, синхронная `Map` даёт более сильную гарантию, чем Redis дал бы здесь. Плата за
это: слот не переживёт рестарт процесса (при живом Redis-ключе пережил бы) — для одного
dev-процесса это не проблема.

## Код: rate limiter

→ [`rateLimiter.ts#L12`](../../../apps/api/src/crawler/rateLimiter.ts#L12)

```ts
import { redis } from "./redisClient.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSlot(sourceId: number, delayMs: number): Promise<void> {
  const key = `rate:source:${sourceId}`;
  const lastFetchedAt = await redis.get(key);

  if (lastFetchedAt) {
    const elapsed = Date.now() - Number(lastFetchedAt);
    const remaining = delayMs - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
  }

  await redis.set(key, Date.now().toString(), "PX", delayMs);
}
```

1. **Один ключ на источник** (`rate:source:{sourceId}`) хранит timestamp последнего запроса к
   этому источнику — общий для листинга и всех детальных запросов в рамках краула (см. разбор
   листинг+детали в [AXIOS_CHEERIO_HABR_STRATEGY.md](AXIOS_CHEERIO_HABR_STRATEGY.md)).
2. **`elapsed`/`remaining`** — если с прошлого запроса прошло меньше `delayMs`, функция реально
   ждёт оставшееся время через `await sleep(remaining)`, приостанавливая краул.
3. **`redis.set(key, ..., "PX", delayMs)`** — `PX delayMs` это TTL самого ключа в Redis
   (в миллисекундах): ключ сам исчезнет ровно через `delayMs`, если никто не перезапишет его
   раньше — подстраховка от накопления "мёртвых" ключей для источников, которые давно не
   краулились, а не часть основной логики паузы (та считается по разнице timestamp'ов).
4. **Общий для конкурентных вызовов**: если два краула одновременно обращаются к одному
   источнику, оба читают/пишут один и тот же Redis-ключ — фактические запросы к сайту всё равно
   окажутся разнесены минимум на `delayMs`. Полный построчный разбор — в
   [PUPPETEER_REMOTEOK_STRATEGY.md](PUPPETEER_REMOTEOK_STRATEGY.md#код-получение-html) (там же,
   где этот вызов используется на практике).

## Код: page cache

→ [`pageCache.ts#L20`](../../../apps/api/src/crawler/pageCache.ts#L20)

```ts
import { createHash } from "node:crypto";
import { redis } from "./redisClient.js";

const PAGE_CACHE_TTL_SECONDS = 3600;

export async function getOrFetch(
  sourceId: number,
  pageUrl: string,
  fetchFn: () => Promise<string>,
): Promise<{ html: string; cacheHit: boolean }> {
  const urlHash = createHash("sha1").update(pageUrl).digest("hex");
  const key = `page:raw:${sourceId}:${urlHash}`;

  const cached = await redis.get(key);
  if (cached !== null) {
    return { html: cached, cacheHit: true };
  }

  const html = await fetchFn();
  await redis.set(key, html, "EX", PAGE_CACHE_TTL_SECONDS);
  return { html, cacheHit: false };
}
```

1. **`sha1(pageUrl)` в ключе** — URL может быть длинным/содержать спецсимволы, хэш даёт
   компактный и безопасный для Redis-ключа идентификатор конкретной страницы; ключ дополнительно
   включает `sourceId`, так что кэш листинга источника A не пересечётся с кэшем источника B, даже
   если бы (гипотетически) у них совпал URL.
2. **`cached !== null` → возврат без вызова `fetchFn`** — при попадании в кэш реальный HTTP/
   Puppeteer-запрос вообще не выполняется, а значит и `waitForSlot` (rate limiter) тоже не
   вызывается для этого URL — кэш-хит не тратит "бюджет" вежливой паузы к источнику.
3. **`EX PAGE_CACHE_TTL_SECONDS` (1 час)** — обычный TTL Redis, не логика приложения: столько
   времени хватает на полный прогон `habr_career` (листинг + все детальные страницы, ~15 минут
   при сидированной паузе 12с), но не настолько много, чтобы данные заметно устарели.
4. **`cacheHit` в возвращаемом значении** — используется только для логирования в `CrawlLog`
   ("почему этот прогон был подозрительно быстрым" — см. `README.md` → "Why a run sometimes shows
   `cache: miss`"), не влияет на дальнейшую обработку HTML.

## Очистка Redis: admin-действие "Clear cache"

→ [`admin.service.ts#L47`](../../../apps/api/src/admin/admin.service.ts#L47)

```ts
import { redis } from "../crawler/redisClient.js";

export async function clearCache(): Promise<void> {
  await redis.flushdb();
}
```

`flushdb()` безопасен в любой момент: оба юзкейса Redis здесь — чистый кэш (rate limiter и page
cache), очистка не теряет никаких данных, которые нельзя было бы просто заново получить —
следующий краул либо перетерпит небольшую паузу заново, либо перезапросит страницу вместо
кэш-хита. Redis-инстанс в этом проекте — отдельный выделенный Docker-контейнер только для этого
приложения (см. `docker-compose.yml`), так что `flushdb` не может задеть чужие данные.
