# JWT — аутентификация пользователей

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: [`apps/api/src/auth/jwt.ts`](../../../apps/api/src/auth/jwt.ts),
[`apps/api/src/auth/auth.service.ts`](../../../apps/api/src/auth/auth.service.ts),
[`apps/api/src/auth/auth.middleware.ts`](../../../apps/api/src/auth/auth.middleware.ts)

JWT здесь закрывает ровно одну задачу — "кто залогинен" (аутентификация). Он **не** используется
для авторизации по ролям/владению ресурсами: краулинг и поиск — общая, не привязанная к
пользователю операция (см. Security Considerations в корневом `CLAUDE.md`), так что единственное,
что проверяет middleware — валидный ли токен вообще, без RBAC-проверок внутри него.

## Зачем именно JWT (а не серверные сессии)

Stateless-токен избавляет API от необходимости хранить состояние сессии где-либо (ни в памяти
процесса, ни в Redis, ни в Postgres) — сервер просто проверяет подпись токена на каждый запрос.
Для этого MVP это простейший рабочий вариант: нет отдельной таблицы/хранилища сессий, нет
инвалидации на сервере (logout — чисто клиентская операция, удаление токена из `localStorage`).
Плата за простоту — токен нельзя отозвать до истечения `exp`, но проект сознательно не строит
механизм отзыва, раз это учебный MVP без реальных требований безопасности продакшена.

## Что лежит в payload

→ [`jwt.ts#L1`](../../../apps/api/src/auth/jwt.ts#L1)

```ts
import jwt from "jsonwebtoken";

export interface JwtPayload {
  userId: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}
```

1. **Единственный claim — `userId`** (line 4). Никакой роли, email или прав доступа в токене нет —
   он отвечает только на вопрос "кто это", а не "что ему можно". `jsonwebtoken` сам добавляет
   стандартные `iat` (issued at) и `exp` (expiry) поверх этого payload.
2. **`getSecret()`** (line 7) — секрет читается из `process.env.JWT_SECRET` без fallback-значения:
   если переменная не задана, `sign`/`verify` падают с ошибкой сразу, а не тихо подписывают токен
   пустым/дефолтным секретом. Значение — в `apps/api/.env` (реальный секрет, не в git) и
   `apps/api/.env.example` (плейсхолдер `change-me-in-local-env`, для онбординга).
3. **`JWT_EXPIRES_IN` (по умолчанию `"7d"`)** (line 17) — время жизни токена, конфигурируется через
   env, не захардкожено. Для консоли внутреннего пользования 7 дней — разумный компромисс между
   удобством (не логиниться каждый день) и тем, что токен не отзывается вручную.

## Код: регистрация/логин

→ [`auth.service.ts#L24`](../../../apps/api/src/auth/auth.service.ts#L24)

```ts
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ApiError(409, "Email is already registered");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash },
  });

  return {
    accessToken: signToken({ userId: user.id }),
    user: toPublicUser(user),
  };
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid email or password");
  }

  return {
    accessToken: signToken({ userId: user.id }),
    user: toPublicUser(user),
  };
}
```

1. **Пароль никогда не хранится и не сравнивается в открытом виде** — `bcrypt.hash` (line 30) при
   регистрации, `bcrypt.compare` (line 47) при логине; `SALT_ROUNDS = 10` — стандартный компромисс
   между стойкостью и скоростью хеширования для bcrypt.
2. **Одинаковое сообщение об ошибке** для "нет такого email" и "неверный пароль" (оба —
   `"Invalid email or password"`, 401) — не даёт злоумышленнику через текст ошибки понять,
   существует ли аккаунт с данным email (user enumeration).
3. **`toPublicUser`** (line 20) явно отбирает поля (`id`, `email`, `name`), которые можно отдать
   клиенту — `passwordHash` в ответ API никогда не попадает, даже случайно через `...user`.
4. **`AuthResult`** (`{ accessToken, user }`) — единая форма ответа и для регистрации, и для
   логина: фронтенду не нужно различать эти два случая при сохранении токена/юзера в `entities/session`.

## Код: middleware, защищающий роуты

→ [`auth.middleware.ts#L12`](../../../apps/api/src/auth/auth.middleware.ts#L12)

```ts
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
```

1. **`declare global` расширяет express-овский `Request`** (lines 4-10) типом `userId?: string` —
   без этого TypeScript не разрешил бы писать `req.userId = ...` в контроллерах ниже по цепочке,
   не объявляя `any`.
2. **`Bearer <token>` парсится вручную** (line 14) — без сторонней библиотеки типа
   `express-jwt`, просто срез строки после префикса `"Bearer "`.
3. **`try/catch` вокруг `verifyToken`** — `jsonwebtoken` бросает исключение и на просроченный
   токен (`TokenExpiredError`), и на неверную подпись (`JsonWebTokenError`); middleware не
   различает эти случаи для клиента — оба возвращают одинаковый 401 `"Invalid or expired token"`.
4. **Подключение к роуту**
   (→ [`auth.routes.ts#L9`](../../../apps/api/src/auth/auth.routes.ts#L9)):
   `authRouter.get("/me", requireAuth, me)` — `requireAuth` вызывается как обычный Express
   middleware перед хендлером `me`; `/register` и `/login` его не используют (они создают токен, а
   не проверяют существующий).
