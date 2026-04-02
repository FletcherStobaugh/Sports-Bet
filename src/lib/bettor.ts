// ============================================================
// Auto-Bettor
// Takes STRONG edge analyses, finds matching Kalshi markets,
// and places bets automatically with conservative sizing.
// ============================================================

import { neon } from "@neondatabase/serverless";
import {
  getBalance,
  getNBAMarkets,
  placeOrder,
  getPositions,
  type KalshiMarket,
} from "./kalshi";
import type { DBAnalysis, Verdict } from "./types";

// --- Risk Config ---
const MAX_BET_PERCENT = 0.05; // Max 5% of bankroll per bet
const MIN_BET_CENTS = 100; // Minimum $1 bet
const MAX_DAILY_BETS = 5; // Cap daily bets
const ONLY_STRONG = true; // Only bet on STRONG verdicts
const MAX_PRICE_CENTS = 75; // Don't buy contracts priced above 75¢ (implied 75% prob)
const MIN_EDGE_THRESHOLD = 0.10; // Need at least 10% gap between our hit rate and market price

// --- Stat category label mapping ---
const STAT_LABELS: Record<string, string[]> = {
  pts: ["points", "pts", "score"],
  reb: ["rebounds", "rebs", "reb"],
  ast: ["assists", "asts", "ast"],
  stl: ["steals", "stl"],
  blk: ["blocks", "blk"],
  fg3m: ["three", "3-point", "3pt", "threes"],
  turnover: ["turnover", "turnovers"],
  "pts+reb": ["points+rebounds", "pts+reb"],
  "pts+ast": ["points+assists", "pts+ast"],
  "reb+ast": ["rebounds+assists", "reb+ast"],
  "pts+reb+ast": ["points+rebounds+assists", "pra", "pts+reb+ast"],
  "stl+blk": ["steals+blocks", "stl+blk"],
};

// Normalize a name for fuzzy matching (remove diacritics, lowercase)
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// --- Market Matching ---

function matchMarketToAnalysis(
  market: KalshiMarket,
  analysis: DBAnalysis
): { matched: boolean; side: "yes" | "no" } {
  const title = normalize(market.title);
  const subtitle = normalize(market.subtitle || "");
  const fullText = `${title} ${subtitle}`;

  // Check player name match (last name at minimum)
  const playerParts = normalize(analysis.player_name).split(" ");
  const lastName = playerParts[playerParts.length - 1];
  if (!fullText.includes(lastName)) {
    return { matched: false, side: "yes" };
  }

  // Check stat category match
  const statLabels = STAT_LABELS[analysis.stat_category] || [analysis.stat_category];
  const statMatch = statLabels.some((label) => fullText.includes(label));
  if (!statMatch) {
    return { matched: false, side: "yes" };
  }

  // Check if the line is close to our analysis line
  // Kalshi titles often include the number like "25+ points" or "over 25.5"
  const numberMatch = title.match(/(\d+\.?\d*)\+?\s*(points|rebounds|assists|threes|turnovers|steals|blocks)/);
  if (numberMatch) {
    const marketLine = parseFloat(numberMatch[1]);
    if (Math.abs(marketLine - analysis.line) > 5) {
      // Line is too different — wrong market
      return { matched: false, side: "yes" };
    }
  }

  // Determine side based on verdict
  const isOver = analysis.verdict.includes("OVER");
  // On Kalshi, "Yes" typically means the event happens (player scores over X)
  // So OVER → buy Yes, UNDER → buy No
  const side: "yes" | "no" = isOver ? "yes" : "no";

  return { matched: true, side };
}

// --- Edge Calculation ---

