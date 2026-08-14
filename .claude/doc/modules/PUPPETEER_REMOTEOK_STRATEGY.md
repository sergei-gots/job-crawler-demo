# Puppeteer / RemoteOK Strategy

← назад к [макро-обзору стека](../TECH_STACK_OVERVIEW.md)

Файл: `apps/api/src/crawler/strategies/remoteOkStrategy.ts`

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
JSON-LD блоком:

```html
<tr class="job" data-id="111" data-href="/remote-jobs/foo-111"
    data-company="Acme Remote" data-epoch="1700000000">
  <td><h2>Senior Backend Engineer</h2></td>
  <td class="tags">
    <span class="tag">React</span>
    <span class="tag">Node</span>
  </td>
  <script type="application/ld+json">
    {"@context":"http://schema.org","@type":"JobPosting","description":"<p>Great backend role.</p>"}
  </script>
</tr>
```

Откуда берутся поля `RawVacancy`:

| Поле | Источник в HTML |
|---|---|
| `externalId` | `data-id` |
| `url` | `data-href` |
| `title` | текст `<h2>` |
| `company` | `data-company` |
| `postedAt` | `data-epoch` (unix-время) |
| `skillsSummary` | `.tags .tag`, дедуплицированы (десктоп + мобильная вёрстка дублируют теги) |
| `description` | `description` из JSON-LD (при невалидном JSON — `null`) |
| `isRemote` | `true` (захардкожено — источник целиком remote) |

`baseSalary`, `jobLocationType`, `jobLocation` из JSON-LD не сохраняются — это одинаковый
boilerplate на всех строках (SEO-разметка для Google Jobs), не реальные данные вакансии.

## Код: получение HTML

```ts
const { html, cacheHit } = await getOrFetch(source.id, pageUrl, async () => {
  await waitForSlot(source.id, source.defaultDelayMs);
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
    return await page.content();
  } finally {
    await browser.close();
  }
});
```

1. `getOrFetch` — Redis-кэш страницы, чтобы не запрашивать сайт повторно.
2. `waitForSlot` — rate limiter (Redis), уважает `defaultDelayMs` источника.
3. `puppeteer.launch({ headless: true })` — один браузер на весь `crawl()`, не на страницу.
4. `page.setUserAgent(USER_AGENT)` — подмена UA на настоящий десктопный Chrome (Puppeteer по
   умолчанию отдаёт UA с "HeadlessChrome").
5. `page.goto(..., { waitUntil: "networkidle2" })` — ждём, пока сетевая активность утихнет,
   чтобы JS успел дорендерить контент.
6. `page.content()` — отрендеренный HTML идёт дальше в `parseListingPage` (Cheerio).
7. `finally { browser.close() }` — гарантированное закрытие браузера, иначе процессы
   Chromium утекают.

## Парсинг: Cheerio по уже полученному HTML

```ts
$("tr.job").each((_, el) => {
  const row = $(el);
  const externalId = row.attr("data-id");
  const href = row.attr("data-href") || row.attr("data-url");
  const title = row.find("h2").first().text().trim();
  if (!externalId || !href || !title) return;
  // ...
});
```

Пагинации нет — обходится только `/remote-dev-jobs` один раз за запуск (проверено вручную:
`?page=2` возвращает те же строки, "load more" идёт через AJAX-эндпоинт, запрещённый
`robots.txt`).
