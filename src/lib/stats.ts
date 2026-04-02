// ============================================================
// NBA Stats Client
// Uses NBA.com CDN endpoints (free, reliable, no API key needed)
// Strategy: fetch schedule → get recent game IDs → fetch box scores → extract player stats
// ============================================================

import type { BDLPlayer, BDLGameLog, BDLTeam } from "./types";

const NBA_CDN = "https://cdn.nba.com/static/json";

// --- NBA.com CDN types ---

interface NBAScheduleGame {
  gameId: string;
  gameCode: string;
  gameStatus: number; // 3 = final
  gameStatusText: string;
  gameDateEst: string;
  homeTeam: { teamId: number; teamName: string; teamCity: string; teamTricode: string; teamSlug: string; wins: number; losses: number; score: number };
  awayTeam: { teamId: number; teamName: string; teamCity: string; teamTricode: string; teamSlug: string; wins: number; losses: number; score: number };
}

interface NBABoxScorePlayer {
  personId: number;
  firstName: string;
  familyName: string;
  position: string;
  jerseyNum: string;
  statistics: {
    minutes: string;
    points: number;
    reboundsTotal: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    threePointersMade: number;
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    threePointersAttempted: number;
    freeThrowsMade: number;
    freeThrowsAttempted: number;
    reboundsOffensive: number;
    reboundsDefensive: number;
    foulsPersonal: number;
  };
}

interface NBABoxScore {
  game: {
    gameId: string;
    gameCode: string;
    gameStatusText: string;
    gameStatus: number;
    homeTeam: { teamId: number; teamTricode: string; players: NBABoxScorePlayer[] };
    awayTeam: { teamId: number; teamTricode: string; players: NBABoxScorePlayer[] };
  };
}

// --- Team data (hardcoded for speed — 30 NBA teams don't change often) ---

const NBA_TEAMS: Record<string, { id: number; abbr: string; name: string; city: string }> = {
  ATL: { id: 1610612737, abbr: "ATL", name: "Hawks", city: "Atlanta" },
  BOS: { id: 1610612738, abbr: "BOS", name: "Celtics", city: "Boston" },
  BKN: { id: 1610612751, abbr: "BKN", name: "Nets", city: "Brooklyn" },
  CHA: { id: 1610612766, abbr: "CHA", name: "Hornets", city: "Charlotte" },
  CHI: { id: 1610612741, abbr: "CHI", name: "Bulls", city: "Chicago" },
  CLE: { id: 1610612739, abbr: "CLE", name: "Cavaliers", city: "Cleveland" },
  DAL: { id: 1610612742, abbr: "DAL", name: "Mavericks", city: "Dallas" },
  DEN: { id: 1610612743, abbr: "DEN", name: "Nuggets", city: "Denver" },
  DET: { id: 1610612765, abbr: "DET", name: "Pistons", city: "Detroit" },
  GSW: { id: 1610612744, abbr: "GSW", name: "Warriors", city: "Golden State" },
  HOU: { id: 1610612745, abbr: "HOU", name: "Rockets", city: "Houston" },
  IND: { id: 1610612754, abbr: "IND", name: "Pacers", city: "Indiana" },
  LAC: { id: 1610612746, abbr: "LAC", name: "Clippers", city: "LA" },
  LAL: { id: 1610612747, abbr: "LAL", name: "Lakers", city: "Los Angeles" },
  MEM: { id: 1610612763, abbr: "MEM", name: "Grizzlies", city: "Memphis" },
  MIA: { id: 1610612748, abbr: "MIA", name: "Heat", city: "Miami" },
  MIL: { id: 1610612749, abbr: "MIL", name: "Bucks", city: "Milwaukee" },
  MIN: { id: 1610612750, abbr: "MIN", name: "Timberwolves", city: "Minnesota" },
  NOP: { id: 1610612740, abbr: "NOP", name: "Pelicans", city: "New Orleans" },
  NYK: { id: 1610612752, abbr: "NYK", name: "Knicks", city: "New York" },
  OKC: { id: 1610612760, abbr: "OKC", name: "Thunder", city: "Oklahoma City" },
  ORL: { id: 1610612753, abbr: "ORL", name: "Magic", city: "Orlando" },
  PHI: { id: 1610612755, abbr: "PHI", name: "76ers", city: "Philadelphia" },
  PHX: { id: 1610612756, abbr: "PHX", name: "Suns", city: "Phoenix" },
  POR: { id: 1610612757, abbr: "POR", name: "Trail Blazers", city: "Portland" },
  SAC: { id: 1610612758, abbr: "SAC", name: "Kings", city: "Sacramento" },
  SAS: { id: 1610612759, abbr: "SAS", name: "Spurs", city: "San Antonio" },
  TOR: { id: 1610612761, abbr: "TOR", name: "Raptors", city: "Toronto" },
  UTA: { id: 1610612762, abbr: "UTA", name: "Jazz", city: "Utah" },
  WAS: { id: 1610612764, abbr: "WAS", name: "Wizards", city: "Washington" },
};

// Known player IDs (cache to avoid searching)
const KNOWN_PLAYERS: Record<string, number> = {};

