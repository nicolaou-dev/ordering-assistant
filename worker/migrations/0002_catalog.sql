CREATE TABLE shops (
  phone_number_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(phone_number_id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  image_url TEXT,
  in_stock INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER
);

CREATE INDEX idx_products_shop ON products(shop_id);

CREATE VIRTUAL TABLE products_fts USING fts5(
  name,
  description,
  category,
  content='products',
  content_rowid='rowid'
);

CREATE TRIGGER products_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, name, description, category)
  VALUES (new.rowid, new.name, new.description, new.category);
END;

CREATE TRIGGER products_fts_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, description, category)
  VALUES ('delete', old.rowid, old.name, old.description, old.category);
END;

CREATE TRIGGER products_fts_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, description, category)
  VALUES ('delete', old.rowid, old.name, old.description, old.category);
  INSERT INTO products_fts(rowid, name, description, category)
  VALUES (new.rowid, new.name, new.description, new.category);
END;
