# FEATURE: Управление источниками и профиль пользователя

*Перевод на русский для презентации. Исходник: [английская версия](../01_FEATURE_SOURCES_AND_JOBS.md).*

## Обзор

Этот документ изначально (Increment 1) описывал сущность `CrawlerJob` — CRUD над персональными,
фильтруемыми по ключевым словам заданиями краула, работавшими через mock-раннер. Этот дизайн был
полностью заменён в Increment 3: краулинг теперь выполняется напрямую над `CrawlSource`
(`CrawlRun`, а не `CrawlerJob`), а фильтрация по ключевым словам переехала на страницу Search. См.
`03_FEATURE_CRAWL_SEARCH_SEPARATION.md` — этот редизайн и его обоснование.

Документ намеренно короткий и описывает только текущее состояние: что пользователь реально может
делать сегодня с источниками и со своим аккаунтом. Здесь сознательно не повторяются
задел-на-будущее или списки отложенной работы — они живут в тех инкрементных документах, которые
их фактически реализовали (`02_FEATURE_REAL_CRAWLER_REDIS_ES.md`,
`02b_FEATURE_VACANCY_DETAIL_CRAWL.md`, `03_FEATURE_CRAWL_SEARCH_SEPARATION.md`,
`04_FEATURE_PUPPETEER_REMOTEOK.md`).

## Статус: реализовано

### Источники и краулинг

- `CrawlSource` (Prisma/PostgreSQL) — засеян, не создаётся пользователем
  (`apps/api/prisma/seed.ts`).
- `GET /sources`, `GET /sources/:id` — список/детали.
- `POST /sources/:id/crawl`, `POST /sources/:id/crawl/stop` — старт/остановка краула одного
  источника.
- `POST /sources/crawl-all` — запускает краул для каждого источника, у которого есть
  `CrawlStrategy`.
- `GET /sources/:id/run` — последний `CrawlRun` для источника, включая его `CrawlLog[]`.
- `GET /sources/:id/vacancies` — вакансии, собранные для этого источника.
- Краулинг — общая, не привязанная к пользователю операция: любой залогиненный пользователь может
  запустить/остановить краул любого источника (см. Security Considerations в `CLAUDE.md`).
- Реальный краулинг (Axios+Cheerio для `habr_career`, Puppeteer для `remoteok`) реализован через
  `CrawlStrategy` — см. `02_FEATURE_REAL_CRAWLER_REDIS_ES.md` и `04_FEATURE_PUPPETEER_REMOTEOK.md`.

### Профиль пользователя

Не был описан ни в одном более раннем feature-документе — задокументирован здесь впервые:

- `PATCH /users/me` — обновление `name`/`email`, требует `currentPassword` в теле запроса для
  подтверждения изменения (`apps/api/src/users/users.controller.ts` → `updateProfile` в
  `users.service.ts`).
- `PATCH /users/me/password` — смена пароля, требует `currentPassword` (`changePassword` в
  `users.service.ts`).
- Frontend: страница `/profile` (`apps/web/widgets/profile/ui/profile-page.tsx`) — карточка
  "Account details" (`UpdateProfileForm`) и отдельная карточка "Change password"
  (`ChangePasswordForm`), согласно UI Design Guidelines из `CLAUDE.md` (раздельные карточки, а не
  разделитель-линия).
- **Не реализовано**: удаление аккаунта — нет ни эндпоинта `DELETE /users/me`, ни UI для этого.
  Зарегистрированный пользователь не имеет возможности удалить свой аккаунт.

## Технологический стек

Не отличается от остальной части проекта — см. `TECH_STACK_OVERVIEW.md` /
`.claude/doc/TECH_STACK_OVERVIEW.md`. Не повторяется здесь, поскольку идентичен для каждого
feature-документа в этом проекте.
