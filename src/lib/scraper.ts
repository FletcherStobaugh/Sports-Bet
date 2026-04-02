// ============================================================
// PrizePicks Scraper
// Scrapes NBA player props from PrizePicks using Playwright
// ============================================================

import type { ScrapedProp, StatCategory } from "./types";

// Map PrizePicks stat display names to our categories
const STAT_MAP: Record<string, StatCategory> = {
  "Points": "pts",
  "Rebounds": "reb",
  "Assists": "ast",
  "Steals": "stl",
  "Blocks": "blk",
  "3-Pt Made": "fg3m",
  "3-Pointers Made": "fg3m",
  "Turnovers": "turnover",
  "Pts+Rebs": "pts+reb",
  "Pts+Asts": "pts+ast",
  "Rebs+Asts": "reb+ast",
  "Pts+Rebs+Asts": "pts+reb+ast",
  "Steals+Blocks": "stl+blk",
  "Blks+Stls": "stl+blk",
  "Fantasy Score": "fantasy",
};

export async function scrapePrizePicks(): Promise<ScrapedProp[]> {
  // Dynamic import — Playwright isn't needed in the Next.js bundle
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const props: ScrapedProp[] = [];

  try {
    // Navigate to PrizePicks NBA board
    await page.goto("https://app.prizepicks.com/board", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for the page to load
    await page.waitForTimeout(3000);

    // Click on NBA filter if available
    const nbaFilter = page.locator('button:has-text("NBA"), [data-testid*="NBA"]');
    if (await nbaFilter.count() > 0) {
      await nbaFilter.first().click();
      await page.waitForTimeout(2000);
    }

    // Extract projection cards
    // PrizePicks renders prop cards with player name, stat, and line
    const cards = page.locator('[class*="projection"], [class*="pick-card"], [data-testid*="projection"]');
    const cardCount = await cards.count();

    for (let i = 0; i < cardCount; i++) {
      try {
        const card = cards.nth(i);
        const text = await card.innerText();
        const parsed = parseCardText(text);
        if (parsed) props.push(parsed);
      } catch {
        // Skip individual card parse failures
        continue;
      }
    }

    // Fallback: try to intercept API responses if DOM scraping fails
    if (props.length === 0) {
      console.log("DOM scraping found 0 props, trying API intercept...");
      const apiProps = await tryApiIntercept(page);
      props.push(...apiProps);
    }
  } catch (err) {
    console.error("Scraper error:", err);
  } finally {
    await browser.close();
  }

  console.log(`Scraped ${props.length} NBA props from PrizePicks`);
  return props;
}

// Parse card text into a structured prop
function parseCardText(text: string): ScrapedProp | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  // Try to find player name, stat category, and line
  let playerName = "";
  let statCategory: StatCategory | null = null;
  let line = 0;
  let gameInfo = "";

  for (const l of lines) {
    // Check if it's a stat category
    const normalizedStat = STAT_MAP[l];
    if (normalizedStat) {
      statCategory = normalizedStat;
      continue;
    }

    // Check if it's a number (the line)
    const num = parseFloat(l);
    if (!isNaN(num) && num > 0 && num < 200) {
      line = num;
      continue;
    }

    // Check if it's game info (contains @ or vs)
    if (l.includes("@") || l.toLowerCase().includes("vs")) {
      gameInfo = l;
      continue;
    }

    // Otherwise, likely a player name (longest text that isn't a known stat)
    if (l.length > playerName.length && !STAT_MAP[l]) {
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

// Try intercepting PrizePicks API responses for more reliable data
async function tryApiIntercept(page: import("playwright").Page): Promise<ScrapedProp[]> {
  const props: ScrapedProp[] = [];

  // PrizePicks uses an internal API that we can intercept
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("projections") || url.includes("entries")) {
      try {
        const json = await response.json();
        if (json?.data) {
          for (const item of json.data) {
            const stat = STAT_MAP[item.stat_type] || STAT_MAP[item.display_stat];
            if (stat && item.line_score && item.player_name) {
              props.push({
                playerName: item.player_name,
                statCategory: stat,
                line: parseFloat(item.line_score),
                gameInfo: item.game_description || "",
                scrapedAt: new Date().toISOString(),
              });
            }
          }
        }
      } catch {
        // Not JSON or unexpected format
      }
    }
  });

  // Reload to capture API calls
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  return props;
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
