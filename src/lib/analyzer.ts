// ============================================================
// Core Analysis Engine
// Computes hit rates, trends, and verdicts for NBA player props
// ============================================================

import type { BDLGameLog, ScrapedProp, PropAnalysis, Verdict, Confidence, StatCategory } from "./types";
import { searchPlayer, getGameLogs, getStatValue, parseMinutes } from "./stats";

// Analyze a single prop
export async function analyzeProp(prop: ScrapedProp): Promise<PropAnalysis | null> {
  // Find the player
  const player = await searchPlayer(prop.playerName);
  if (!player) {
    console.warn(`Player not found: ${prop.playerName}`);
    return null;
  }

  // Get game logs
  const logs = await getGameLogs(player.id);
  if (logs.length < 5) {
    console.warn(`Insufficient data for ${prop.playerName}: ${logs.length} games`);
    return null;
  }

  // Filter out DNPs (0 minutes)
  const activeLogs = logs.filter((l) => parseMinutes(l.min) > 0);
  if (activeLogs.length < 5) return null;

  const l10 = activeLogs.slice(0, 10);
  const l20 = activeLogs.slice(0, 20);

  // Compute hit rates
  const hitCountL10 = l10.filter((g) => getStatValue(g, prop.statCategory) > prop.line).length;
  const hitCountL20 = l20.filter((g) => getStatValue(g, prop.statCategory) > prop.line).length;
  const hitRateL10 = hitCountL10 / l10.length;
  const hitRateL20 = hitCountL20 / l20.length;

  // Season average
  const allValues = activeLogs.map((g) => getStatValue(g, prop.statCategory));
  const seasonAverage = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const lineVsAverage = prop.line - seasonAverage;

  // Opponent info
  const opponentAbbr = parseOpponent(prop.gameInfo, prop.playerName);
  const isHome = prop.gameInfo.includes("vs") || !prop.gameInfo.toLowerCase().includes("@");

  // Minutes trend
  const recentMins = l10.map((g) => parseMinutes(g.min));
  const avgMinL10 = recentMins.reduce((a, b) => a + b, 0) / recentMins.length;
  const firstHalfAvg = recentMins.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const secondHalfAvg = recentMins.slice(5).reduce((a, b) => a + b, 0) / Math.max(recentMins.length - 5, 1);
  const minutesTrend: PropAnalysis["minutesTrend"] =
    firstHalfAvg > secondHalfAvg + 2 ? "increasing" :
    secondHalfAvg > firstHalfAvg + 2 ? "declining" : "stable";

  // Compute verdict
  const { verdict, confidence, reasoning } = computeVerdict({
    hitRateL10,
    hitRateL20,
    seasonAverage,
    line: prop.line,
    lineVsAverage,
    minutesTrend,
    l10Count: l10.length,
    activeLogs: activeLogs.length,
    playerName: prop.playerName,
    statCategory: prop.statCategory,
  });

  return {
    playerName: prop.playerName,
    playerId: player.id,
    statCategory: prop.statCategory,
    line: prop.line,
    gameInfo: prop.gameInfo,
    date: new Date().toISOString().split("T")[0],
    hitRateL10,
    hitRateL10Games: l10.length,
    hitRateL20,
    hitRateL20Games: l20.length,
    seasonAverage: Math.round(seasonAverage * 10) / 10,
    lineVsAverage: Math.round(lineVsAverage * 10) / 10,
    opponentAbbr,
    opponentDefRank: null, // computed separately if needed
    isHome,
    minutesTrend,
    avgMinutesL10: Math.round(avgMinL10 * 10) / 10,
    verdict,
    confidence,
    reasoning,
    result: "PENDING",
  };
}

