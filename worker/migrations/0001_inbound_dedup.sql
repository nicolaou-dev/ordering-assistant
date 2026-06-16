CREATE TABLE inbound_messages (
  message_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_received_at ON inbound_messages(received_at);
