CREATE TABLE IF NOT EXISTS pos_sales (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant_qr_id TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_price_iqd INTEGER NOT NULL CHECK (unit_price_iqd >= 0),
  original_unit_price_iqd INTEGER NOT NULL CHECK (original_unit_price_iqd >= 0),
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 0 AND 99),
  total_iqd INTEGER NOT NULL CHECK (total_iqd = quantity * unit_price_iqd),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pos_sales_owner_created_idx ON pos_sales(owner_id, created_at DESC);
