# PostgreSQL / Prisma — операционные данные

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma)

PostgreSQL здесь — источник правды для **операционных** данных (кто есть пользователь, что за
запуск краула был и чем закончился), а не для самих вакансий — те живут в
[Elasticsearch](ELASTICSEARCH_SEARCH_INDEX.md) как пересобираемый индекс. Доступ идёт через
Prisma ORM: `schema.prisma` — единственный источник схемы, `prisma migrate` генерирует SQL-миграции
из него же, а TypeScript-типы (`CrawlRun`, `CrawlSource`, ...) генерируются автоматически и
импортируются из `@prisma/client` — модель описывается один раз, а не отдельно в SQL и отдельно в
коде.

## Данные в PostgreSQL

Users/CrawlRun/CrawlLog — это классические реляционные данные с чёткими связями и требованием
консистентности: у `CrawlLog` обязательно должен быть существующий `CrawlRun`, статус запуска
обновляется атомарно (см. `updateMany` с условием ниже), при удалении `CrawlRun` должны исчезнуть и
его логи. Это ровно то, для чего проектировались реляционные БД — внешние ключи, транзакции,
каскадное удаление "из коробки". Elasticsearch формально тоже может хранить такие данные, но не
умеет ни того, ни другого нативно — это чужая для него роль (поисковый индекс, не система
записи).

## Модели и связи

```prisma
model CrawlSource {
  id  Int  @id @default(autoincrement())
  // name, baseUrl, type, defaultDelayMs, maxPagesToCrawl, ...
  runs CrawlRun[]

  @@map("crawl_sources")
}

model CrawlRun {
  id       Int         @id @default(autoincrement())
  sourceId Int
  status   CrawlStatus @default(PENDING)

  source CrawlSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  logs   CrawlLog[]

  @@map("crawl_runs")
}

model CrawlLog {
  id    Int      @id @default(autoincrement())
  runId Int
  level LogLevel @default(INFO)

  run CrawlRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@map("crawl_logs")
}
```

