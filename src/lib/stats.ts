// ============================================================
// NBA Stats Client — FAST version
// Uses NBA.com CDN. Key optimization: find player's team first,
// then only fetch THAT team's box scores for game logs.
// ============================================================

import type { BDLPlayer, BDLGameLog, BDLTeam } from "./types";

const NBA_CDN = "https://cdn.nba.com/static/json";

// --- NBA.com CDN types ---

interface NBAScheduleGame {
  gameId: string;
  gameCode: string;
  gameStatus: number;
  gameStatusText: string;
  gameDateEst: string;
  homeTeam: { teamId: number; teamName: string; teamCity: string; teamTricode: string; wins: number; losses: number; score: number };
  awayTeam: { teamId: number; teamName: string; teamCity: string; teamTricode: string; wins: number; losses: number; score: number };
}

interface NBABoxScorePlayer {
  personId: number;
  firstName: string;
  familyName: string;
  position: string;
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
    homeTeam: { teamId: number; teamTricode: string; players: NBABoxScorePlayer[] };
    awayTeam: { teamId: number; teamTricode: string; players: NBABoxScorePlayer[] };
  };
}

// --- Team data ---

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

// Reverse lookup: team ID → abbr
const TEAM_ID_TO_ABBR: Record<number, string> = {};
for (const [abbr, team] of Object.entries(NBA_TEAMS)) {
  TEAM_ID_TO_ABBR[team.id] = abbr;
}

// Caches
const KNOWN_PLAYERS: Record<string, { id: number; teamId: number }> = {};
let scheduleCache: NBAScheduleGame[] | null = null;
const boxScoreCache: Record<string, NBABoxScore> = {};

// --- Fetch helpers ---

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`NBA CDN ${res.status}: ${url}`);
  return res.json();
}

async function getSchedule(): Promise<NBAScheduleGame[]> {
  if (scheduleCache) return scheduleCache;
  const data = await fetchJSON<{
    leagueSchedule: { gameDates: { games: NBAScheduleGame[] }[] };
  }>(`${NBA_CDN}/staticData/scheduleLeagueV2.json`);

  const allGames: NBAScheduleGame[] = [];
  for (const gd of data.leagueSchedule.gameDates) {
    for (const g of gd.games) {
      if (g.gameId.startsWith("002") && g.gameStatus === 3) allGames.push(g);
    }
  }
  allGames.sort((a, b) => new Date(b.gameDateEst).getTime() - new Date(a.gameDateEst).getTime());
  scheduleCache = allGames;
  return allGames;
}

async function getBoxScore(gameId: string): Promise<NBABoxScore> {
  if (boxScoreCache[gameId]) return boxScoreCache[gameId];
  const box = await fetchJSON<NBABoxScore>(`${NBA_CDN}/liveData/boxscore/boxscore_${gameId}.json`);
  boxScoreCache[gameId] = box;
  return box;
}

// Get games for a specific team (by team ID)
async function getTeamGames(teamId: number, limit: number = 20): Promise<NBAScheduleGame[]> {
  const schedule = await getSchedule();
  return schedule
    .filter((g) => g.homeTeam.teamId === teamId || g.awayTeam.teamId === teamId)
    .slice(0, limit);
}

// --- Normalize diacritics ---
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// --- Player Search ---
// FAST: find player in just ONE box score from their team's most recent game

export async function searchPlayer(name: string): Promise<BDLPlayer | null> {
  const nameLower = normalize(name);

  // Check cache
  if (KNOWN_PLAYERS[nameLower]) {
    const { id, teamId } = KNOWN_PLAYERS[nameLower];
    const team = Object.values(NBA_TEAMS).find((t) => t.id === teamId);
    return {
      id,
      first_name: name.split(" ")[0],
      last_name: name.split(" ").slice(1).join(" "),
      position: "",
      team: team
        ? { id: team.id, abbreviation: team.abbr, city: team.city, conference: "", division: "", full_name: `${team.city} ${team.name}`, name: team.name }
        : { id: 0, abbreviation: "", city: "", conference: "", division: "", full_name: "", name: "" },
    };
  }

  // Search recent games — but be smart about it.
  // Check ~5 recent games (covers all 30 teams since ~15 games/day)
  const schedule = await getSchedule();
  const nameParts = nameLower.split(" ");
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ");

  for (const game of schedule.slice(0, 15)) {
    try {
      const box = await getBoxScore(game.gameId);
      const allPlayers = [
        ...box.game.homeTeam.players.map((p) => ({ ...p, teamId: box.game.homeTeam.teamId })),
        ...box.game.awayTeam.players.map((p) => ({ ...p, teamId: box.game.awayTeam.teamId })),
      ];

      const match = allPlayers.find(
        (p) => normalize(p.firstName) === firstName && normalize(p.familyName) === lastName
      );

      if (match) {
        KNOWN_PLAYERS[nameLower] = { id: match.personId, teamId: match.teamId };
        const team = Object.values(NBA_TEAMS).find((t) => t.id === match.teamId);
        return {
          id: match.personId,
          first_name: match.firstName,
          last_name: match.familyName,
          position: match.position,
          team: team
            ? { id: team.id, abbreviation: team.abbr, city: team.city, conference: "", division: "", full_name: `${team.city} ${team.name}`, name: team.name }
            : { id: 0, abbreviation: "", city: "", conference: "", division: "", full_name: "", name: "" },
        };
      }
    } catch { continue; }
  }

  return null;
}

// --- Game Logs ---
// FAST: only fetch box scores for the player's TEAM, not all games

export async function getGameLogs(playerId: number): Promise<BDLGameLog[]> {
  // Find team from cache
  const cached = Object.values(KNOWN_PLAYERS).find((p) => p.id === playerId);
  if (!cached) return [];

  // Get only this team's games
  const teamGames = await getTeamGames(cached.teamId, 25);
  const logs: BDLGameLog[] = [];

  for (const game of teamGames) {
    if (logs.length >= 20) break;

    try {
      const box = await getBoxScore(game.gameId);
      const teamSide = box.game.homeTeam.teamId === cached.teamId ? box.game.homeTeam : box.game.awayTeam;
      const player = teamSide.players.find((p) => p.personId === playerId);
      if (!player) continue;

      const s = player.statistics;
      const teamAbbr = TEAM_ID_TO_ABBR[cached.teamId] || "";
      const team = NBA_TEAMS[teamAbbr];

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
            : { id: 0, abbreviation: teamAbbr, city: "", conference: "", division: "", full_name: "", name: "" },
        },
        team: team
          ? { id: team.id, abbreviation: team.abbr, city: team.city, conference: "", division: "", full_name: `${team.city} ${team.name}`, name: team.name }
          : { id: 0, abbreviation: teamAbbr, city: "", conference: "", division: "", full_name: "", name: "" },
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
    } catch { continue; }
  }

  return logs;
}

// --- Utility functions ---

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
    case "fantasy": return log.pts + log.reb * 1.2 + log.ast * 1.5 + log.stl * 3 + log.blk * 3 - log.turnover;
    default: return 0;
  }
}

export function parseMinutes(min: string): number {
  if (!min) return 0;
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
    id: t.id, abbreviation: t.abbr, city: t.city, conference: "", division: "",
    full_name: `${t.city} ${t.name}`, name: t.name,
  }));
}
