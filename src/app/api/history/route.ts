import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL!);
  const searchParams = request.nextUrl.searchParams;
  const days = parseInt(searchParams.get("days") || "30");

  // ROI stats
  const stats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE result != 'PENDING' AND result != 'VOID') as total_bets,
      COUNT(*) FILTER (WHERE result = 'HIT') as hits,
      COUNT(*) FILTER (WHERE result = 'MISS') as misses,
      COUNT(*) FILTER (WHERE result = 'VOID') as voids,
      COUNT(*) FILTER (WHERE result = 'PENDING') as pending,
      COUNT(*) FILTER (WHERE result = 'HIT' AND verdict IN ('STRONG OVER', 'STRONG UNDER')) as strong_hits,
      COUNT(*) FILTER (WHERE result != 'PENDING' AND result != 'VOID' AND verdict IN ('STRONG OVER', 'STRONG UNDER')) as strong_total
    FROM analyses
    WHERE date >= CURRENT_DATE - ${days}::integer
  `;

  // Daily breakdown for chart
  const daily = await sql`
    SELECT
      date,
      COUNT(*) FILTER (WHERE result = 'HIT') as hits,
      COUNT(*) FILTER (WHERE result = 'MISS') as misses,
      COUNT(*) FILTER (WHERE result != 'PENDING' AND result != 'VOID') as total
    FROM analyses
    WHERE date >= CURRENT_DATE - ${days}::integer
    AND result != 'PENDING' AND result != 'VOID'
    GROUP BY date
    ORDER BY date ASC
  `;

  // Recent resolved bets
  const recent = await sql`
    SELECT * FROM analyses
    WHERE result != 'PENDING'
    ORDER BY resolved_at DESC
    LIMIT 50
  `;

  const s = stats[0];
  const totalBets = Number(s.total_bets);
  const hitsCount = Number(s.hits);
  const strongTotal = Number(s.strong_total);
  const strongHits = Number(s.strong_hits);

  return Response.json({
    roi: {
      totalBets,
      hits: hitsCount,
      misses: Number(s.misses),
      voids: Number(s.voids),
      pending: Number(s.pending),
      hitRate: totalBets > 0 ? Math.round((hitsCount / totalBets) * 1000) / 10 : 0,
      strongHitRate: strongTotal > 0 ? Math.round((strongHits / strongTotal) * 1000) / 10 : 0,
    },
    daily,
    recent,
  });
}
