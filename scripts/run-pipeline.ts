// Run: npx tsx scripts/run-pipeline.ts [analyze|bet|resolve|all]
// Entry point for GitHub Actions pipeline jobs
// Kalshi-only — no PrizePicks scraping

import { neon } from "@neondatabase/serverless";
import { generateSampleProps } from "../src/lib/scraper";
import { analyzeAllProps } from "../src/lib/analyzer";
import { resolveBets } from "../src/lib/resolver";
import { autoBet } from "../src/lib/bettor";
import type { ScrapedProp } from "../src/lib/types";

const sql = neon(process.env.DATABASE_URL!);

async function logRun(jobType: string, status: string, items: number, error?: string) {
  await sql`
    INSERT INTO pipeline_runs (job_type, status, items_processed, error_message, finished_at)
    VALUES (${jobType}, ${status}, ${items}, ${error || null}, NOW())
  `;
}

async function analyze() {
  console.log("=== RUNNING ANALYSIS ===");
  const today = new Date().toISOString().split("T")[0];

  // Use sample props (top NBA players) — Kalshi market matching handles the rest
  const propsToAnalyze = generateSampleProps();
  console.log(`Analyzing ${propsToAnalyze.length} player props...`);

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

async function bet() {
  console.log("=== AUTO-BETTING ON KALSHI ===");
  try {
    const result = await autoBet();
    for (const d of result.details) console.log(`  ${d}`);
    await logRun("bet", "success", result.betsPlaced);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Auto-bet failed:", msg);
    await logRun("bet", "error", 0, msg);
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
    case "analyze":
      await analyze();
      break;
    case "bet":
      await bet();
      break;
    case "resolve":
      await resolve();
      break;
    case "all":
      await analyze();
      await bet();
      break;
    default:
      console.error(`Unknown command: ${command}. Use: analyze, bet, resolve, all`);
      process.exit(1);
  }
  console.log("Done!");
})().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
