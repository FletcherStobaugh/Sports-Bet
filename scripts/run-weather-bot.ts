// ============================================================
// Weather Bot Pipeline
// Run: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/run-weather-bot.ts [scan|trade|dry-run]
//
// Modes:
//   scan     — Fetch forecasts + show signals (no trading)
//   dry-run  — Fetch forecasts + match markets + show what would trade
//   trade    — Live trading (places real orders)
// ============================================================

import { fetchAllCityForecasts, fetchEnsembleForecast, KALSHI_CITIES } from "../src/lib/weather-api";
import {
  findWeatherMarkets,
  generateSignals,
  executeTrades,
  getBalanceCents,
} from "../src/lib/weather-trader";
import { computeBracketProbabilities, generateBrackets } from "../src/lib/weather-api";

const mode = process.argv[2] || "scan";

async function main() {
  console.log(`\n========================================`);
  console.log(`  KALSHI WEATHER BOT — ${mode.toUpperCase()}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`========================================\n`);

  // Target date: tomorrow (weather markets resolve on the target day)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = tomorrow.toISOString().split("T")[0];
  console.log(`Target date: ${targetDate}\n`);

  // 1. Fetch GFS ensemble forecasts for all cities
  console.log("=== STEP 1: Fetching GFS Ensemble Forecasts ===\n");
  const forecasts = await fetchAllCityForecasts(targetDate);
  console.log(`\nGot forecasts for ${forecasts.length} cities\n`);

  // Show forecast summaries
  for (const f of forecasts) {
    console.log(
      `  ${f.city.name}: ${f.mean}°F (±${f.stdDev}°F) | range: ${f.min}°F - ${f.max}°F | ${f.highTemps.length} members`
    );
  }

  // 2. Compute bracket probabilities
  console.log("\n=== STEP 2: Bracket Probabilities ===\n");
  for (const f of forecasts) {
    const brackets = generateBrackets(f);
    const probs = computeBracketProbabilities(f, brackets);
    const nonZero = probs.filter((p) => p.probability > 0);

    console.log(`  ${f.city.name} (${targetDate}):`);
    for (const p of nonZero) {
      const bar = "█".repeat(Math.round(p.probability * 40));
      console.log(
        `    ${p.label.padEnd(16)} ${(p.probability * 100).toFixed(1).padStart(5)}% (${p.ensembleHits}/${p.totalMembers}) ${bar}`
      );
    }
    console.log();
  }

  if (mode === "scan") {
    console.log("Scan complete. Run with 'dry-run' to see trade signals.");
    return;
  }

  // 3. Fetch Kalshi weather markets
  console.log("=== STEP 3: Fetching Kalshi Weather Markets ===\n");
  const markets = await findWeatherMarkets(targetDate);

  if (markets.length === 0) {
    console.log("No weather markets found on Kalshi. Markets may not be open yet for tomorrow.");
    console.log("\nMarket tickers to watch for:");
    for (const city of KALSHI_CITIES) {
      const dateCode = targetDate.replace(/-/g, "").slice(2); // e.g., "260403"
      console.log(`  ${city.prefix}-${dateCode}-*`);
    }
    return;
  }

  // Show found markets
  for (const m of markets.slice(0, 20)) {
    console.log(
      `  [${m.ticker}] ${m.title} | yes: ${m.yes_bid}/${m.yes_ask}¢ | no: ${m.no_bid}/${m.no_ask}¢ | vol: ${m.volume}`
    );
  }
  if (markets.length > 20) {
    console.log(`  ... and ${markets.length - 20} more`);
  }

  // 4. Get balance & generate signals
  console.log("\n=== STEP 4: Generating Trade Signals ===\n");
  let balanceCents: number;
  try {
    balanceCents = await getBalanceCents();
    console.log(`Account balance: $${(balanceCents / 100).toFixed(2)}\n`);
  } catch (err) {
    console.log("Could not fetch balance — using $50 default for sizing\n");
    balanceCents = 5000; // $50 default
  }

  const allSignals = [];
  for (const forecast of forecasts) {
    // Filter markets for this city
    const cityName = forecast.city.name.toLowerCase();
    const cityMarkets = markets.filter(
      (m) =>
        m.ticker.toLowerCase().includes(forecast.city.prefix.toLowerCase().replace("kxhigh", "")) ||
        m.title.toLowerCase().includes(cityName)
    );

    if (cityMarkets.length === 0) continue;

    const signals = generateSignals(forecast, cityMarkets, balanceCents);
    allSignals.push(...signals);
  }

  if (allSignals.length === 0) {
    console.log("No signals with sufficient edge (>8%). Market is fairly priced today.");
    return;
  }

  console.log(`Found ${allSignals.length} trade signals:\n`);

  // 5. Execute or display
  const dryRun = mode !== "trade";
  const results = await executeTrades(allSignals, dryRun);

  // Summary
  console.log("\n=== SUMMARY ===\n");
  const placed = results.filter((r) => r.status === "placed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const totalCost = results
    .filter((r) => r.status === "placed")
    .reduce((sum, r) => sum + r.signal.recommendedCostCents, 0);

  console.log(`  Signals found: ${allSignals.length}`);
  console.log(`  Orders placed: ${placed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);
  if (placed > 0) {
    console.log(`  Total cost: $${(totalCost / 100).toFixed(2)}`);
  }

  if (dryRun && allSignals.length > 0) {
    console.log(`\nRun with 'trade' to place real orders.`);
  }
}

main().catch((err) => {
  console.error("\nBot failed:", err);
  process.exit(1);
});
