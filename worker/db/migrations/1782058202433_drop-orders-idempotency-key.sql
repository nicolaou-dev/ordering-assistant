-- Up Migration

-- order_id IS the draft_id now (set at submit), so the order_id primary key
-- already collapses a re-submitted draft to one row. idempotency_key (formerly
-- "<shop>:<customer>:<draftId>") is redundant — drop it. submit_order catches
-- the PK conflict (23505) and returns the existing order.
ALTER TABLE orders DROP COLUMN idempotency_key;

-- Down Migration

ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
