// ============================================================
// ball-dont-lie API client
// https://www.balldontlie.io/
// ============================================================

import type { BDLPlayer, BDLGameLog, BDLTeam } from "./types";

const BASE_URL = "https://api.balldontlie.io/v1";

function getHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const apiKey = process.env.BDL_API_KEY;
  if (apiKey) {
    headers["Authorization"] = apiKey;
  }
  return headers;
}

async function apiFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { headers: getHeaders() });

  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await fetch(url.toString(), { headers: getHeaders() });
    if (!retry.ok) throw new Error(`BDL API ${retry.status}: ${await retry.text()}`);
    return retry.json();
  }

  if (!res.ok) throw new Error(`BDL API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Search for a player by name
export async function searchPlayer(name: string): Promise<BDLPlayer | null> {
  const data = await apiFetch<{ data: BDLPlayer[] }>("/players", {
    search: name,
    per_page: "5",
  });
  if (!data.data.length) return null;

  // Try exact match first
  const nameParts = name.toLowerCase().split(" ");
  const exact = data.data.find(
    (p) =>
      p.first_name.toLowerCase() === nameParts[0] &&
      p.last_name.toLowerCase() === nameParts.slice(1).join(" ")
  );
  return exact || data.data[0];
}

// Get game logs for a player (current season)
export async function getGameLogs(
  playerId: number,
  season: number = new Date().getFullYear() - (new Date().getMonth() < 9 ? 1 : 0)
): Promise<BDLGameLog[]> {
  const allLogs: BDLGameLog[] = [];
  let cursor: string | null = null;

  // Paginate through all results
  for (let i = 0; i < 5; i++) {
    const params: Record<string, string> = {
      "player_ids[]": playerId.toString(),
      season: season.toString(),
      per_page: "100",
    };
    if (cursor) params.cursor = cursor;

    const data = await apiFetch<{
      data: BDLGameLog[];
      meta: { next_cursor: number | null };
    }>("/stats", params);

    allLogs.push(...data.data);
    if (!data.meta.next_cursor) break;
    cursor = data.meta.next_cursor.toString();
  }

  // Sort by date descending (most recent first)
  return allLogs.sort((a, b) => new Date(b.game.date).getTime() - new Date(a.game.date).getTime());
}

// Get all teams
export async function getTeams(): Promise<BDLTeam[]> {
  const data = await apiFetch<{ data: BDLTeam[] }>("/teams");
  return data.data;
}

// Compute the stat value from a game log for a given category
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

// Parse minutes string "MM:SS" or "MM" to number
export function parseMinutes(min: string): number {
  if (!min) return 0;
  const parts = min.split(":");
  return parseInt(parts[0]) + (parts[1] ? parseInt(parts[1]) / 60 : 0);
}
