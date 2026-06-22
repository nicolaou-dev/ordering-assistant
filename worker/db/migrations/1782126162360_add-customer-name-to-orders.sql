-- Up Migration

-- Who the order is for — the customer's name, captured on the draft and carried
-- into the placed order so a returning customer is greeted by it without being
-- asked again. Nullable: orders predate name capture, and a customer may never
-- give one.
ALTER TABLE orders ADD COLUMN customer_name TEXT;

-- Down Migration

ALTER TABLE orders DROP COLUMN customer_name;
