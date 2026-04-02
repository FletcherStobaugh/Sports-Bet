import { neon } from "@neondatabase/serverless";

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    const [lastScrape] = await sql`
      SELECT * FROM pipeline_runs WHERE job_type = 'scrape' ORDER BY started_at DESC LIMIT 1
    `;
    const [lastAnalysis] = await sql`
      SELECT * FROM pipeline_runs WHERE job_type = 'analyze' ORDER BY started_at DESC LIMIT 1
    `;
    const [lastResolve] = await sql`
      SELECT * FROM pipeline_runs WHERE job_type = 'resolve' ORDER BY started_at DESC LIMIT 1
    `;
    const [todayCount] = await sql`
      SELECT COUNT(*) as count FROM analyses WHERE date = CURRENT_DATE
    `;

    return Response.json({
      status: "ok",
      pipeline: {
        lastScrape: lastScrape || null,
        lastAnalysis: lastAnalysis || null,
        lastResolve: lastResolve || null,
        todayProps: Number(todayCount.count),
      },
    });
  } catch (err) {
    return Response.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
