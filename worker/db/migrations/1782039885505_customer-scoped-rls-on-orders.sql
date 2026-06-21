-- Up Migration

-- loop_agent now serves only the customer agent path for orders: the seller
-- /orders + approve endpoints moved to the admin role with explicit shop_id
-- filters (1782039242271_revoke-update-orders-from-loop-agent.sql). So the
-- agent's view of orders can be locked to a single customer, not just a shop.
-- Replace the shop-only policy with a fail-closed shop AND customer policy:
-- app.customer_id is set per-transaction alongside app.shop_id (see
-- withShopCustomer in src/db.ts), and the two-arg current_setting reads NULL
-- when either GUC is unset, so an unscoped query matches nothing.
--
-- The single USING clause governs SELECT (the customer reading their own history
-- via the past_orders tool) and, as the WITH CHECK fallback, INSERT
-- (submit_order writes the row for this same customer, so customer_phone must
-- equal app.customer_id). order_items scopes through its parent order, which is
-- itself customer-locked, so an item is visible/insertable only when its order
-- belongs to the current shop AND customer.
DROP POLICY shop_isolation ON orders;
DROP POLICY shop_isolation ON order_items;

CREATE POLICY customer_isolation ON orders
  USING (
    shop_id = current_setting('app.shop_id', true)
    AND customer_phone = current_setting('app.customer_id', true)
  );

CREATE POLICY customer_isolation ON order_items
  USING (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.order_id = order_items.order_id
      AND o.shop_id = current_setting('app.shop_id', true)
      AND o.customer_phone = current_setting('app.customer_id', true)
  ));

-- Down Migration

DROP POLICY customer_isolation ON orders;
DROP POLICY customer_isolation ON order_items;

CREATE POLICY shop_isolation ON orders
  USING (shop_id = current_setting('app.shop_id', true));

CREATE POLICY shop_isolation ON order_items
  USING (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.order_id = order_items.order_id
      AND o.shop_id = current_setting('app.shop_id', true)
  ));