// Compute verdict from stats
function computeVerdict(data: {
  hitRateL10: number;
  hitRateL20: number;
  seasonAverage: number;
  line: number;
  lineVsAverage: number;
  minutesTrend: string;
  l10Count: number;
  activeLogs: number;
  playerName: string;
  statCategory: string;
}): { verdict: Verdict; confidence: Confidence; reasoning: string } {
  const {
    hitRateL10,
    hitRateL20,
    seasonAverage,
    line,
    lineVsAverage,
    minutesTrend,
    l10Count,
    activeLogs,
    playerName,
    statCategory,
  } = data;

  // Small sample penalty
  if (l10Count < 8) {
    return {
      verdict: "NO EDGE",
      confidence: "Low",
      reasoning: `Only ${l10Count} recent games — insufficient sample for a confident call.`,
    };
  }

  // OVER signals
  const overSignals: string[] = [];
  const underSignals: string[] = [];

  // Hit rate signals (strongest)
  if (hitRateL10 >= 0.75) overSignals.push(`${Math.round(hitRateL10 * 100)}% L10 hit rate`);
  else if (hitRateL10 <= 0.25) underSignals.push(`Only ${Math.round(hitRateL10 * 100)}% L10 hit rate`);

  if (hitRateL10 >= 0.65) overSignals.push("strong L10 trend");
  else if (hitRateL10 <= 0.35) underSignals.push("weak L10 trend");

  // Season average vs line (key signal)
  if (lineVsAverage < -2) overSignals.push(`line ${Math.abs(lineVsAverage).toFixed(1)} below season avg`);
  else if (lineVsAverage > 2) underSignals.push(`line ${lineVsAverage.toFixed(1)} above season avg`);
  else if (lineVsAverage < -0.5) overSignals.push("line slightly below average");
  else if (lineVsAverage > 0.5) underSignals.push("line slightly above average");

  // L20 confirmation
  if (hitRateL20 >= 0.65) overSignals.push("L20 confirms trend");
  else if (hitRateL20 <= 0.35) underSignals.push("L20 confirms trend");

  // Minutes trend
  if (minutesTrend === "increasing") overSignals.push("minutes trending up");
  else if (minutesTrend === "declining") underSignals.push("minutes trending down");

  // Decide verdict
  let verdict: Verdict;
  let confidence: Confidence;

  const overScore = overSignals.length;
  const underScore = underSignals.length;

  if (overScore >= 3 && hitRateL10 >= 0.75) {
    verdict = "STRONG OVER";
    confidence = hitRateL20 >= 0.65 ? "High" : "Medium";
  } else if (underScore >= 3 && hitRateL10 <= 0.25) {
    verdict = "STRONG UNDER";
    confidence = hitRateL20 <= 0.35 ? "High" : "Medium";
  } else if (overScore > underScore && hitRateL10 >= 0.65) {
    verdict = "LEAN OVER";
    confidence = overScore >= 3 ? "Medium" : "Low";
  } else if (underScore > overScore && hitRateL10 <= 0.35) {
    verdict = "LEAN UNDER";
    confidence = underScore >= 3 ? "Medium" : "Low";
  } else {
    verdict = "NO EDGE";
    confidence = "Low";
  }

  // Build reasoning
  const signals = verdict.includes("OVER") ? overSignals : underSignals;
  const direction = verdict.includes("OVER") ? "over" : "under";
  const reasoning =
    verdict === "NO EDGE"
      ? `${playerName} ${statCategory} at ${line}: mixed signals. Season avg ${seasonAverage.toFixed(1)}, L10 hit rate ${Math.round(hitRateL10 * 100)}%. No clear edge.`
      : `${playerName} ${statCategory} ${direction} ${line}: ${signals.join(", ")}. Season avg ${seasonAverage.toFixed(1)}.`;

  return { verdict, confidence, reasoning };
}

// Parse opponent abbreviation from game info string
function parseOpponent(gameInfo: string, playerName: string): string {
  // gameInfo is like "DEN @ LAL" or "DEN vs LAL"
  const parts = gameInfo.split(/\s*[@vs]+\s*/i).map((s) => s.trim());
  return parts.length >= 2 ? parts[1] || parts[0] : gameInfo;
}

// Batch analyze all props
export async function analyzeAllProps(props: ScrapedProp[]): Promise<PropAnalysis[]> {
  const results: PropAnalysis[] = [];

  for (const prop of props) {
    try {
      const analysis = await analyzeProp(prop);
      if (analysis) results.push(analysis);
      // Small delay to respect API rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`Failed to analyze ${prop.playerName} ${prop.statCategory}:`, err);
    }
  }

  // Sort by edge strength
  return results.sort((a, b) => {
    const verdictOrder: Record<Verdict, number> = {
      "STRONG OVER": 0,
      "STRONG UNDER": 1,
      "LEAN OVER": 2,
      "LEAN UNDER": 3,
      "NO EDGE": 4,
    };
    return verdictOrder[a.verdict] - verdictOrder[b.verdict];
  });
}
