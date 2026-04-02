// ============================================================
// PrizePicks Scraper — Playwright-based
// Navigates to PrizePicks, intercepts their projections API,
// and extracts NBA player props with actual PrizePicks lines.
// ============================================================

import { chromium, type Browser, type Page } from "playwright";
import type { ScrapedProp, StatCategory } from "./types";

const PRIZEPICKS_URL = "https://www.prizepicks.com/projections/nba";

// Map PrizePicks stat names to our categories
const STAT_MAP: Record<string, StatCategory> = {
  Points: "pts",
  Rebounds: "reb",
  Assists: "ast",
  Steals: "stl",
  Blocks: "blk",
  "3-Point Made": "fg3m",
  "3-Pointers Made": "fg3m",
  "Three Pointers Made": "fg3m",
  "3-PT Made": "fg3m",
  Turnovers: "turnover",
  "Pts+Rebs": "pts+reb",
  "Pts+Asts": "pts+ast",
  "Rebs+Asts": "reb+ast",
  "Pts+Rebs+Asts": "pts+reb+ast",
  "Stls+Blks": "stl+blk",
  "Blks+Stls": "stl+blk",
  Fantasy: "fantasy",
  "Fantasy Score": "fantasy",
  // Additional PrizePicks naming variations
  "Points + Rebounds": "pts+reb",
  "Points + Assists": "pts+ast",
  "Rebounds + Assists": "reb+ast",
  "Pts + Rebs + Asts": "pts+reb+ast",
  "Points + Rebounds + Assists": "pts+reb+ast",
  "Steals + Blocks": "stl+blk",
  "Blocked Shots": "blk",
  FG3M: "fg3m",
};

// NBA team name → abbreviation
const TEAM_ABBR: Record<string, string> = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "LA Clippers": "LAC",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

function abbreviate(teamName: string): string {
  return TEAM_ABBR[teamName] || teamName.split(" ").pop()?.toUpperCase().slice(0, 3) || teamName;
}

function mapStatCategory(ppStat: string): StatCategory | null {
  // Direct match
  if (STAT_MAP[ppStat]) return STAT_MAP[ppStat];
  // Case-insensitive match
  const lower = ppStat.toLowerCase();
  for (const [key, val] of Object.entries(STAT_MAP)) {
    if (key.toLowerCase() === lower) return val;
  }
  return null;
}

interface PPProjection {
  id: string;
  type: string;
  attributes: {
    line_score: number;
    stat_type: string;
    status: string;
    start_time: string;
    description?: string;
    [key: string]: unknown;
  };
  relationships: {
    new_player?: { data: { id: string; type: string } };
    league?: { data: { id: string; type: string } };
    [key: string]: unknown;
  };
}

interface PPPlayer {
  id: string;
  type: string;
  attributes: {
    name: string;
    display_name?: string;
    team?: string;
    team_name?: string;
    position?: string;
    [key: string]: unknown;
  };
}

interface PPApiResponse {
  data: PPProjection[];
  included: (PPPlayer | { id: string; type: string; attributes: Record<string, unknown> })[];
}

