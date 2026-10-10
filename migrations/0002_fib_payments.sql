CREATE TABLE IF NOT EXISTS fib_payments (
  payment_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  app_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS fib_payments_account_order_idx
  ON fib_payments(account_id, order_id, created_at DESC);