function calculateEdge(
  analysis: DBAnalysis,
  market: KalshiMarket,
  side: "yes" | "no"
): { hasEdge: boolean; edgePercent: number; impliedProb: number; ourProb: number } {
  // Market implied probability
  const marketPrice = side === "yes" ? market.yes_ask : market.no_ask;
  const impliedProb = marketPrice / 100; // Kalshi prices are in cents, 1-99

  // Our estimated probability from hit rates
  const isOver = side === "yes";
  const ourProb = isOver ? analysis.hit_rate_l10 : 1 - analysis.hit_rate_l10;

  const edgePercent = ourProb - impliedProb;
  const hasEdge = edgePercent >= MIN_EDGE_THRESHOLD && marketPrice <= MAX_PRICE_CENTS;

  return { hasEdge, edgePercent, impliedProb, ourProb };
}

// --- Position Sizing ---

function calculateBetSize(
  balanceCents: number,
  edgePercent: number,
  priceCents: number
): number {
  // Kelly criterion (half-Kelly for safety)
  // f = (bp - q) / b where b = (100/price - 1), p = our prob, q = 1 - p
  const b = (100 / priceCents) - 1;
  const p = edgePercent + priceCents / 100; // our estimated probability
  const q = 1 - p;
  const kelly = Math.max(0, (b * p - q) / b);
  const halfKelly = kelly / 2;

  // Cap at MAX_BET_PERCENT of bankroll
  const maxBet = Math.floor(balanceCents * MAX_BET_PERCENT);
  const betAmount = Math.min(Math.floor(balanceCents * halfKelly), maxBet);

  // Convert to number of contracts
  const contracts = Math.floor(betAmount / priceCents);

  return Math.max(contracts >= 1 ? contracts : 0, 0);
}

// --- Main Auto-Bet Function ---

