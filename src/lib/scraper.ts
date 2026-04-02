// ============================================================
// PrizePicks Scraper
// Intercepts PrizePicks internal API responses via Playwright
// Strategy: set up API listener BEFORE navigating, capture
// projection data from their internal endpoints.
// ============================================================

import type { ScrapedProp, StatCategory } from "./types";

// Map PrizePicks stat display names to our categories
const STAT_MAP: Record<string, StatCategory> = {
  Points: "pts",
  Rebounds: "reb",
  Assists: "ast",
  Steals: "stl",
  Blocks: "blk",
  "3-Pt Made": "fg3m",
  "3-Pointers Made": "fg3m",
  "Three Pointers Made": "fg3m",
  Turnovers: "turnover",
  "Pts+Rebs": "pts+reb",
  "Pts+Asts": "pts+ast",
  "Rebs+Asts": "reb+ast",
  "Pts+Rebs+Asts": "pts+reb+ast",
  "Steals+Blocks": "stl+blk",
  "Blks+Stls": "stl+blk",
  "Fantasy Score": "fantasy",
  "Fantasy Points": "fantasy",
};

// Lowercase lookup for flexible matching
const STAT_MAP_LOWER: Record<string, StatCategory> = {};
for (const [key, val] of Object.entries(STAT_MAP)) {
  STAT_MAP_LOWER[key.toLowerCase()] = val;
}

