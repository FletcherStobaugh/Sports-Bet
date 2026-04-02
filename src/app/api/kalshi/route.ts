import { neon } from "@neondatabase/serverless";

export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);

  // Get all Kalshi bets
  const bets = await sql`
    SELECT kb.*, a.player_name, a.stat_category, a.line, a.verdict, a.confidence,
           a.hit_rate_l10, a.season_average, a.reasoning
    FROM kalshi_bets kb
    JOIN analyses a ON a.id = kb.analysis_id
    ORDER BY kb.created_at DESC
    LIMIT 50
  `;

  // Summary stats
  const [stats] = await sql`
    SELECT
      COUNT(*) as total_bets,
      COUNT(*) FILTER (WHERE status = 'PLACED') as active,
      COUNT(*) FILTER (WHERE status = 'WON') as won,
      COUNT(*) FILTER (WHERE status = 'LOST') as lost,
      COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
      COALESCE(SUM(cost_cents) FILTER (WHERE status != 'FAILED'), 0) as total_wagered,
      COALESCE(SUM(pnl_cents) FILTER (WHERE status IN ('WON', 'LOST')), 0) as total_pnl
    FROM kalshi_bets
  `;

  return Response.json({
    bets,
    stats: {
      totalBets: Number(stats.total_bets),
      active: Number(stats.active),
      won: Number(stats.won),
      lost: Number(stats.lost),
      failed: Number(stats.failed),
      totalWagered: Number(stats.total_wagered),
      totalPnl: Number(stats.total_pnl),
    },
  });
}
