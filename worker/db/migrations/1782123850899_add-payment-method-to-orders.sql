-- Up Migration

-- How the customer pays, captured on the draft and carried into the placed
-- order. Cash completes with no payment step; card is paid via a link (separate
-- ticket). Nullable for pre-existing rows; new orders always set it (submit_order
-- guards on it), and the CHECK keeps it to the two known methods.
ALTER TABLE orders
  ADD COLUMN payment_method TEXT CHECK (payment_method IN ('cash', 'card'));

-- Down Migration

ALTER TABLE orders DROP COLUMN payment_method;
