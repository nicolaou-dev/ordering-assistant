-- Up Migration

-- An order-level note: a special instruction the customer gave (e.g. "no nuts",
-- "leave at the door"), carried from the draft into the placed order so the shop
-- sees it on the ticket. Nullable — most orders have none.
ALTER TABLE orders ADD COLUMN note TEXT;

-- Down Migration

ALTER TABLE orders DROP COLUMN note;
