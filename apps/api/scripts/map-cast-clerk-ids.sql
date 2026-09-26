-- DEVELOPMENT-ONLY cast mapping script — LOCAL USE ONLY.
--
-- Maps the seven seeded cast users to their real Clerk Development-instance
-- identities. These Clerk IDs are DEVELOPMENT test users, not secrets; the
-- API requires a matching CLERK_SECRET_KEY to actually verify their sessions
-- (see README "Demo guide").
--
-- The seven seeded users already exist from `npm run db:seed` with a reserved
-- development-only placeholder `clerk_user_id`:
--
--     jashim@example.com  -> user_3Jroqu6ifJ8mIwAr1YpAWWeML55  (DRIVER)
--     nusrat@example.com  -> user_3Jrp8VfxgX9DjGzFdigu7Lt8NMZ  (PASSENGER)
--     rafiq@example.com   -> user_3JrpI2N1BkmehAJARJBnN0xnCYD  (PASSENGER)
--     shirin@example.com  -> user_3JrpPjCrLYsAnU1c43AdHgXyfym  (PASSENGER)
--     karim@example.com   -> user_3JsuX5lm7Q2ixSpBiQHtx4hOvga  (DRIVER)
--     rahim@example.com   -> user_3JsuehztHx6S20sAySc0KULgaW9  (DRIVER)
--     faruq@example.com   -> user_3JsumamjGPqoMEylzr6svfvDFZ7  (DRIVER)
--
-- Rules honored here:
--   * Only `clerk_user_id` is updated, on the exact existing seeded rows.
--   * Roles are preserved exactly (Jashim / Karim / Rahim / Faruq = DRIVER;
--     Nusrat / Rafiq / Shirin = PASSENGER). No email-based role assignment.
--   * The `clerk_user_id LIKE 'dev-only::seed::%'` guard means a row that has
--     already been mapped to a real Clerk identity — or was provisioned by a
--     genuine first authenticated request (ADR-014) — is NEVER overwritten.
--   * Idempotent: safe to run repeatedly (second run is a no-op).
--
-- Run from the repository root against the compose database:
--
--     docker compose exec -T db psql -U postgres -d dhaka_tesla_pool -f - `
--       < apps/api/scripts/map-cast-clerk-ids.sql
--
-- (PowerShell uses the backtick for line continuation; on bash the same works
-- without it.)
--
-- Sanity check afterwards:
--
--     docker compose exec db psql -U postgres -d dhaka_tesla_pool -c `
--       "SELECT name, email, role, clerk_user_id FROM users ORDER BY email;"

UPDATE users
SET clerk_user_id = 'user_3Jroqu6ifJ8mIwAr1YpAWWeML55'
WHERE email = 'jashim@example.com'
  AND clerk_user_id LIKE 'dev-only::seed::%';

UPDATE users
SET clerk_user_id = 'user_3Jrp8VfxgX9DjGzFdigu7Lt8NMZ'
WHERE email = 'nusrat@example.com'
  AND clerk_user_id LIKE 'dev-only::seed::%';

UPDATE users
SET clerk_user_id = 'user_3JrpI2N1BkmehAJARJBnN0xnCYD'
WHERE email = 'rafiq@example.com'
  AND clerk_user_id LIKE 'dev-only::seed::%';

UPDATE users
SET clerk_user_id = 'user_3JrpPjCrLYsAnU1c43AdHgXyfym'
WHERE email = 'shirin@example.com'
  AND clerk_user_id LIKE 'dev-only::seed::%';

UPDATE users
SET clerk_user_id = 'user_3JsuX5lm7Q2ixSpBiQHtx4hOvga'
WHERE email = 'karim@example.com'
  AND clerk_user_id LIKE 'dev-only::seed::%';

UPDATE users
SET clerk_user_id = 'user_3JsuehztHx6S20sAySc0KULgaW9'
WHERE email = 'rahim@example.com'
  AND clerk_user_id LIKE 'dev-only::seed::%';

UPDATE users
SET clerk_user_id = 'user_3JsumamjGPqoMEylzr6svfvDFZ7'
WHERE email = 'faruq@example.com'
  AND clerk_user_id LIKE 'dev-only::seed::%';