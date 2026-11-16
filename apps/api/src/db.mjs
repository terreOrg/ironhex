import pg from 'pg';
const {Pool}=pg;

export function createPool(env=process.env) {
  return new Pool({
    host: env.PGHOST || 'ironhex-db',
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || 'ironhex',
    password: env.PGPASSWORD,
    database: env.PGDATABASE || 'ironhex',
    max:5,
    connectionTimeoutMillis:5000,
    idleTimeoutMillis:10000
  });
}

// Schema only: not yet exposed as unauthenticated mutable API endpoints.
const schema = [
`CREATE TABLE IF NOT EXISTS commanders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT NOT NULL UNIQUE CHECK (length(handle) BETWEEN 3 AND 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id,commander_id)
)`,
`CREATE TABLE IF NOT EXISTS hangar_mechs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE CASCADE,
  chassis TEXT NOT NULL,
  callsign TEXT,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS credit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE RESTRICT,
  change_amount BIGINT NOT NULL CHECK (change_amount <> 0),
  reason TEXT NOT NULL,
  reference_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS market_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES commanders(id) ON DELETE RESTRICT,
  mech_id UUID NOT NULL REFERENCES hangar_mechs(id) ON DELETE RESTRICT,
  price_c_bills BIGINT NOT NULL CHECK (price_c_bills > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','sold','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS commanders_handle_ci_idx ON commanders (lower(handle))",
  "CREATE TABLE IF NOT EXISTS commander_credentials (commander_id UUID PRIMARY KEY REFERENCES commanders(id) ON DELETE CASCADE, email TEXT NOT NULL, email_normalized TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  "CREATE TABLE IF NOT EXISTS commander_sessions (token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64), commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL)",
  "CREATE INDEX IF NOT EXISTS commander_sessions_expires_idx ON commander_sessions(expires_at)"
];

export async function initializeDatabase(pool) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for (const statement of schema) await client.query(statement);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