export async function scrapePrizePicks(): Promise<ScrapedProp[]> {
  console.log("Launching Playwright browser for PrizePicks...");

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--window-position=-2400,-2400",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/Chicago",
    });

    const page = await context.newPage();

    // Remove automation indicators
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    const props: ScrapedProp[] = [];
    let apiCaptured = false;

    // Strategy 1: Intercept the projections API response
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/projections") && url.includes("league_id")) {
        try {
          const json = (await response.json()) as PPApiResponse;
          if (json.data && json.included) {
            console.log(`  Intercepted API: ${json.data.length} projections, ${json.included.length} included`);
            const parsed = parseApiResponse(json);
            props.push(...parsed);
            apiCaptured = true;
          }
        } catch {
          // Not JSON or parse error — skip
        }
      }
    });

    console.log("  Navigating to PrizePicks NBA projections...");
    await page.goto(PRIZEPICKS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Give the SPA time to render and API calls to complete
    console.log("  Waiting for page to fully load...");
    await page.waitForTimeout(8000);

    // Take debug screenshot
    await page.screenshot({ path: "prizepicks-debug.png", fullPage: true });
    console.log("  Saved debug screenshot to prizepicks-debug.png");

    // If API interception didn't work, try DOM scraping as fallback
    if (!apiCaptured || props.length === 0) {
      console.log("  API interception missed — trying DOM scraping...");
      const domProps = await scrapeDom(page);
      props.push(...domProps);
    }

    // Deduplicate
    const seen = new Set<string>();
    const unique = props.filter((p) => {
      const key = `${p.playerName}|${p.statCategory}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Scraped ${unique.length} unique NBA player props from PrizePicks`);
    return unique;
  } catch (err) {
    console.error("PrizePicks scrape failed:", err instanceof Error ? err.message : err);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

function parseApiResponse(json: PPApiResponse): ScrapedProp[] {
  const props: ScrapedProp[] = [];

  // Build lookup maps from included data
  const players = new Map<string, PPPlayer>();
  const games = new Map<string, { away: string; home: string }>();

  for (const item of json.included) {
    if (item.type === "new_player") {
      players.set(item.id, item as PPPlayer);
    }
  }

  for (const proj of json.data) {
    if (proj.type !== "projection" || proj.attributes.status === "canceled") continue;

    const statType = proj.attributes.stat_type;
    const category = mapStatCategory(statType);
    if (!category) {
      console.log(`    Skipping unknown stat: ${statType}`);
      continue;
    }

    const playerId = proj.relationships?.new_player?.data?.id;
    const player = playerId ? players.get(playerId) : null;
    if (!player) continue;

    const playerName = player.attributes.display_name || player.attributes.name;
    const team = player.attributes.team || player.attributes.team_name || "";
    const line = proj.attributes.line_score;

    // Build game info from description or team data
    let gameInfo = proj.attributes.description || "";
    if (!gameInfo && team) {
      gameInfo = abbreviate(team);
    }

    props.push({
      playerName,
      statCategory: category,
      line,
      gameInfo,
      scrapedAt: new Date().toISOString(),
    });
  }

  return props;
}

async function scrapeDom(page: Page): Promise<ScrapedProp[]> {
  const props: ScrapedProp[] = [];

  // PrizePicks renders projection cards — try to find them
  // The exact selectors may change, so we try multiple approaches
  const cards = await page.$$('[class*="projection"], [class*="pick"], [data-testid*="projection"]');

  if (cards.length === 0) {
    // Try broader selectors
    console.log("    No projection cards found with primary selectors, trying alternatives...");

    // Try to extract from the page's visible text as a last resort
    const allText = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      const texts: string[] = [];
      elements.forEach((el) => {
        const text = (el as HTMLElement).innerText?.trim();
        if (text && text.length < 200) texts.push(text);
      });
      return texts;
    });

    console.log(`    Found ${allText.length} text elements on page`);
    // Log a sample for debugging
    const sample = allText.slice(0, 20).join(" | ");
    console.log(`    Sample: ${sample}`);
    return props;
  }

  console.log(`    Found ${cards.length} projection cards`);

  for (const card of cards) {
    try {
      const text = await card.innerText();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      // Try to extract player name, stat, and line from the card text
      let playerName = "";
      let statType = "";
      let lineVal = 0;
      let gameInfo = "";

      for (const line of lines) {
        // Check if it's a number (the line/projection)
        const num = parseFloat(line);
        if (!isNaN(num) && num > 0 && num < 100) {
          lineVal = num;
          continue;
        }
        // Check if it matches a stat category
        if (mapStatCategory(line)) {
          statType = line;
          continue;
        }
        // Check if it looks like a matchup (contains @ or vs)
        if (line.includes("@") || line.includes("vs")) {
          gameInfo = line;
          continue;
        }
        // Otherwise it might be the player name
        if (!playerName && line.length > 3 && /^[A-Z]/.test(line)) {
          playerName = line;
        }
      }

      if (playerName && statType && lineVal > 0) {
        const category = mapStatCategory(statType);
        if (category) {
          props.push({
            playerName,
            statCategory: category,
            line: lineVal,
            gameInfo,
            scrapedAt: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Skip unparseable cards
    }
  }

  return props;
}
