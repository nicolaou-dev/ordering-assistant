-- Up Migration

-- Per-shop storefront header: the cover image and tagline shown above the menu.
-- name already lives on shops; these complete the header so it's shop data, not
-- build-time env. loop_agent's table-level SELECT grant already covers new
-- columns, so the build-time read sees them with no extra grant.
ALTER TABLE shops
  ADD COLUMN cover_url TEXT,
  ADD COLUMN tagline   TEXT;

-- Down Migration

ALTER TABLE shops
  DROP COLUMN cover_url,
  DROP COLUMN tagline;