export async function scrapePrizePicks(): Promise<ScrapedProp[]> {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const props: ScrapedProp[] = [];
  const seenKeys = new Set<string>();

  // === Strategy 1: Intercept API responses BEFORE navigating ===
  // PrizePicks loads projections from their API — capture that data directly
  page.on("response", async (response) => {
    const url = response.url();
    // PrizePicks API endpoints that contain projection data
    if (
      url.includes("/projections") ||
      url.includes("/entries") ||
      url.includes("/lines") ||
      url.includes("/props") ||
      url.includes("api.prizepicks.com")
    ) {
      try {
        const json = await response.json();
        extractPropsFromAPI(json, props, seenKeys);
      } catch {
        // Not JSON — skip
      }
    }
  });

  try {
    // Navigate with domcontentloaded (don't wait for all network requests)
    console.log("Navigating to PrizePicks...");
    await page.goto("https://app.prizepicks.com/board", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for the app to hydrate and make API calls
    await page.waitForTimeout(8000);

    // Try clicking NBA filter
    try {
      const nbaBtn = page.locator('button:has-text("NBA")').first();
      if (await nbaBtn.isVisible({ timeout: 3000 })) {
        await nbaBtn.click();
        await page.waitForTimeout(5000);
      }
    } catch {
      // NBA filter not found — might already be on NBA or different layout
    }

    // Wait for more API responses
    await page.waitForTimeout(5000);

    // === Strategy 2: DOM scraping as fallback ===
    if (props.length === 0) {
      console.log("API intercept found 0 props, trying DOM scraping...");
      await scrapeDOM(page, props, seenKeys);
    }

    // === Strategy 3: Try scrolling to load more ===
    if (props.length === 0) {
      console.log("DOM scraping found 0, scrolling to trigger lazy load...");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(3000);
      await scrapeDOM(page, props, seenKeys);
    }
  } catch (err) {
    console.error("Scraper error:", err instanceof Error ? err.message : err);
  } finally {
    await browser.close();
  }

  // Filter to NBA only (if we can tell)
  const nbaProps = props.filter((p) => {
    // Keep all if we can't determine sport, or filter by known NBA player names
    return true;
  });

  console.log(`Scraped ${nbaProps.length} props from PrizePicks`);
  return nbaProps;
}

// Extract props from PrizePicks API JSON responses
function extractPropsFromAPI(
  json: unknown,
  props: ScrapedProp[],
  seenKeys: Set<string>
) {
  if (!json || typeof json !== "object") return;

  const obj = json as Record<string, unknown>;

  // PrizePicks API format: { data: [...projections], included: [...players] }
  const data = Array.isArray(obj.data) ? obj.data : [];
  const included = Array.isArray(obj.included) ? obj.included : [];

  // Build player lookup from included
  const players: Record<string, string> = {};
  for (const item of included) {
    const inc = item as Record<string, unknown>;
    if (inc.type === "new_player" || inc.type === "player") {
      const attrs = inc.attributes as Record<string, unknown> | undefined;
      if (attrs && inc.id) {
        const name = (attrs.display_name || attrs.name || `${attrs.first_name || ""} ${attrs.last_name || ""}`.trim()) as string;
        if (name) players[String(inc.id)] = name;
      }
    }
  }

  for (const item of data) {
    const d = item as Record<string, unknown>;
    if (d.type !== "projection" && d.type !== "new_projection") continue;

    const attrs = d.attributes as Record<string, unknown> | undefined;
    if (!attrs) continue;

    const lineScore = attrs.line_score ?? attrs.flash_sale_line_score ?? attrs.stat_value;
    const statType = (attrs.stat_type || attrs.display_stat || attrs.stat_display || "") as string;
    const description = (attrs.description || attrs.game_description || "") as string;

    if (!lineScore || !statType) continue;

    // Get player name from relationships or included
    let playerName = "";
    const rels = d.relationships as Record<string, Record<string, unknown>> | undefined;
    if (rels) {
      const playerRel = (rels.new_player || rels.player) as Record<string, unknown> | undefined;
      const playerData = playerRel?.data as Record<string, unknown> | undefined;
      if (playerData?.id) {
        playerName = players[String(playerData.id)] || "";
      }
    }
    if (!playerName) {
      playerName = (attrs.player_name || attrs.name || "") as string;
    }

    if (!playerName) continue;

    // Map stat type
    const stat = STAT_MAP[statType] || STAT_MAP_LOWER[statType.toLowerCase()];
    if (!stat) continue;

    const key = `${playerName}|${stat}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    props.push({
      playerName,
      statCategory: stat,
      line: parseFloat(String(lineScore)),
      gameInfo: description,
      scrapedAt: new Date().toISOString(),
    });
  }

  if (data.length > 0) {
    console.log(`API intercept: processed ${data.length} items, extracted ${props.length} props so far`);
  }
}

// DOM scraping fallback
async function scrapeDOM(
  page: import("playwright").Page,
  props: ScrapedProp[],
  seenKeys: Set<string>
) {
  // Try multiple selector patterns PrizePicks might use
  const selectors = [
    '[class*="projection"]',
    '[class*="pick-card"]',
    '[class*="prop-card"]',
    '[class*="player-prop"]',
    '[data-testid*="projection"]',
    '[data-testid*="prop"]',
    'li[class*="board"]',
    '.board-card',
  ];

  for (const selector of selectors) {
    const cards = page.locator(selector);
    const count = await cards.count();
    if (count === 0) continue;

    console.log(`Found ${count} elements with selector: ${selector}`);
    for (let i = 0; i < count; i++) {
      try {
        const text = await cards.nth(i).innerText();
        const parsed = parseCardText(text);
        if (parsed) {
          const key = `${parsed.playerName}|${parsed.statCategory}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            props.push(parsed);
          }
        }
      } catch {
        continue;
      }
    }

    if (props.length > 0) break;
  }
}

// Parse card text into a structured prop
function parseCardText(text: string): ScrapedProp | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;

  let playerName = "";
  let statCategory: StatCategory | null = null;
  let line = 0;
  let gameInfo = "";

  for (const l of lines) {
    const normalizedStat = STAT_MAP[l] || STAT_MAP_LOWER[l.toLowerCase()];
    if (normalizedStat) {
      statCategory = normalizedStat;
      continue;
    }

    const num = parseFloat(l);
    if (!isNaN(num) && num > 0 && num < 200) {
      line = num;
      continue;
    }

    if (l.includes("@") || l.toLowerCase().includes("vs")) {
      gameInfo = l;
      continue;
    }

    if (l.length > playerName.length && !STAT_MAP[l] && !STAT_MAP_LOWER[l.toLowerCase()]) {
      playerName = l;
    }
  }

  if (!playerName || !statCategory || line === 0) return null;

  return {
    playerName,
    statCategory,
    line,
    gameInfo,
    scrapedAt: new Date().toISOString(),
  };
}

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
