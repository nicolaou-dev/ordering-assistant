-- Up Migration

-- Webhook idempotency, moved off D1 onto Neon so the Worker has a single
-- datastore. WhatsApp delivers each event at least once; the webhook records
-- every message_id and skips repeats. Global, not per-shop (message_id is unique
-- across the whole WABA), so no RLS — the admin/owner role writes it from the
-- webhook; loop_agent never touches it. Replaces the former D1 inbound_messages
-- table.
CREATE TABLE inbound_messages (
  message_id  TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE inbound_messages;
