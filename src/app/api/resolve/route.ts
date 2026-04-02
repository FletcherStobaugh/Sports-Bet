import { neon } from "@neondatabase/serverless";
import { resolveBets } from "@/lib/resolver";

// POST /api/resolve — resolve pending bets after games finish
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedKey = process.env.PIPELINE_SECRET;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  const [run] = await sql`
    INSERT INTO pipeline_runs (job_type, status)
    VALUES ('resolve', 'running')
    RETURNING id
  `;

  try {
    const result = await resolveBets();

    await sql`
      UPDATE pipeline_runs
      SET status = 'success', items_processed = ${result.resolved}, finished_at = NOW()
      WHERE id = ${run.id}
    `;

    return Response.json({ success: true, ...result });
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
