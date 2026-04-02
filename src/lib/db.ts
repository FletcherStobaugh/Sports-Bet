import { neon } from "@neondatabase/serverless";

function getDB() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

export const sql = getDB();

// Initialize database tables
export async function initDB() {
  const db = getDB();

  await db`
    CREATE TABLE IF NOT EXISTS props (
      id SERIAL PRIMARY KEY,
      player_name TEXT NOT NULL,
      stat_category TEXT NOT NULL,
      line REAL NOT NULL,
      game_info TEXT NOT NULL,
      scraped_at TIMESTAMPTZ DEFAULT NOW(),
      date DATE DEFAULT CURRENT_DATE,
      UNIQUE(player_name, stat_category, date)
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
      prop_id INTEGER REFERENCES props(id),
      player_id INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      stat_category TEXT NOT NULL,
      line REAL NOT NULL,
      game_info TEXT NOT NULL,
      date DATE NOT NULL,
      hit_rate_l10 REAL,
      hit_rate_l10_games INTEGER,
      hit_rate_l20 REAL,
      hit_rate_l20_games INTEGER,
      season_average REAL,
      line_vs_average REAL,
      opponent_abbr TEXT,
      opponent_def_rank INTEGER,
      is_home BOOLEAN,
      minutes_trend TEXT,
      avg_minutes_l10 REAL,
      verdict TEXT NOT NULL,
      confidence TEXT NOT NULL,
      reasoning TEXT,
      actual_value REAL,
      result TEXT DEFAULT 'PENDING',
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id SERIAL PRIMARY KEY,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      items_processed INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_analyses_date ON analyses(date)`;
  await db`CREATE INDEX IF NOT EXISTS idx_analyses_result ON analyses(result)`;
  await db`CREATE INDEX IF NOT EXISTS idx_analyses_verdict ON analyses(verdict)`;
  await db`CREATE INDEX IF NOT EXISTS idx_props_date ON props(date)`;
  await db`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_type ON pipeline_runs(job_type)`;

  await db`
    CREATE TABLE IF NOT EXISTS kalshi_bets (
      id SERIAL PRIMARY KEY,
      analysis_id INTEGER REFERENCES analyses(id),
      market_ticker TEXT NOT NULL,
      market_title TEXT NOT NULL,
      order_id TEXT,
      side TEXT NOT NULL,
      contracts INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL,
      status TEXT DEFAULT 'PLACED',
      pnl_cents INTEGER,
      settled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(analysis_id, market_ticker)
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_kalshi_bets_status ON kalshi_bets(status)`;
  await db`CREATE INDEX IF NOT EXISTS idx_kalshi_bets_date ON kalshi_bets(created_at)`;
}
