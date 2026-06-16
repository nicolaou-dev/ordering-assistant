-- Up Migration

-- The seller approve endpoint transitions orders.status as loop_agent (the
-- RLS-bound agent role), scoped by the shop_isolation policy. The orders
-- migration granted only SELECT, INSERT (submit_order writes); approval needs
-- UPDATE. RLS still confines it to the token's shop.
GRANT UPDATE ON orders TO loop_agent;

-- Down Migration

REVOKE UPDATE ON orders FROM loop_agent;
