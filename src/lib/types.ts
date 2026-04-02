// ============================================================
// Sports-Bet Types
// ============================================================

// --- NBA Stats (from ball-dont-lie API) ---

export interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  team: BDLTeam;
}

export interface BDLTeam {
  id: number;
  abbreviation: string;
  city: string;
  conference: string;
  division: string;
  full_name: string;
  name: string;
}

export interface BDLGameLog {
  id: number;
  date: string;
  player: BDLPlayer;
  team: BDLTeam;
  game: {
    id: number;
    date: string;
    home_team_id: number;
    visitor_team_id: number;
    home_team_score: number;
    visitor_team_score: number;
    status: string;
  };
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  fg3m: number;
  fgm: number;
  fga: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  pf: number;
}

// --- PrizePicks Props ---

export type StatCategory =
  | "pts"
  | "reb"
  | "ast"
  | "stl"
  | "blk"
  | "fg3m"
  | "pts+reb"
  | "pts+ast"
  | "reb+ast"
  | "pts+reb+ast"
  | "stl+blk"
  | "turnover"
  | "fantasy";

export interface ScrapedProp {
  playerName: string;
  statCategory: StatCategory;
  line: number;
  gameInfo: string; // e.g. "DEN @ LAL"
  scrapedAt: string;
}

// --- Analysis ---

export type Verdict = "STRONG OVER" | "LEAN OVER" | "LEAN UNDER" | "STRONG UNDER" | "NO EDGE";
export type Confidence = "High" | "Medium" | "Low";

export interface PropAnalysis {
  id?: number;
  playerName: string;
  playerId: number;
  statCategory: StatCategory;
  line: number;
  gameInfo: string;
  date: string;

  // Stats
  hitRateL10: number;
  hitRateL10Games: number;
  hitRateL20: number;
  hitRateL20Games: number;
  seasonAverage: number;
  lineVsAverage: number;

  // Context
  opponentAbbr: string;
  opponentDefRank: number | null;
  isHome: boolean;
  minutesTrend: "increasing" | "stable" | "declining";
  avgMinutesL10: number;

  // Verdict
  verdict: Verdict;
  confidence: Confidence;
  reasoning: string;

  // Resolution
  actualValue?: number | null;
  result?: "HIT" | "MISS" | "VOID" | "PENDING";
  resolvedAt?: string | null;
}

// --- DB Row Types ---

export interface DBProp {
  id: number;
  player_name: string;
  stat_category: StatCategory;
  line: number;
  game_info: string;
  scraped_at: string;
  date: string;
}

export interface DBAnalysis {
  id: number;
  prop_id: number;
  player_id: number;
  player_name: string;
  stat_category: StatCategory;
  line: number;
  game_info: string;
  date: string;
  hit_rate_l10: number;
  hit_rate_l10_games: number;
  hit_rate_l20: number;
  hit_rate_l20_games: number;
  season_average: number;
  line_vs_average: number;
  opponent_abbr: string;
  opponent_def_rank: number | null;
  is_home: boolean;
  minutes_trend: string;
  avg_minutes_l10: number;
  verdict: Verdict;
  confidence: Confidence;
  reasoning: string;
  actual_value: number | null;
  result: "HIT" | "MISS" | "VOID" | "PENDING";
  resolved_at: string | null;
  created_at: string;
}

// --- Pipeline Status ---

export interface PipelineStatus {
  lastScrape: string | null;
  lastAnalysis: string | null;
  lastResolve: string | null;
  propsToday: number;
  strongEdges: number;
  status: "healthy" | "stale" | "error";
}

// --- ROI Stats ---

export interface ROIStats {
  totalBets: number;
  hits: number;
  misses: number;
  voids: number;
  pending: number;
  hitRate: number;
  strongHitRate: number;
  roi: number;
  streak: number;
  streakType: "W" | "L" | null;
}