(полные поля — в самом файле: [`schema.prisma#L21`](../../../apps/api/prisma/schema.prisma#L21)
для `CrawlSource`, [`#L43`](../../../apps/api/prisma/schema.prisma#L43) для `CrawlRun`,
[`#L67`](../../../apps/api/prisma/schema.prisma#L67) для `CrawlLog`)

| Модель        | Назначение                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `User`        | Аутентификация (email, хэш пароля) — единственная модель без связи с краулингом (см. ниже, "почему") |
| `CrawlSource` | Сидированный источник (Habr Career, RemoteOK, ...) — конфиг краулинга, не результат                  |
| `CrawlRun`    | Один запуск краула одного источника: статус, таймстемпы, найдено вакансий                            |
| `CrawlLog`    | Строки лога одного `CrawlRun`, с уровнем (`INFO`/`WARN`/`ERROR`)                                     |

`onDelete: Cascade` на обеих связях (`CrawlRun.source`, `CrawlLog.run`) — удаление `CrawlSource`
автоматически удаляет все его `CrawlRun`, а удаление `CrawlRun` — все его `CrawlLog`, силами самой
БД (foreign key constraint), а не отдельным кодом на стороне приложения, который легко забыть
вызвать в одном из мест.

`@@map("crawl_runs")` и т.п. — реальное имя таблицы в Postgres отличается от имени Prisma-модели
(snake_case вместо PascalCase) — стандартная SQL-конвенция именования таблиц, `@@map` разводит имя
модели в коде (`prisma.crawlRun`) и имя таблицы в БД (`crawl_runs`).

`User` осознанно не связан ни с `CrawlSource`, ни с `CrawlRun` — краулинг здесь общий, не
принадлежит пользователю (см. `CLAUDE.md` → Security Considerations): любой залогиненный
пользователь может запустить/остановить краул любого источника, поэтому у `CrawlRun` нет и не
должно быть `userId`.

## Код: запуск краула — создание `CrawlRun`

→ [`sources.service.ts#L39`](../../../apps/api/src/sources/sources.service.ts#L39)

```ts
import { prisma } from '../config/prisma.js';
import {
  isSourceCrawling,
  reserveCrawlSlot,
  releaseCrawlSlot,
} from '../crawler/crawlRunner.js';
import { ApiError } from '../utils/errors.js';

export async function startSourceCrawl(id: number): Promise<CrawlRun> {
  if (isSourceCrawling(id)) {
    throw new ApiError(400, 'A crawl is already running for this source');
  }
  reserveCrawlSlot(id);

  try {
    const source = await getSourceById(id);
    const run = await prisma.crawlRun.create({
      data: { sourceId: id, status: 'RUNNING', startedAt: new Date() },
    });

    executeCrawlRun(run, source).catch((error: unknown) => {
      logger.error(`Unhandled error in crawl run ${run.id}: ${String(error)}`);
    });

    return run;
  } catch (error) {
    releaseCrawlSlot(id);
    throw error;
  }
}
```

1. **`isSourceCrawling(id)` + `reserveCrawlSlot(id)`** — гонка "два одновременных запроса на
   краул одного источника" закрывается синхронным JS-кодом (in-memory `Map`, не Postgres) до
   первого `await` — Postgres тут вообще не участвует в этой части защиты, см.
   [REDIS.md](REDIS_RATE_LIMIT_CACHE.md) и `crawlRunner.ts` про то, почему это не Redis-ключ.
2. **`prisma.crawlRun.create`** — сама запись создаётся сразу в статусе `RUNNING`, а не
   `PENDING` → `RUNNING` двумя записями: реальная работа (`executeCrawlRun`) стартует
   fire-and-forget сразу следующей строкой, так что "PENDING" не отражал бы никакого реального
   промежуточного состояния.
3. **`executeCrawlRun(run, source).catch(...)`** — вызов не через `await`: HTTP-ответ должен
   вернуться сразу (краул может идти минутами из-за rate limiting), а фронтенд опрашивает
   `GET /sources/:id/run`, пока статус `RUNNING`.
4. **`catch { releaseCrawlSlot(id); throw error; }`** — если `prisma.crawlRun.create` упал (например,
   БД недоступна), слот обязательно освобождается — иначе источник навсегда "завис" бы в
   состоянии "краулится", хотя ни один краул реально не идёт.

## Код: остановка — атомарный `updateMany` с условием

→ [`sources.service.ts#L65`](../../../apps/api/src/sources/sources.service.ts#L65)

```ts
export async function stopSourceCrawl(id: number): Promise<CrawlRun> {
  const run = await prisma.crawlRun.findFirst({
    where: { sourceId: id, status: 'RUNNING' },
    orderBy: { id: 'desc' },
  });
  if (!run) {
    throw new ApiError(400, 'No crawl is running for this source');
  }

  stopCrawlRun(id); // in-memory: сигнал "cancelled" для executeCrawlRun

  const { count } = await prisma.crawlRun.updateMany({
    where: { id: run.id, status: 'RUNNING' },
    data: { status: 'STOPPED', finishedAt: new Date() },
  });
  if (count === 0) {
    throw new ApiError(400, 'No crawl is running for this source');
  }

  await prisma.crawlLog.create({
    data: { runId: run.id, message: 'Stopped by user' },
  });
  return prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } });
}
```

1. **`updateMany({ where: { id: run.id, status: "RUNNING" }, ... })`** — ключевой паттерн:
   условие на `status: "RUNNING"` прямо в `WHERE`, а не отдельное `if` после чтения строки.
   Между `findFirst` выше и этим `updateMany` краул мог сам успеть завершиться (`executeCrawlRun`
   параллельно пишет `status: "COMPLETED"`) — без условия в `WHERE` этот запрос переписал бы уже
   завершённый прогон обратно в `STOPPED`, что было бы неверно. Postgres здесь гарантирует: если
   между чтением и записью статус успел смениться, `count` будет `0`, и код это замечает — того
   же паттерна `updateMany` с условием придерживается и сам `executeCrawlRun`, завершая прогон
   (см. `crawlRunner.ts`).
2. **`count === 0` → `ApiError`** — а не "тихо считать успехом": ноль обновлённых строк означает,
   что запрос пришёл слишком поздно (краул уже сам закончился), и это иная ситуация для клиента,
   чем "успешно остановили".
3. **Порядок**: `stopCrawlRun(id)` (in-memory сигнал) идёт **до** `updateMany` — оба должны
   произойти, но именно in-memory-флаг — то, что реально прерывает выполняющийся цикл в
   `executeCrawlRun` между итерациями; `updateMany` лишь фиксирует финальный статус в БД для
   всех, кто его читает (фронтенд через polling, история прогонов).

## Миграции и сид

```bash
npm run --workspace apps/api prisma:migrate
npm run --workspace apps/api prisma:seed
```

`prisma:migrate` применяет SQL-миграции из `apps/api/prisma/migrations/`, сгенерированные из
`schema.prisma`; `prisma:seed` ([`prisma/seed.ts`](../../../apps/api/prisma/seed.ts)) наполняет
`crawl_sources` предопределёнными источниками (Habr Career, RemoteOK, WeWorkRemotely,
Craigslist) — единственные строки, которые нужны, чтобы приложение вообще заработало "из коробки"
(без них страница Sources пуста, крутить краул нечего).
