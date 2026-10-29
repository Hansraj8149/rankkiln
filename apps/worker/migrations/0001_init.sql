-- Rankkiln hosted schema. Times are Unix milliseconds. Secrets are AES-GCM ciphertext (see src/crypto.ts).

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'trial',
  plan_status TEXT NOT NULL DEFAULT 'active',
  ls_customer_id TEXT,
  ls_subscription_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- SiteProfile JSON from @rankkiln/core
  profile TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX sites_due ON sites (paused, next_run_at);

CREATE TABLE connections (
  site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  -- Connector settings without the secret
  config TEXT NOT NULL,
  secret_enc TEXT,
  verified_at INTEGER
);

CREATE TABLE gsc_tokens (
  site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  property TEXT,
  refresh_enc TEXT NOT NULL
);

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  source TEXT NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  action TEXT NOT NULL,
  page TEXT,
  -- queued | drafted | rejected
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL,
  UNIQUE (site_id, query)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  -- queued | running | done | failed
  status TEXT NOT NULL,
  topic TEXT,
  error TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX runs_site ON runs (site_id, created_at);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  -- Post JSON
  post TEXT NOT NULL,
  issues TEXT NOT NULL,
  -- ready (only in Rankkiln) | sent (draft on the platform) | published | rejected
  status TEXT NOT NULL,
  platform_id TEXT,
  review_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX drafts_site ON drafts (site_id, created_at);

CREATE TABLE usage (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- YYYY-MM
  month TEXT NOT NULL,
  posts INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, month)
);

CREATE TABLE api_keys (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  key_enc TEXT NOT NULL,
  last4 TEXT NOT NULL
);
