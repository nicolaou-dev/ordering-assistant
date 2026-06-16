-- Up Migration

-- A submitted order. The draft lives in the DO until the customer confirms, so
-- a row appears here only at submit_order time, already past pending_approval's
-- predecessor (there is no draft status). status walks the seller's fulfilment
-- lifecycle; transitions and approval are a later ticket. Address fields are
-- inline and NULL for pickup (no customers table / FK yet — phone stored
-- inline). idempotency_key is derived from the DO + draft so a retried
-- submit_order collapses to one row via the UNIQUE constraint.
CREATE TABLE orders (
  order_id          TEXT PRIMARY KEY,
  shop_id           TEXT NOT NULL REFERENCES shops(phone_number_id),
  customer_phone    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending_approval'
                      CHECK (status IN (
                        'pending_approval', 'approved', 'rejected',
                        'preparing', 'ready', 'out_for_delivery', 'completed'
                      )),
  fulfillment_type  TEXT NOT NULL CHECK (fulfillment_type IN ('pickup', 'delivery')),
  address_line1     TEXT,
  address_line2     TEXT,
  address_city      TEXT,
  address_postcode  TEXT,
  address_notes     TEXT,
  currency          TEXT NOT NULL DEFAULT 'EUR',
  total_minor       INTEGER NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One line per product. name + unit_price_minor + line_total_minor are
-- snapshotted at write time, so order history stays immutable when the catalog
-- later changes price or is soft-deleted. product_id is a plain reference, not
-- an FK, to keep history fully decoupled from catalog mutations. A draft merges
-- repeats into one line per product, so (order_id, product_id) is the key.
CREATE TABLE order_items (
  order_id          TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id        TEXT NOT NULL,
  name              TEXT NOT NULL,
  unit_price_minor  INTEGER NOT NULL,
  qty               INTEGER NOT NULL,
  line_total_minor  INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX idx_orders_shop ON orders (shop_id);

-- Row-level security, same pattern and rationale as catalog (db/migrations/
-- 1781294240794_catalog.sql): ENABLE turns policies on, FORCE drops the owner's
-- exemption; the agent path (loop_agent, NOBYPASSRLS) is bound by them. The GUC
-- is set per-transaction via set_config('app.shop_id', <id>, true); two-arg
-- current_setting reads NULL when unset, so an unscoped query sees zero rows.
-- order_items has no shop_id of its own: it scopes through its parent order, so
-- an item is visible (and insertable, since the absent WITH CHECK falls back to
-- USING) only when that order belongs to the current shop.
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders      FORCE  ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE  ROW LEVEL SECURITY;

CREATE POLICY shop_isolation ON orders
  USING (shop_id = current_setting('app.shop_id', true));

CREATE POLICY shop_isolation ON order_items
  USING (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.order_id = order_items.order_id
      AND o.shop_id = current_setting('app.shop_id', true)
  ));

-- loop_agent writes orders via submit_order, scoped by the policies above (no
-- BYPASSRLS). SELECT is needed both to RETURN the written row and for the
-- order_items policy subquery, which reads orders as loop_agent.
GRANT SELECT, INSERT ON orders, order_items TO loop_agent;

-- Down Migration

DROP TABLE order_items;
DROP TABLE orders;