export async function autoBet(): Promise<{
  betsPlaced: number;
  totalCost: number;
  skipped: number;
  errors: number;
  details: string[];
}> {
  const sql = neon(process.env.DATABASE_URL!);
  const details: string[] = [];
  let betsPlaced = 0;
  let totalCost = 0;
  let skipped = 0;
  let errors = 0;

  // 1. Get today's STRONG analyses that haven't been bet on
  const today = new Date().toISOString().split("T")[0];
  const analyses = await sql`
    SELECT a.* FROM analyses a
    LEFT JOIN kalshi_bets kb ON kb.analysis_id = a.id
    WHERE a.date = ${today}
    AND a.verdict IN ('STRONG OVER', 'STRONG UNDER')
    AND a.confidence IN ('High', 'Medium')
    AND kb.id IS NULL
    ORDER BY a.hit_rate_l10 DESC
  ` as DBAnalysis[];

  if (analyses.length === 0) {
    details.push("No eligible STRONG analyses found for today");
    return { betsPlaced: 0, totalCost: 0, skipped: 0, errors: 0, details };
  }

  details.push(`Found ${analyses.length} STRONG analyses to bet on`);

  // 2. Check how many bets we've already placed today
  const [{ count: todayBetCount }] = await sql`
    SELECT COUNT(*) as count FROM kalshi_bets
    WHERE created_at::date = CURRENT_DATE
  `;
  const remainingBets = MAX_DAILY_BETS - Number(todayBetCount);
  if (remainingBets <= 0) {
    details.push(`Daily bet limit reached (${MAX_DAILY_BETS})`);
    return { betsPlaced: 0, totalCost: 0, skipped: analyses.length, errors: 0, details };
  }

  // 3. Get balance
  let balance: { balance: number; payout: number };
  try {
    balance = await getBalance();
    details.push(`Kalshi balance: $${(balance.balance / 100).toFixed(2)}`);
  } catch (err) {
    details.push(`Failed to get balance: ${err instanceof Error ? err.message : err}`);
    return { betsPlaced: 0, totalCost: 0, skipped: analyses.length, errors: 1, details };
  }

  if (balance.balance < MIN_BET_CENTS) {
    details.push("Insufficient balance for any bets");
    return { betsPlaced: 0, totalCost: 0, skipped: analyses.length, errors: 0, details };
  }

  // 4. Get all open NBA markets
  let nbaMarkets: KalshiMarket[];
  try {
    nbaMarkets = await getNBAMarkets();
    details.push(`Found ${nbaMarkets.length} open NBA markets on Kalshi`);
  } catch (err) {
    details.push(`Failed to fetch NBA markets: ${err instanceof Error ? err.message : err}`);
    return { betsPlaced: 0, totalCost: 0, skipped: analyses.length, errors: 1, details };
  }

  if (nbaMarkets.length === 0) {
    details.push("No open NBA markets found on Kalshi");
    return { betsPlaced: 0, totalCost: 0, skipped: analyses.length, errors: 0, details };
  }

  // 5. Match analyses to markets and place bets
  for (const analysis of analyses) {
    if (betsPlaced >= remainingBets) {
      details.push("Daily bet limit reached");
      break;
    }

    // Find matching market
    let matchedMarket: KalshiMarket | null = null;
    let matchedSide: "yes" | "no" = "yes";

    for (const market of nbaMarkets) {
      const { matched, side } = matchMarketToAnalysis(market, analysis);
      if (matched) {
        matchedMarket = market;
        matchedSide = side;
        break;
      }
    }

    if (!matchedMarket) {
      details.push(`No Kalshi market found for ${analysis.player_name} ${analysis.stat_category}`);
      skipped++;
      continue;
    }

    // Calculate edge
    const { hasEdge, edgePercent, impliedProb, ourProb } = calculateEdge(
      analysis,
      matchedMarket,
      matchedSide
    );

    if (!hasEdge) {
      details.push(
        `No edge on ${analysis.player_name} ${analysis.stat_category}: ` +
        `our ${(ourProb * 100).toFixed(0)}% vs market ${(impliedProb * 100).toFixed(0)}%`
      );
      skipped++;
      continue;
    }

    // Calculate bet size
    const priceCents = matchedSide === "yes" ? matchedMarket.yes_ask : matchedMarket.no_ask;
    const contracts = calculateBetSize(balance.balance, edgePercent, priceCents);

    if (contracts < 1) {
      details.push(`Bet too small for ${analysis.player_name} (${contracts} contracts)`);
      skipped++;
      continue;
    }

    const costCents = contracts * priceCents;

    // Place the bet
    try {
      const order = await placeOrder({
        ticker: matchedMarket.ticker,
        side: matchedSide,
        count: contracts,
        type: "market",
      });

      // Record in DB
      await sql`
        INSERT INTO kalshi_bets (
          analysis_id, market_ticker, market_title, order_id,
          side, contracts, price_cents, cost_cents, status
        ) VALUES (
          ${analysis.id}, ${matchedMarket.ticker}, ${matchedMarket.title},
          ${order.order_id}, ${matchedSide}, ${contracts}, ${priceCents},
          ${costCents}, 'PLACED'
        )
      `;

      betsPlaced++;
      totalCost += costCents;
      balance.balance -= costCents;

      details.push(
        `BET PLACED: ${analysis.verdict} ${analysis.player_name} ${analysis.stat_category} ` +
        `→ ${matchedSide.toUpperCase()} ${matchedMarket.ticker} | ` +
        `${contracts} contracts @ ${priceCents}¢ = $${(costCents / 100).toFixed(2)} | ` +
        `Edge: ${(edgePercent * 100).toFixed(0)}%`
      );

      // Small delay between orders
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      details.push(`ORDER FAILED for ${analysis.player_name}: ${msg}`);
      errors++;

      // Record failed attempt
      await sql`
        INSERT INTO kalshi_bets (
          analysis_id, market_ticker, market_title, order_id,
          side, contracts, price_cents, cost_cents, status
        ) VALUES (
          ${analysis.id}, ${matchedMarket.ticker}, ${matchedMarket.title},
          NULL, ${matchedSide}, ${contracts}, ${priceCents},
          ${costCents}, 'FAILED'
        )
        ON CONFLICT DO NOTHING
      `;
    }
  }

  details.push(
    `\nSummary: ${betsPlaced} bets placed ($${(totalCost / 100).toFixed(2)}), ` +
    `${skipped} skipped, ${errors} errors`
  );

  return { betsPlaced, totalCost, skipped, errors, details };
}
