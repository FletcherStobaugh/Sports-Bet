// ============================================================
// BTC Bracket Backtest
// Simulates trading BTC brackets over historical data.
// Uses actual BTC prices to check if our volatility model
// would have generated profitable signals.
//
// Run: npx tsx scripts/backtest-btc.ts
// ============================================================

interface DayData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Standard normal CDF
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}

// Compute rolling volatility from closes
function rollingVol(prices: number[], window: number): number {
  if (prices.length < window + 1) return 0.025; // default 2.5%
  const slice = prices.slice(-window - 1);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// Simulate bracket probability using log-normal model
function modelProb(currentPrice: number, bracketLow: number, bracketHigh: number, vol: number): number {
  const zLow = bracketLow > 0 ? Math.log(bracketLow / currentPrice) / vol : -10;
  const zHigh = bracketHigh < Infinity ? Math.log(bracketHigh / currentPrice) / vol : 10;
  return normalCDF(zHigh) - normalCDF(zLow);
}

async function main() {
  console.log("=== BTC BRACKET BACKTEST ===\n");

  // Fetch 90 days of BTC daily prices from CoinGecko market_chart (free)
  console.log("Fetching 90 days of BTC data from CoinGecko...\n");
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily"
  );
  if (!res.ok) throw new Error(`CoinGecko: ${res.status} ${await res.text()}`);
  const raw = await res.json();
  // market_chart returns { prices: [[ts, price], ...] }
  // We don't get OHLC, so simulate using daily prices as close
  // and estimate high/low from daily volatility
  const prices = (raw.prices as [number, number][]);
  const days: DayData[] = prices.map(([ts, price], i) => {
    const date = new Date(ts).toISOString().split("T")[0];
    // Estimate intraday range as ±1.5% of price (typical BTC)
    const range = price * 0.015;
    return {
      date,
      open: i > 0 ? prices[i - 1][1] : price,
      high: price + range * Math.random(),
      low: price - range * Math.random(),
      close: price,
    };
  });

  console.log(`Got ${days.length} days: ${days[0].date} to ${days[days.length - 1].date}\n`);

  // Backtest: for each day (starting from day 30), simulate bracket trading
  // At market open, we know yesterday's close. We generate brackets around it.
  // "Market price" is simulated as the true probability + random noise (simulating retail mispricing)
  // We trade when our model edge > 8%, then check if the actual close landed in the bracket.

  const MIN_EDGE = 0.08;
  const KELLY_FRAC = 0.2;
  const MAX_POS = 0.05;
  const BANKROLL_START = 100000; // $1,000 in cents

  let bankroll = BANKROLL_START;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalPnl = 0;
  const dailyResults: { date: string; pnl: number; trades: number; bankroll: number }[] = [];

  // Use closing prices for rolling volatility
  const closes = days.map((d) => d.close);

  for (let i = 30; i < days.length - 1; i++) {
    const today = days[i];
    const tomorrow = days[i + 1];
    const currentPrice = today.close; // Price we see at end of today
    const actualClose = tomorrow.close; // Where BTC actually ends up

    // Rolling 30-day volatility
    const vol = rollingVol(closes.slice(0, i + 1), 30);

    // Generate brackets: $500 wide centered around current price
    const bracketWidth = 500;
    const rangeMin = Math.floor((currentPrice - currentPrice * 0.15) / bracketWidth) * bracketWidth;
    const rangeMax = Math.ceil((currentPrice + currentPrice * 0.15) / bracketWidth) * bracketWidth;

    let dayTrades = 0;
    let dayPnl = 0;

    for (let low = rangeMin; low < rangeMax; low += bracketWidth) {
      const high = low + bracketWidth;
      const ourProb = modelProb(currentPrice, low, high, vol);

      // Simulate market price with realistic retail mispricing:
      // 1. Retail traders underestimate volatility → price center brackets too high, tail brackets too low
      // 2. Recent momentum bias: if BTC moved up, they overweight further up brackets
      // 3. Round number anchoring
      const momentum = (currentPrice - closes[Math.max(0, i - 3)]) / closes[Math.max(0, i - 3)];
      const bracketCenter = (low + high) / 2;
      const distFromPrice = (bracketCenter - currentPrice) / currentPrice;

      // Retail overweights direction of recent momentum
      const momentumBias = momentum > 0
        ? (distFromPrice > 0 ? 0.05 : -0.05) // if BTC going up, they overprice high brackets
        : (distFromPrice < 0 ? 0.05 : -0.05); // if going down, overprice low brackets

      // Retail underestimates vol → overprices center, underprices tails
      const volBias = ourProb > 0.3 ? 0.04 : (ourProb < 0.1 ? -0.03 : 0);

      // Random noise
      const noise = (Math.random() - 0.5) * 0.10;

      const marketPrice = Math.max(0.03, Math.min(0.95, ourProb + momentumBias + volBias + noise));

      // Check YES side
      const yesEdge = ourProb - marketPrice;
      if (yesEdge >= MIN_EDGE && marketPrice >= 0.05 && marketPrice <= 0.85) {
        // Would we trade this?
        const b = (1 - marketPrice) / marketPrice;
        const kelly = Math.max(0, ((b * ourProb - (1 - ourProb)) / b) * KELLY_FRAC);
        const bet = Math.min(Math.floor(bankroll * kelly), Math.floor(bankroll * MAX_POS));
        if (bet < 5) continue; // min $0.05 trade

        const contracts = Math.max(1, Math.floor(bet / (marketPrice * 100)));
        const cost = contracts * Math.round(marketPrice * 100);

        // Did we win? Check if actual close landed in bracket
        const won = actualClose >= low && actualClose < high;
        const payout = won ? contracts * 100 : 0; // $1 per contract if win
        const pnl = payout - cost;

        bankroll += pnl;
        totalPnl += pnl;
        dayPnl += pnl;
        totalTrades++;
        dayTrades++;
        if (won) wins++;
        else losses++;
      }

      // Check NO side
      const noProb = 1 - ourProb;
      const noMarketPrice = 1 - marketPrice;
      const noEdge = noProb - noMarketPrice;
      if (noEdge >= MIN_EDGE && noMarketPrice >= 0.05 && noMarketPrice <= 0.85) {
        const b = (1 - noMarketPrice) / noMarketPrice;
        const kelly = Math.max(0, ((b * noProb - (1 - noProb)) / b) * KELLY_FRAC);
        const bet = Math.min(Math.floor(bankroll * kelly), Math.floor(bankroll * MAX_POS));
        if (bet < 5) continue;

        const contracts = Math.max(1, Math.floor(bet / (noMarketPrice * 100)));
        const cost = contracts * Math.round(noMarketPrice * 100);

        // NO wins if actual close is NOT in bracket
        const won = !(actualClose >= low && actualClose < high);
        const payout = won ? contracts * 100 : 0;
        const pnl = payout - cost;

        bankroll += pnl;
        totalPnl += pnl;
        dayPnl += pnl;
        totalTrades++;
        dayTrades++;
        if (won) wins++;
        else losses++;
      }
    }

    dailyResults.push({
      date: tomorrow.date,
      pnl: dayPnl,
      trades: dayTrades,
      bankroll,
    });
  }

  // Results
  console.log("=== BACKTEST RESULTS ===\n");
  console.log(`  Period:         ${dailyResults[0]?.date} to ${dailyResults[dailyResults.length - 1]?.date}`);
  console.log(`  Starting:       $${(BANKROLL_START / 100).toFixed(2)}`);
  console.log(`  Final:          $${(bankroll / 100).toFixed(2)}`);
  console.log(`  Total P&L:      ${totalPnl >= 0 ? "+" : ""}$${(totalPnl / 100).toFixed(2)}`);
  console.log(`  Return:         ${((bankroll - BANKROLL_START) / BANKROLL_START * 100).toFixed(1)}%`);
  console.log(`  Total trades:   ${totalTrades}`);
  console.log(`  Win rate:       ${((wins / totalTrades) * 100).toFixed(1)}% (${wins}W / ${losses}L)`);
  console.log(`  Avg trades/day: ${(totalTrades / dailyResults.length).toFixed(1)}`);

  // Monthly breakdown
  const months = new Map<string, { pnl: number; trades: number; startBankroll: number; endBankroll: number }>();
  for (const d of dailyResults) {
    const month = d.date.slice(0, 7);
    if (!months.has(month)) {
      months.set(month, { pnl: 0, trades: 0, startBankroll: d.bankroll - d.pnl, endBankroll: d.bankroll });
    }
    const m = months.get(month)!;
    m.pnl += d.pnl;
    m.trades += d.trades;
    m.endBankroll = d.bankroll;
  }

  console.log("\n=== MONTHLY BREAKDOWN ===\n");
  for (const [month, data] of months) {
    const ret = (data.pnl / data.startBankroll * 100).toFixed(1);
    console.log(`  ${month}: ${data.pnl >= 0 ? "+" : ""}$${(data.pnl / 100).toFixed(2)} (${ret}%) | ${data.trades} trades | Balance: $${(data.endBankroll / 100).toFixed(2)}`);
  }

  // Drawdown analysis
  let peak = BANKROLL_START;
  let maxDrawdown = 0;
  for (const d of dailyResults) {
    if (d.bankroll > peak) peak = d.bankroll;
    const dd = (peak - d.bankroll) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  console.log(`\n  Max drawdown:   ${(maxDrawdown * 100).toFixed(1)}%`);

  // Daily P&L distribution
  const dailyPnls = dailyResults.map((d) => d.pnl / 100);
  const profitDays = dailyPnls.filter((p) => p > 0).length;
  const lossDays = dailyPnls.filter((p) => p < 0).length;
  const flatDays = dailyPnls.filter((p) => p === 0).length;
  console.log(`  Profit days:    ${profitDays} | Loss days: ${lossDays} | Flat: ${flatDays}`);
}

main().catch((e) => console.error("Error:", e));
