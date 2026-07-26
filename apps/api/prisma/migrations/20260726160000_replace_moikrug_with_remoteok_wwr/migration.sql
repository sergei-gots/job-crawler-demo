-- moikrug.ru now permanently redirects (301, both robots.txt and the site itself) to
-- career.habr.com — Habr absorbed it, so it is no longer a distinct crawl target. Replaced with
-- RemoteOK and WeWorkRemotely, verified by hand:
--   - RemoteOK: robots.txt advertises Crawl-delay: 1 and looks permissive, but the site actively
--     403s plain (non-browser) requests via Cloudflare — treated as DYNAMIC (needs a real
--     browser/Puppeteer to get past the bot check, not just to render JS).
--   - WeWorkRemotely: robots.txt is `Allow: /` aside from account/admin paths, and job listings
--     are confirmed server-rendered on a manual fetch — STATIC.
DELETE FROM "crawl_sources" WHERE "name" = 'Moikrug';

INSERT INTO "crawl_sources" ("name", "baseUrl", "type", "isActive", "respectRobotsTxt", "defaultDelayMs", "createdAt", "updatedAt")
VALUES
  ('RemoteOK', 'https://remoteok.com', 'DYNAMIC', true, true, 11000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('WeWorkRemotely', 'https://weworkremotely.com', 'STATIC', true, true, 11000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