// --- Fetch helpers ---

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`NBA CDN ${res.status}: ${url}`);
  return res.json();
}

// --- Schedule ---

let scheduleCache: NBAScheduleGame[] | null = null;

async function getSchedule(): Promise<NBAScheduleGame[]> {
  if (scheduleCache) return scheduleCache;

  const data = await fetchJSON<{
    leagueSchedule: {
      gameDates: { gameDate: string; games: NBAScheduleGame[] }[];
    };
  }>(`${NBA_CDN}/staticData/scheduleLeagueV2.json`);

  // Flatten all games, only regular season (gameId starts with 002) and finished (status 3)
  const allGames: NBAScheduleGame[] = [];
  for (const gd of data.leagueSchedule.gameDates) {
    for (const g of gd.games) {
      if (g.gameId.startsWith("002") && g.gameStatus === 3) {
        allGames.push(g);
      }
    }
  }

  // Sort by date descending
  allGames.sort(
    (a, b) => new Date(b.gameDateEst).getTime() - new Date(a.gameDateEst).getTime()
  );

  scheduleCache = allGames;
  return allGames;
}

// --- Box Score ---

async function getBoxScore(gameId: string): Promise<NBABoxScore> {
  return fetchJSON<NBABoxScore>(
    `${NBA_CDN}/liveData/boxscore/boxscore_${gameId}.json`
  );
}

// --- Player Roster Cache ---
// Build a full league roster from recent box scores (one per team)

interface CachedPlayer {
  id: number;
  firstName: string;
  lastName: string;
  position: string;
  teamId: number;
  teamAbbr: string;
}

let rosterCache: CachedPlayer[] | null = null;

async function buildRosterCache(): Promise<CachedPlayer[]> {
  if (rosterCache) return rosterCache;

  const schedule = await getSchedule();
  const players: CachedPlayer[] = [];
  const seenTeams = new Set<number>();

  // Find the most recent game for each team (need ~15-20 box scores to cover all 30 teams)
  for (const game of schedule) {
    const homeId = game.homeTeam.teamId;
    const awayId = game.awayTeam.teamId;
    if (seenTeams.has(homeId) && seenTeams.has(awayId)) continue;

    try {
      const box = await getBoxScore(game.gameId);

      if (!seenTeams.has(homeId)) {
        seenTeams.add(homeId);
        for (const p of box.game.homeTeam.players) {
          players.push({
            id: p.personId,
            firstName: p.firstName,
            lastName: p.familyName,
            position: p.position,
            teamId: homeId,
            teamAbbr: box.game.homeTeam.teamTricode,
          });
        }
      }

      if (!seenTeams.has(awayId)) {
        seenTeams.add(awayId);
        for (const p of box.game.awayTeam.players) {
          players.push({
            id: p.personId,
            firstName: p.firstName,
            lastName: p.familyName,
            position: p.position,
            teamId: awayId,
            teamAbbr: box.game.awayTeam.teamTricode,
          });
        }
      }

      await new Promise((r) => setTimeout(r, 150));
    } catch {
      continue;
    }

    if (seenTeams.size >= 30) break;
  }

  console.log(`Built roster cache: ${players.length} players from ${seenTeams.size} teams`);
  rosterCache = players;
  return players;
}

// --- Player Search ---

// Normalize diacritics: Jokić → Jokic, Dončić → Doncic
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export async function searchPlayer(name: string): Promise<BDLPlayer | null> {
  const nameLower = normalize(name);

  // Check ID cache
  if (KNOWN_PLAYERS[nameLower]) {
    const roster = await buildRosterCache();
    const cached = roster.find((p) => p.id === KNOWN_PLAYERS[nameLower]);
    if (cached) {
      const team = Object.values(NBA_TEAMS).find((t) => t.id === cached.teamId);
      return {
        id: cached.id,
        first_name: cached.firstName,
        last_name: cached.lastName,
        position: cached.position,
        team: team
          ? { id: team.id, abbreviation: team.abbr, city: team.city, conference: "", division: "", full_name: `${team.city} ${team.name}`, name: team.name }
          : { id: 0, abbreviation: cached.teamAbbr, city: "", conference: "", division: "", full_name: "", name: "" },
      };
    }
  }

  // Build roster and search
  const roster = await buildRosterCache();
  const nameParts = nameLower.split(" ");
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ");

  // Exact match first (first + last, with diacritic normalization)
  let match = roster.find(
    (p) => normalize(p.firstName) === firstName && normalize(p.lastName) === lastName
  );

  // Fallback: last name match with first name initial
  if (!match && firstName.length >= 2) {
    match = roster.find(
      (p) =>
        normalize(p.lastName) === lastName &&
        normalize(p.firstName).startsWith(firstName.substring(0, 2))
    );
  }

  if (!match) return null;

  KNOWN_PLAYERS[nameLower] = match.id;
  const team = Object.values(NBA_TEAMS).find((t) => t.id === match.teamId);
  return {
    id: match.id,
    first_name: match.firstName,
    last_name: match.lastName,
    position: match.position,
    team: team
      ? { id: team.id, abbreviation: team.abbr, city: team.city, conference: "", division: "", full_name: `${team.city} ${team.name}`, name: team.name }
      : { id: 0, abbreviation: match.teamAbbr, city: "", conference: "", division: "", full_name: "", name: "" },
  };
}

