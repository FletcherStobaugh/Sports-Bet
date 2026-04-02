// ============================================================
// BTC Bracket Trading Bot
// Run: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/run-btc-bot.ts [scan|dry-run|trade]
// ============================================================

import { fetchBTCData } from "../src/lib/btc-api";
import { findBTCMarkets, generateBTCSignals, executeBTCTrades, getBalanceCents } from "../src/lib/btc-trader";

const mode = process.argv[2] || "scan";

async function main() {
  console.log(`\n========================================`);
  console.log(`  KALSHI BTC BRACKET BOT — ${mode.toUpperCase()}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`========================================\n`);

  // 1. Fetch BTC price data + volatility
  console.log("=== STEP 1: Bitcoin Price Data ===\n");
  const btcData = await fetchBTCData();

  console.log(`  Current Price:  $${btcData.currentPrice.toLocaleString()}`);
  console.log(`  24h Change:     ${btcData.change24hPct >= 0 ? "+" : ""}${btcData.change24hPct.toFixed(2)}% ($${btcData.change24h.toFixed(0)})`);
  console.log(`  24h Range:      $${btcData.low24h.toLocaleString()} - $${btcData.high24h.toLocaleString()}`);
  console.log(`  7d Volatility:  ${(btcData.volatility7d * 100).toFixed(2)}% daily`);
  console.log(`  30d Volatility: ${(btcData.volatility30d * 100).toFixed(2)}% daily`);
  console.log(`  Momentum:       ${btcData.momentum}`);
  console.log(`  Data points:    ${btcData.dailyPrices.length} days`);

  if (mode === "scan") {
    // Show what brackets we'd expect
    const price = btcData.currentPrice;
    const vol = btcData.volatility30d;
    const range1sd = price * vol;
    console.log(`\n  Expected 1-day range (1σ): $${(price - range1sd).toLocaleString(undefined, { maximumFractionDigits: 0 })} - $${(price + range1sd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Expected 1-day range (2σ): $${(price - 2 * range1sd).toLocaleString(undefined, { maximumFractionDigits: 0 })} - $${(price + 2 * range1sd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log("\nScan complete. Run with 'dry-run' to match against Kalshi markets.");
    return;
  }

  // 2. Fetch Kalshi BTC markets
  console.log("\n=== STEP 2: Kalshi BTC Markets ===\n");
  const markets = await findBTCMarkets();

  if (markets.length === 0) {
    console.log("No KXBTC markets found on Kalshi.");
    return;
  }

  console.log(`Found ${markets.length} BTC bracket markets\n`);
  // Show markets with prices
  for (const m of markets.slice(0, 25)) {
    const bracket =
      m.bracketLow > 0 && m.bracketHigh < Infinity
        ? `$${m.bracketLow.toLocaleString()} - $${m.bracketHigh.toLocaleString()}`
        : m.bracketLow > 0
          ? `Above $${m.bracketLow.toLocaleString()}`
          : `Below $${m.bracketHigh.toLocaleString()}`;
    console.log(
      `  [${m.ticker}] ${bracket.padEnd(30)} yes: ${m.yes_bid}/${m.yes_ask}¢ | no: ${m.no_bid}/${m.no_ask}¢ | vol: ${m.volume}`
    );
  }
  if (markets.length > 25) console.log(`  ... and ${markets.length - 25} more`);

  // 3. Generate signals
  console.log("\n=== STEP 3: Trade Signals ===\n");
  let balanceCents: number;
  try {
    balanceCents = await getBalanceCents();
    console.log(`Account balance: $${(balanceCents / 100).toFixed(2)}\n`);
  } catch {
    console.log("Balance check failed — using $1,000 default\n");
    balanceCents = 100000;
  }

  const signals = generateBTCSignals(btcData, markets, balanceCents);

  if (signals.length === 0) {
    console.log("No signals with sufficient edge (>8%). Markets are fairly priced.");
    return;
  }

  console.log(`Found ${signals.length} trade signals:\n`);

  // 4. Execute
  const dryRun = mode !== "trade";
  const results = await executeBTCTrades(signals, dryRun);

  // Summary
  console.log("\n=== SUMMARY ===\n");
  const placed = results.filter((r) => r.status === "placed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const totalCost = results
    .filter((r) => r.status === "placed")
    .reduce((sum, r) => sum + r.signal.costCents, 0);

  console.log(`  Signals:  ${signals.length}`);
  console.log(`  Placed:   ${placed}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
  if (placed > 0) console.log(`  Cost:     $${(totalCost / 100).toFixed(2)}`);
  if (dryRun && signals.length > 0) console.log(`\nRun with 'trade' to place real orders.`);
}

main().catch((err) => {
  console.error("\nBot failed:", err);
  process.exit(1);
});
