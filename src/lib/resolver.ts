// ============================================================
// Bet Resolver
// After games finish, pulls final stats and marks bets as HIT/MISS
// ============================================================

import { neon } from "@neondatabase/serverless";
import { getGameLogs, getStatValue } from "./stats";
import type { DBAnalysis } from "./types";

export async function resolveBets(): Promise<{
  resolved: number;
  hits: number;
  misses: number;
  voids: number;
  errors: number;
}> {
  const sql = neon(process.env.DATABASE_URL!);

  // Get all pending analyses
  const pending = await sql`
    SELECT * FROM analyses
    WHERE result = 'PENDING'
    AND date < CURRENT_DATE
    ORDER BY date ASC
  ` as DBAnalysis[];

  let resolved = 0;
  let hits = 0;
  let misses = 0;
  let voids = 0;
  let errors = 0;

  for (const analysis of pending) {
    try {
      // Get game logs for the player on that date
      const logs = await getGameLogs(analysis.player_id);
      const gameDate = analysis.date;

      // Find the game log matching this date
      const matchingLog = logs.find((log) => {
        const logDate = new Date(log.game.date).toISOString().split("T")[0];
        return logDate === gameDate;
      });

      if (!matchingLog) {
        // Game hasn't happened or stats not posted yet — skip
        continue;
      }

      // Check if player had 0 minutes (DNP)
      const minutes = matchingLog.min;
      if (!minutes || minutes === "0" || minutes === "00:00") {
        await sql`
          UPDATE analyses
          SET result = 'VOID', actual_value = 0, resolved_at = NOW()
          WHERE id = ${analysis.id}
        `;
        voids++;
        resolved++;
        continue;
      }

      // Get the actual stat value
      const actualValue = getStatValue(matchingLog, analysis.stat_category);

      // Determine result
      const isOver = analysis.verdict.includes("OVER");
      const isUnder = analysis.verdict.includes("UNDER");
      let result: "HIT" | "MISS";

      if (isOver) {
        result = actualValue > analysis.line ? "HIT" : "MISS";
      } else if (isUnder) {
        result = actualValue < analysis.line ? "HIT" : "MISS";
      } else {
        // NO EDGE — resolve based on over (default tracking)
        result = actualValue > analysis.line ? "HIT" : "MISS";
      }

      await sql`
        UPDATE analyses
        SET result = ${result}, actual_value = ${actualValue}, resolved_at = NOW()
        WHERE id = ${analysis.id}
      `;

      if (result === "HIT") hits++;
      else misses++;
      resolved++;

      // Rate limit courtesy
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`Failed to resolve analysis ${analysis.id}:`, err);
      errors++;
    }
  }

  return { resolved, hits, misses, voids, errors };
}
