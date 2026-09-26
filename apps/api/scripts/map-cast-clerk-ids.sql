-- DEVELOPMENT-ONLY cast mapping script — LOCAL USE ONLY.
--
-- Maps the four seeded cast users to their real Clerk Development-instance
-- identities. These Clerk IDs are DEVELOPMENT test users, not secrets; the
-- API requires a matching CLERK_SECRET_KEY to actually verify their sessions
-- (see README "Demo guide").
--
-- The four seeded users already exist from `npm run db:seed` with a reserved
-- development-only placeholder `clerk_user_id`:
--
--     jashim@example.com  -> user_3Jroqu6ifJ8mIwAr1YpAWWeML55  (DRIVER)
--     nusrat@example.com  -> user_3Jrp8VfxgX9DjGzFdigu7Lt8NMZ  (PASSENGER)
--     rafiq@example.com   -> user_3JrpI2N1BkmehAJARJBnN0xnCYD  (PASSENGER)
--     shirin@example.com  -> user_3JrpPjCrLYsAnU1c43AdHgXyfym  (PASSENGER)
--
-- Rules honored here:
--   * Only `clerk_user_id` is updated, on the exact existing seeded rows.
--   * Roles are preserved exactly (Jashim = DRIVER; Nusrat / Rafiq / Shirin =
--     PASSENGER). No email-based role assignment.
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