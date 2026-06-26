-- Up Migration

-- Maps a Neon Auth user to the shop(s) they own — the single coupling point
-- between auth (neon_auth.user) and the core tenant (shops). user_id is the
-- neon_auth.user.id; we keep it loose (no FK into the auth-owned schema, which
-- Neon Auth manages) and FK only shop_id into our own shops table. The seller
-- order endpoints resolve the caller's shop through this table after validating
-- their Neon Auth token. Accessed only by the worker's admin role.
CREATE TABLE shop_owners (
  user_id    TEXT NOT NULL,
  shop_id    TEXT NOT NULL REFERENCES shops(phone_number_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shop_id)
);

CREATE INDEX idx_shop_owners_user ON shop_owners (user_id);

-- Down Migration

DROP TABLE shop_owners;