// --- Game Logs ---
// Build game logs by scanning box scores for a specific player

export async function getGameLogs(playerId: number): Promise<BDLGameLog[]> {
  const schedule = await getSchedule();
  const logs: BDLGameLog[] = [];
  let consecutiveMisses = 0;

  // Scan recent games to find this player's appearances
  for (const game of schedule) {
    if (logs.length >= 25) break; // We have enough
    if (consecutiveMisses > 30) break; // Player probably not in these games

    try {
      const box = await getBoxScore(game.gameId);
      const allPlayers = [
        ...box.game.homeTeam.players.map((p) => ({
          ...p,
          teamId: box.game.homeTeam.teamId,
          teamAbbr: box.game.homeTeam.teamTricode,
          isHome: true,
          opponentId: box.game.awayTeam.teamId,
        })),
        ...box.game.awayTeam.players.map((p) => ({
          ...p,
          teamId: box.game.awayTeam.teamId,
          teamAbbr: box.game.awayTeam.teamTricode,
          isHome: false,
          opponentId: box.game.homeTeam.teamId,
        })),
      ];

      const player = allPlayers.find((p) => p.personId === playerId);
      if (!player) {
        consecutiveMisses++;
        continue;
      }
      consecutiveMisses = 0;

      const s = player.statistics;
      const team = Object.values(NBA_TEAMS).find((t) => t.id === player.teamId);

      logs.push({
        id: parseInt(game.gameId),
        date: game.gameDateEst,
        player: {
          id: playerId,
          first_name: player.firstName,
          last_name: player.familyName,
          position: player.position,
          team: team
            ? { id: team.id, abbreviation: team.abbr, city: team.city, conference: "", division: "", full_name: `${team.city} ${team.name}`, name: team.name }
            : { id: 0, abbreviation: player.teamAbbr, city: "", conference: "", division: "", full_name: "", name: "" },
        },
        team: team
          ? { id: team.id, abbreviation: team.abbr, city: team.city, conference: "", division: "", full_name: `${team.city} ${team.name}`, name: team.name }
          : { id: 0, abbreviation: player.teamAbbr, city: "", conference: "", division: "", full_name: "", name: "" },
        game: {
          id: parseInt(game.gameId),
          date: game.gameDateEst,
          home_team_id: box.game.homeTeam.teamId,
          visitor_team_id: box.game.awayTeam.teamId,
          home_team_score: 0,
          visitor_team_score: 0,
          status: "Final",
        },
        min: s.minutes || "0",
        pts: s.points,
        reb: s.reboundsTotal,
        ast: s.assists,
        stl: s.steals,
        blk: s.blocks,
        turnover: s.turnovers,
        fg3m: s.threePointersMade,
        fgm: s.fieldGoalsMade,
        fga: s.fieldGoalsAttempted,
        fg3a: s.threePointersAttempted,
        ftm: s.freeThrowsMade,
        fta: s.freeThrowsAttempted,
        oreb: s.reboundsOffensive,
        dreb: s.reboundsDefensive,
        pf: s.foulsPersonal,
      });

      // Rate limit
      await new Promise((r) => setTimeout(r, 150));
    } catch {
      continue;
    }
  }

  return logs;
}

// --- Public API (matches original interface) ---

export function getStatValue(log: BDLGameLog, category: string): number {
  switch (category) {
    case "pts": return log.pts;
    case "reb": return log.reb;
    case "ast": return log.ast;
    case "stl": return log.stl;
    case "blk": return log.blk;
    case "fg3m": return log.fg3m;
    case "turnover": return log.turnover;
    case "pts+reb": return log.pts + log.reb;
    case "pts+ast": return log.pts + log.ast;
    case "reb+ast": return log.reb + log.ast;
    case "pts+reb+ast": return log.pts + log.reb + log.ast;
    case "stl+blk": return log.stl + log.blk;
    case "fantasy":
      return log.pts + log.reb * 1.2 + log.ast * 1.5 + log.stl * 3 + log.blk * 3 - log.turnover;
    default: return 0;
  }
}

export function parseMinutes(min: string): number {
  if (!min) return 0;
  // NBA CDN format: "PT30M15.00S" or "30:15" or just "30"
  if (min.startsWith("PT")) {
    const mMatch = min.match(/(\d+)M/);
    const sMatch = min.match(/([\d.]+)S/);
    return (mMatch ? parseInt(mMatch[1]) : 0) + (sMatch ? parseFloat(sMatch[1]) / 60 : 0);
  }
  const parts = min.split(":");
  return parseInt(parts[0]) + (parts[1] ? parseInt(parts[1]) / 60 : 0);
}

export async function getTeams(): Promise<BDLTeam[]> {
  return Object.values(NBA_TEAMS).map((t) => ({
    id: t.id,
    abbreviation: t.abbr,
    city: t.city,
    conference: "",
    division: "",
    full_name: `${t.city} ${t.name}`,
    name: t.name,
  }));
}
