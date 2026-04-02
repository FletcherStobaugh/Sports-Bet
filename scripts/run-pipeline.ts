// Run: npx tsx scripts/run-pipeline.ts [scrape|analyze|resolve|all]
// Entry point for GitHub Actions pipeline jobs

import { neon } from "@neondatabase/serverless";
import { fetchPlayerProps } from "../src/lib/odds-api";
import { generateSampleProps } from "../src/lib/scraper";
import { analyzeAllProps } from "../src/lib/analyzer";
import { resolveBets } from "../src/lib/resolver";
import type { ScrapedProp } from "../src/lib/types";

const sql = neon(process.env.DATABASE_URL!);

async function logRun(jobType: string, status: string, items: number, error?: string) {
  await sql`
    INSERT INTO pipeline_runs (job_type, status, items_processed, error_message, finished_at)
    VALUES (${jobType}, ${status}, ${items}, ${error || null}, NOW())
  `;
}

async function scrape() {
  console.log("=== FETCHING PLAYER PROPS ===");
  try {
    const props = await fetchPlayerProps();
    if (props.length > 0) {
      await saveProps(props);
      await logRun("scrape", "success", props.length);
      return props;
    }
    console.log("No props from Odds API — no games today or API issue");
    await logRun("scrape", "empty", 0, "No props returned");
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Props fetch failed:", msg);
    await logRun("scrape", "error", 0, msg);
    return [];
  }
}

async function saveProps(props: ScrapedProp[]) {
  for (const p of props) {
    await sql`
      INSERT INTO props (player_name, stat_category, line, game_info, scraped_at)
      VALUES (${p.playerName}, ${p.statCategory}, ${p.line}, ${p.gameInfo}, ${p.scrapedAt})
      ON CONFLICT (player_name, stat_category, date) DO UPDATE
      SET line = ${p.line}, game_info = ${p.gameInfo}, scraped_at = ${p.scrapedAt}
    `;
  }
  console.log(`Saved ${props.length} props to DB`);
}

async function analyze() {
  console.log("=== RUNNING ANALYSIS ===");
  const today = new Date().toISOString().split("T")[0];

  const dbProps = await sql`SELECT * FROM props WHERE date = ${today}`;
  if (dbProps.length === 0) {
    console.log("No props in DB for today — nothing to analyze");
    return [];
  }

  const propsToAnalyze: ScrapedProp[] = dbProps.map((p) => ({
    playerName: p.player_name as string,
    statCategory: p.stat_category as ScrapedProp["statCategory"],
    line: p.line as number,
    gameInfo: p.game_info as string,
    scrapedAt: p.scraped_at as string,
  }));
  console.log(`Analyzing ${propsToAnalyze.length} props...`);

  try {
    const analyses = await analyzeAllProps(propsToAnalyze);
    console.log(`Analyzed ${analyses.length} props`);

    for (const a of analyses) {
      await sql`
        INSERT INTO analyses (
          player_id, player_name, stat_category, line, game_info, date,
          hit_rate_l10, hit_rate_l10_games, hit_rate_l20, hit_rate_l20_games,
          season_average, line_vs_average, opponent_abbr, opponent_def_rank,
          is_home, minutes_trend, avg_minutes_l10,
          verdict, confidence, reasoning, result
        ) VALUES (
          ${a.playerId}, ${a.playerName}, ${a.statCategory}, ${a.line},
          ${a.gameInfo}, ${a.date},
          ${a.hitRateL10}, ${a.hitRateL10Games}, ${a.hitRateL20}, ${a.hitRateL20Games},
          ${a.seasonAverage}, ${a.lineVsAverage}, ${a.opponentAbbr},
          ${a.opponentDefRank}, ${a.isHome}, ${a.minutesTrend}, ${a.avgMinutesL10},
          ${a.verdict}, ${a.confidence}, ${a.reasoning}, 'PENDING'
        )
        ON CONFLICT DO NOTHING
      `;
    }

    const strong = analyses.filter(
      (a) => a.verdict === "STRONG OVER" || a.verdict === "STRONG UNDER"
    );
    console.log(`Found ${strong.length} STRONG edges`);
    strong.forEach((a) => {
      console.log(`  ${a.verdict}: ${a.playerName} ${a.statCategory} ${a.line} — ${a.reasoning}`);
    });

    await logRun("analyze", "success", analyses.length);
    return analyses;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Analysis failed:", msg);
    await logRun("analyze", "error", 0, msg);
    throw err;
  }
}

async function resolve() {
  console.log("=== RESOLVING BETS ===");
  try {
    const result = await resolveBets();
    console.log(
      `Resolved ${result.resolved} bets: ${result.hits} HIT, ${result.misses} MISS, ${result.voids} VOID, ${result.errors} errors`
    );
    await logRun("resolve", "success", result.resolved);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Resolution failed:", msg);
    await logRun("resolve", "error", 0, msg);
    throw err;
  }
}

// Main
const command = process.argv[2] || "all";

(async () => {
  switch (command) {
    case "scrape":
      await scrape();
      break;
    case "analyze":
      await analyze();
      break;
    case "resolve":
      await resolve();
      break;
    case "all":
      await scrape();
      await analyze();
      break;
    default:
      console.error(`Unknown command: ${command}. Use: scrape, analyze, resolve, all`);
      process.exit(1);
  }
  console.log("Done!");
})().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
