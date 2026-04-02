// ============================================================
// The Odds API Client
// Fetches NBA player props from multiple bookmakers including PrizePicks
// https://the-odds-api.com/
// ============================================================

import type { ScrapedProp, StatCategory } from "./types";

const BASE_URL = "https://api.the-odds-api.com/v4";
const SPORT = "basketball_nba";

function getApiKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY not set");
  return key;
}

// Map Odds API market keys to our stat categories
const MARKET_MAP: Record<string, StatCategory> = {
  player_points: "pts",
  player_rebounds: "reb",
  player_assists: "ast",
  player_steals: "stl",
  player_blocks: "blk",
  player_threes: "fg3m",
  player_turnovers: "turnover",
  player_points_rebounds: "pts+reb",
  player_points_assists: "pts+ast",
  player_rebounds_assists: "reb+ast",
  player_points_rebounds_assists: "pts+reb+ast",
};

// All player prop markets we want
const PROP_MARKETS = Object.keys(MARKET_MAP);

interface OddsEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface OddsOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

interface OddsEventWithOdds extends OddsEvent {
  bookmakers: OddsBookmaker[];
}

// Get today's NBA events
async function getEvents(): Promise<OddsEvent[]> {
  const res = await fetch(
    `${BASE_URL}/sports/${SPORT}/events?apiKey=${getApiKey()}`
  );
  if (!res.ok) throw new Error(`Odds API events ${res.status}: ${await res.text()}`);
  return res.json();
}

// Get player props for a specific event
async function getEventPlayerProps(eventId: string): Promise<OddsEventWithOdds> {
  const markets = PROP_MARKETS.join(",");
  const url = `${BASE_URL}/sports/${SPORT}/events/${eventId}/odds?apiKey=${getApiKey()}&regions=us&markets=${markets}&oddsFormat=american`;
  const res = await fetch(url);

  if (res.status === 422) {
    // Some markets might be invalid — try core markets only
    console.log("    Retrying with core markets only...");
    const coreMarkets = "player_points,player_rebounds,player_assists,player_threes";
    const retryUrl = `${BASE_URL}/sports/${SPORT}/events/${eventId}/odds?apiKey=${getApiKey()}&regions=us&markets=${coreMarkets}&oddsFormat=american`;
    const retry = await fetch(retryUrl);
    if (!retry.ok) throw new Error(`Odds API props ${retry.status}: ${await retry.text()}`);
    return retry.json();
  }

  if (!res.ok) throw new Error(`Odds API props ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fetch all NBA player props for today
export async function fetchPlayerProps(): Promise<ScrapedProp[]> {
  console.log("Fetching NBA events from The Odds API...");
  const events = await getEvents();

  // Filter to today's games only
  const today = new Date().toISOString().split("T")[0];
  const todayEvents = events.filter((e) => e.commence_time.startsWith(today));

  if (todayEvents.length === 0) {
    // Also include games starting within next 24 hours
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    const upcomingEvents = events.filter((e) => {
      const t = new Date(e.commence_time).getTime();
      return t >= now && t <= in24h;
    });
    todayEvents.push(...upcomingEvents);
  }

  console.log(`Found ${todayEvents.length} NBA games today/upcoming`);
  if (todayEvents.length === 0) return [];

  const allProps: ScrapedProp[] = [];
  const seenKeys = new Set<string>();

  // Fetch props for each game (rate limit: 1 req/sec on free tier)
  for (const event of todayEvents) {
    try {
      const gameInfo = `${event.away_team} @ ${event.home_team}`;
      console.log(`  Fetching props for ${gameInfo}...`);

      const data = await getEventPlayerProps(event.id);

      for (const bookmaker of data.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const statCategory = MARKET_MAP[market.key];
          if (!statCategory) continue;

          for (const outcome of market.outcomes || []) {
            // We want the "Over" line (which gives us the line number)
            if (outcome.name !== "Over" || outcome.point == null) continue;

            const playerName = outcome.description || "";
            if (!playerName) continue;

            const key = `${playerName}|${statCategory}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            allProps.push({
              playerName,
              statCategory,
              line: outcome.point,
              gameInfo,
              scrapedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Rate limit between requests
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  Failed for event ${event.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Fetched ${allProps.length} player props from The Odds API`);
  return allProps;
}
