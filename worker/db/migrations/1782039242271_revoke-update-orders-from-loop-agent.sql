-- Up Migration

-- The seller approve endpoint used to transition orders.status as loop_agent
-- (1781625422014_grant-update-orders-to-loop-agent.sql). It now runs as the
-- admin role with an explicit shop_id filter, so loop_agent no longer needs
-- UPDATE on orders — its only order access left is INSERT (submit_order) and
-- SELECT (the customer agent reading its own orders). Revoke to least-privilege.
REVOKE UPDATE ON orders FROM loop_agent;

-- Down Migration

GRANT UPDATE ON orders TO loop_agent;
