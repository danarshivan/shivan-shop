CREATE TABLE IF NOT EXISTS customer_push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  expiration_time INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  last_success_at INTEGER,
  last_failure_at INTEGER,
  last_failure_status INTEGER
);

CREATE INDEX IF NOT EXISTS customer_push_subscriptions_customer_idx
  ON customer_push_subscriptions(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_push_preferences (
  customer_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  new_arrivals INTEGER NOT NULL DEFAULT 0 CHECK (new_arrivals IN (0, 1)),
  discounts INTEGER NOT NULL DEFAULT 0 CHECK (discounts IN (0, 1)),
  special_offers INTEGER NOT NULL DEFAULT 0 CHECK (special_offers IN (0, 1)),
  announcements INTEGER NOT NULL DEFAULT 0 CHECK (announcements IN (0, 1)),
  updated_at INTEGER NOT NULL
);
