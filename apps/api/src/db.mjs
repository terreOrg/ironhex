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
  "CREATE INDEX IF NOT EXISTS commander_sessions_expires_idx ON commander_sessions(expires_at)",
  "ALTER TABLE commander_credentials ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ",
  "CREATE TABLE IF NOT EXISTS commander_action_tokens (token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64), commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE CASCADE, purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')), expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  "CREATE INDEX IF NOT EXISTS commander_action_tokens_lookup ON commander_action_tokens(commander_id,purpose)",
  "CREATE TABLE IF NOT EXISTS mechwarrior_pilots (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE CASCADE, full_name TEXT NOT NULL CHECK(length(full_name) BETWEEN 2 AND 60), callsign TEXT NOT NULL CHECK(length(callsign) BETWEEN 2 AND 28), faction TEXT NOT NULL DEFAULT 'mercenary' CHECK(faction IN ('mercenary','independent','federated_suns','draconis_combine','lyran_commonwealth','capellan_confederation','free_worlds_league','clan')), portrait INTEGER NOT NULL DEFAULT 1 CHECK(portrait BETWEEN 1 AND 8), rank TEXT NOT NULL DEFAULT 'cadet' CHECK(rank IN ('cadet','regular','veteran','elite')), gunnery INTEGER NOT NULL DEFAULT 4 CHECK(gunnery BETWEEN 0 AND 8), piloting INTEGER NOT NULL DEFAULT 5 CHECK(piloting BETWEEN 0 AND 8), experience INTEGER NOT NULL DEFAULT 0 CHECK(experience >= 0), battles INTEGER NOT NULL DEFAULT 0 CHECK(battles >= 0), wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0), losses INTEGER NOT NULL DEFAULT 0 CHECK(losses >= 0), kills INTEGER NOT NULL DEFAULT 0 CHECK(kills >= 0), wounds INTEGER NOT NULL DEFAULT 0 CHECK(wounds BETWEEN 0 AND 6), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  "CREATE INDEX IF NOT EXISTS mechwarrior_pilots_owner_idx ON mechwarrior_pilots(commander_id,created_at)",
  "ALTER TABLE hangar_mechs ADD COLUMN IF NOT EXISTS pilot_id UUID REFERENCES mechwarrior_pilots(id) ON DELETE SET NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS hangar_mechs_unique_pilot_idx ON hangar_mechs(pilot_id) WHERE pilot_id IS NOT NULL",
  "CREATE TABLE IF NOT EXISTS pilot_battle_history (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pilot_id UUID NOT NULL REFERENCES mechwarrior_pilots(id) ON DELETE CASCADE, commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE CASCADE, mech_chassis TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('victory','defeat','draw')), xp_awarded INTEGER NOT NULL DEFAULT 0 CHECK(xp_awarded >= 0), kills INTEGER NOT NULL DEFAULT 0 CHECK(kills >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  "CREATE INDEX IF NOT EXISTS pilot_battle_history_pilot_idx ON pilot_battle_history(pilot_id,created_at DESC)",
  "CREATE TABLE IF NOT EXISTS combat_operations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), commander_id UUID NOT NULL REFERENCES commanders(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','abandoned')), roster JSONB NOT NULL, battle_state JSONB, report JSONB, version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ)",
  "CREATE INDEX IF NOT EXISTS combat_operations_owner_idx ON combat_operations(commander_id,created_at DESC)",
  "CREATE INDEX IF NOT EXISTS combat_operations_active_idx ON combat_operations(commander_id,status)"

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
