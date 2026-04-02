import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL!);
  const searchParams = request.nextUrl.searchParams;
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  // Only STRONG edges, deduplicated, sorted by hit rate (best odds first)
  const analyses = await sql`
    SELECT DISTINCT ON (player_name, stat_category) *
    FROM analyses
    WHERE date = ${date}
    AND verdict IN ('STRONG OVER', 'STRONG UNDER')
    ORDER BY player_name, stat_category, hit_rate_l10 DESC, created_at DESC
  `;

  // Re-sort by hit rate descending (best bets first)
  analyses.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aRate = Number(a.hit_rate_l10) || 0;
    const bRate = Number(b.hit_rate_l10) || 0;
    // For UNDER bets, the edge is 1 - hit_rate (lower hit rate = stronger under)
    const aEdge = String(a.verdict).includes("UNDER") ? 1 - aRate : aRate;
    const bEdge = String(b.verdict).includes("UNDER") ? 1 - bRate : bRate;
    return bEdge - aEdge;
  });

  // Pipeline status
  const [lastScrape] = await sql`
    SELECT * FROM pipeline_runs WHERE job_type = 'scrape' ORDER BY started_at DESC LIMIT 1
  `;
  const [lastAnalysis] = await sql`
    SELECT * FROM pipeline_runs WHERE job_type = 'analyze' ORDER BY started_at DESC LIMIT 1
  `;

  return Response.json({
    analyses,
    pipeline: {
      lastScrape: lastScrape?.finished_at || null,
      lastAnalysis: lastAnalysis?.finished_at || null,
      lastResolve: null,
      propsToday: analyses.length,
      strongEdges: analyses.length,
      status: lastAnalysis ? "healthy" : "stale",
    },
  });
}
