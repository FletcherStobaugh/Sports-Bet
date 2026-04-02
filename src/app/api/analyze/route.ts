import { neon } from "@neondatabase/serverless";
import { analyzeAllProps } from "@/lib/analyzer";
import { generateSampleProps } from "@/lib/scraper";
import type { ScrapedProp } from "@/lib/types";

// POST /api/analyze — run analysis on today's props
// Called by GitHub Actions or manually
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedKey = process.env.PIPELINE_SECRET;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const today = new Date().toISOString().split("T")[0];

  // Log pipeline start
  const [run] = await sql`
    INSERT INTO pipeline_runs (job_type, status)
    VALUES ('analyze', 'running')
    RETURNING id
  `;

  try {
    // Get today's props from DB, or use sample data for dev
    const dbProps = await sql`
      SELECT * FROM props WHERE date = ${today}
    `;

    let propsToAnalyze: ScrapedProp[];
    if (dbProps.length > 0) {
      propsToAnalyze = dbProps.map((p) => ({
        playerName: p.player_name as string,
        statCategory: p.stat_category as ScrapedProp["statCategory"],
        line: p.line as number,
        gameInfo: p.game_info as string,
        scrapedAt: p.scraped_at as string,
      }));
    } else {
      // Dev mode: use sample props
      propsToAnalyze = generateSampleProps();
    }

    // Run analysis
    const analyses = await analyzeAllProps(propsToAnalyze);

    // Save to DB
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

    // Log success
    await sql`
      UPDATE pipeline_runs
      SET status = 'success', items_processed = ${analyses.length}, finished_at = NOW()
      WHERE id = ${run.id}
    `;

    return Response.json({
      success: true,
      analyzed: analyses.length,
      strongEdges: analyses.filter(
        (a) => a.verdict === "STRONG OVER" || a.verdict === "STRONG UNDER"
      ).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await sql`
      UPDATE pipeline_runs
      SET status = 'error', error_message = ${message}, finished_at = NOW()
      WHERE id = ${run.id}
    `;
    return Response.json({ error: message }, { status: 500 });
  }
}
