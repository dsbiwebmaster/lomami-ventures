-- Run against production:  wrangler d1 execute lomami-subscribers --file=schema.sql
-- Run against local dev:   wrangler d1 execute lomami-subscribers --local --file=schema.sql

CREATE TABLE IF NOT EXISTS subscribers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  phone        TEXT    NOT NULL UNIQUE,
  status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','stopped')),
  opted_in_at  TEXT    NOT NULL,
  opted_out_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_subscribers_phone ON subscribers(phone);
