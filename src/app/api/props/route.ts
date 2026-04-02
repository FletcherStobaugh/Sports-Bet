import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL!);
  const searchParams = request.nextUrl.searchParams;
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
  const verdict = searchParams.get("verdict"); // filter by verdict type

  let analyses;
  if (verdict && verdict !== "all") {
    analyses = await sql`
      SELECT * FROM analyses
      WHERE date = ${date} AND verdict = ${verdict}
      ORDER BY
        CASE verdict
          WHEN 'STRONG OVER' THEN 0
          WHEN 'STRONG UNDER' THEN 1
          WHEN 'LEAN OVER' THEN 2
          WHEN 'LEAN UNDER' THEN 3
          ELSE 4
        END,
        confidence DESC
    `;
  } else {
    analyses = await sql`
      SELECT * FROM analyses
      WHERE date = ${date}
      ORDER BY
        CASE verdict
          WHEN 'STRONG OVER' THEN 0
          WHEN 'STRONG UNDER' THEN 1
          WHEN 'LEAN OVER' THEN 2
          WHEN 'LEAN UNDER' THEN 3
          ELSE 4
        END,
        confidence DESC
    `;
  }

  // Pipeline status
  const [lastScrape] = await sql`
    SELECT * FROM pipeline_runs
    WHERE job_type = 'scrape'
    ORDER BY started_at DESC LIMIT 1
  `;
  const [lastAnalysis] = await sql`
    SELECT * FROM pipeline_runs
    WHERE job_type = 'analyze'
    ORDER BY started_at DESC LIMIT 1
  `;
  const [lastResolve] = await sql`
    SELECT * FROM pipeline_runs
    WHERE job_type = 'resolve'
    ORDER BY started_at DESC LIMIT 1
  `;

  const strongEdges = analyses.filter(
    (a: Record<string, unknown>) => a.verdict === "STRONG OVER" || a.verdict === "STRONG UNDER"
  ).length;

  return Response.json({
    analyses,
    pipeline: {
      lastScrape: lastScrape?.finished_at || null,
      lastAnalysis: lastAnalysis?.finished_at || null,
      lastResolve: lastResolve?.finished_at || null,
      propsToday: analyses.length,
      strongEdges,
      status: lastScrape ? "healthy" : "stale",
    },
  });
}
