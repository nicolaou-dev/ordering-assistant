-- Up Migration

CREATE TABLE shops (
  phone_number_id TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  product_id  TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(phone_number_id),
  category    TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  price_minor INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  image_url   TEXT,
  in_stock    BOOLEAN NOT NULL DEFAULT true,
  deleted_at  TIMESTAMPTZ,
  search      tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(category, '')
    )
  ) STORED
);

CREATE INDEX idx_products_shop ON products (shop_id);
CREATE INDEX idx_products_search ON products USING GIN (search);

-- Row-level security. ENABLE turns the policies on; FORCE additionally removes
-- the table owner's built-in RLS exemption. (A role with the BYPASSRLS
-- attribute still bypasses regardless of FORCE -- which is why the Worker's
-- agent path uses loop_agent, which has no BYPASSRLS.) The policy keys off a
-- per-transaction GUC set with set_config('app.shop_id', <id>, true); the
-- two-arg current_setting returns NULL when unset, so an unscoped query sees
-- zero rows instead of erroring.
ALTER TABLE shops    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops    FORCE  ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE  ROW LEVEL SECURITY;

CREATE POLICY shop_isolation ON shops
  USING (phone_number_id = current_setting('app.shop_id', true));

CREATE POLICY shop_isolation ON products
  USING (shop_id = current_setting('app.shop_id', true));

-- loop_agent (created once via db/role.sql) is read-only: the agent queries
-- the catalog but never mutates it. Catalog writes (ingest) connect as the
-- admin role, under their own ticket.
GRANT USAGE ON SCHEMA public TO loop_agent;
GRANT SELECT ON shops, products TO loop_agent;

-- Down Migration

DROP TABLE products;
DROP TABLE shops;
