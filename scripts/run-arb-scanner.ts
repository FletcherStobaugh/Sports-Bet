// ============================================================
// Structural Arbitrage Scanner
// Run: npx tsx scripts/run-arb-scanner.ts [scan|trade]
//
// Scans ALL Kalshi markets for guaranteed-profit arb:
//   - YES + NO < $1.00 (after fees)
//   - Bracket sums < $1.00
// ============================================================

import "dotenv/config";
import {
  fetchAllMarkets,
  scanSingleArbs,
  scanBracketArbs,
  executeArb,
  getBalanceCents,
} from "../src/lib/arb-scanner";

const mode = process.argv[2] || "scan";

async function main() {
  console.log(`\n========================================`);
  console.log(`  KALSHI STRUCTURAL ARB SCANNER — ${mode.toUpperCase()}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`========================================\n`);

  // 1. Get balance
  let balanceCents: number;
  try {
    balanceCents = await getBalanceCents();
    console.log(`Account balance: $${(balanceCents / 100).toFixed(2)}\n`);
  } catch (err) {
    console.log(`Balance check failed — using $1,000 default\n`);
    balanceCents = 100000;
  }

  // 2. Fetch ALL open markets
  console.log("=== Fetching all open markets ===\n");
  const markets = await fetchAllMarkets();
  console.log(`  Found ${markets.length} open markets with prices\n`);

  if (markets.length === 0) {
    console.log("No markets with prices found. Markets may be closed or API issue.");
    return;
  }

  // Show price distribution
  const withBothPrices = markets.filter((m) => m.yes_ask_cents > 0 && m.no_ask_cents > 0);
  console.log(`  Markets with both YES and NO ask prices: ${withBothPrices.length}`);

  // Show markets closest to arb (YES + NO closest to or below 100)
  const sorted = withBothPrices
    .map((m) => ({
      ...m,
      totalCost: m.yes_ask_cents + m.no_ask_cents,
      gap: 100 - (m.yes_ask_cents + m.no_ask_cents),
    }))
    .sort((a, b) => b.gap - a.gap);

  console.log(`\n  Top 10 closest to arb (YES + NO nearest to < $1.00):\n`);
  for (const m of sorted.slice(0, 10)) {
    const status = m.gap > 0 ? `ARB: +${m.gap}¢` : `no arb (${m.gap}¢ over)`;
    console.log(
      `    [${m.ticker}] YES@${m.yes_ask_cents}¢ + NO@${m.no_ask_cents}¢ = ${m.totalCost}¢ → ${status}`
    );
    console.log(`      ${m.title}`);
  }

  // 3. Scan for single-market arbs
  console.log("\n=== Scanning for single-market arbs ===\n");
  const singleArbs = scanSingleArbs(markets, balanceCents);

  if (singleArbs.length === 0) {
    console.log("  No single-market arb opportunities found (after fees).");
  } else {
    console.log(`  Found ${singleArbs.length} arb opportunities!\n`);
    for (const arb of singleArbs) {
      console.log(`  ★ ${arb.ticker}`);
      console.log(`    ${arb.details}`);
      console.log(`    Max: ${arb.maxContracts} contracts = $${(arb.totalProfitCents / 100).toFixed(2)} guaranteed profit`);
      console.log(`    ${arb.title}\n`);
    }
  }

  // 4. Scan for bracket arbs
  console.log("=== Scanning for bracket arbs ===\n");
  const bracketArbs = scanBracketArbs(markets, balanceCents);

  if (bracketArbs.length === 0) {
    console.log("  No bracket arb opportunities found (after fees).");
  } else {
    console.log(`  Found ${bracketArbs.length} bracket arb opportunities!\n`);
    for (const arb of bracketArbs) {
      console.log(`  ★ ${arb.ticker}`);
      console.log(`    ${arb.details}`);
      console.log(`    Max: ${arb.maxContracts} sets = $${(arb.totalProfitCents / 100).toFixed(2)} guaranteed profit\n`);
    }
  }

  // 5. Execute if in trade mode
  const allArbs = [...singleArbs, ...bracketArbs];

  if (allArbs.length > 0 && mode === "trade") {
    console.log("\n=== EXECUTING ARBS ===\n");
    for (const arb of allArbs) {
      // Use half of max contracts to be safe (in case price moves)
      const contracts = Math.max(1, Math.floor(arb.maxContracts / 2));
      console.log(`  Executing: ${arb.ticker} × ${contracts} contracts...`);
      const result = await executeArb(arb, contracts, false);
      console.log(`    Status: ${result.status}`);
      if (result.yesOrderId) console.log(`    YES order: ${result.yesOrderId}`);
      if (result.noOrderId) console.log(`    NO order: ${result.noOrderId}`);
      if (result.error) console.log(`    Error: ${result.error}`);
    }
  } else if (allArbs.length > 0) {
    console.log(`\nRun with 'trade' to execute ${allArbs.length} arb(s).`);
  }

  // Summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`  Markets scanned: ${markets.length}`);
  console.log(`  With both prices: ${withBothPrices.length}`);
  console.log(`  Single arbs: ${singleArbs.length}`);
  console.log(`  Bracket arbs: ${bracketArbs.length}`);
  if (allArbs.length > 0) {
    const totalProfit = allArbs.reduce((s, a) => s + a.totalProfitCents, 0);
    console.log(`  Total potential profit: $${(totalProfit / 100).toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error("\nScanner failed:", err);
  process.exit(1);
});
