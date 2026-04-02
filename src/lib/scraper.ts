// ============================================================
// Sample props for development/testing
// Production uses The Odds API (see odds-api.ts)
// ============================================================

import type { ScrapedProp } from "./types";

// For testing/development: generate sample props
export function generateSampleProps(): ScrapedProp[] {
  return [
    { playerName: "Nikola Jokic", statCategory: "pts", line: 25.5, gameInfo: "DEN @ LAL", scrapedAt: new Date().toISOString() },
    { playerName: "Nikola Jokic", statCategory: "reb", line: 12.5, gameInfo: "DEN @ LAL", scrapedAt: new Date().toISOString() },
    { playerName: "Nikola Jokic", statCategory: "ast", line: 8.5, gameInfo: "DEN @ LAL", scrapedAt: new Date().toISOString() },
    { playerName: "Luka Doncic", statCategory: "pts", line: 28.5, gameInfo: "DAL vs HOU", scrapedAt: new Date().toISOString() },
    { playerName: "Luka Doncic", statCategory: "pts+reb+ast", line: 48.5, gameInfo: "DAL vs HOU", scrapedAt: new Date().toISOString() },
    { playerName: "Jayson Tatum", statCategory: "pts", line: 26.5, gameInfo: "BOS @ MIA", scrapedAt: new Date().toISOString() },
    { playerName: "Jayson Tatum", statCategory: "reb", line: 8.5, gameInfo: "BOS @ MIA", scrapedAt: new Date().toISOString() },
    { playerName: "Anthony Edwards", statCategory: "pts", line: 24.5, gameInfo: "MIN vs GSW", scrapedAt: new Date().toISOString() },
    { playerName: "Stephen Curry", statCategory: "fg3m", line: 4.5, gameInfo: "GSW @ MIN", scrapedAt: new Date().toISOString() },
    { playerName: "Tyrese Haliburton", statCategory: "ast", line: 9.5, gameInfo: "IND @ NYK", scrapedAt: new Date().toISOString() },
  ];
}
