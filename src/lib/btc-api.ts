// ============================================================
// Bitcoin Price Data Client
// Fetches BTC price, volatility, and momentum data for
// pricing Kalshi KXBTC bracket markets.
//
// Data sources (all free, no API key):
//   - CoinGecko API: current price + 30-day history
//   - Binance API: real-time price + klines for volatility
// ============================================================

export interface BTCPriceData {
  currentPrice: number;
  price24hAgo: number;
  change24h: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  // Volatility metrics
  volatility7d: number; // std dev of daily returns (7d)
  volatility30d: number; // std dev of daily returns (30d)
  // Historical prices for modeling
  dailyPrices: { date: string; price: number }[];
  // Derived
  avgDailyRange: number; // average (high-low) as % of price over 30d
  momentum: "bullish" | "neutral" | "bearish";
  fetchedAt: string;
}

export interface BracketProbability {
  bracketLow: number;
  bracketHigh: number;
  label: string;
  probability: number;
  reasoning: string;
}

// Fetch BTC price data from CoinGecko (free, no key)
async function fetchCoinGecko(): Promise<{
  current: number;
  high24h: number;
  low24h: number;
  prices30d: { date: string; price: number }[];
}> {
  // Current price
  const priceRes = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_high_low=true&include_24hr_change=true"
  );
  if (!priceRes.ok) throw new Error(`CoinGecko price: ${priceRes.status}`);
  const priceData = await priceRes.json();
  const current = priceData.bitcoin.usd;
  const high24h = priceData.bitcoin.usd_24h_high || current * 1.02;
  const low24h = priceData.bitcoin.usd_24h_low || current * 0.98;

  // 30-day history
  await new Promise((r) => setTimeout(r, 1500)); // Rate limit
  const histRes = await fetch(
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily"
  );
  if (!histRes.ok) throw new Error(`CoinGecko history: ${histRes.status}`);
  const histData = await histRes.json();
  const prices30d = (histData.prices as [number, number][]).map(([ts, price]) => ({
    date: new Date(ts).toISOString().split("T")[0],
    price,
  }));

  return { current, high24h, low24h, prices30d };
}

// Fetch BTC data from Binance as fallback (free, no key)
async function fetchBinance(): Promise<{
  current: number;
  high24h: number;
  low24h: number;
  klines: { open: number; high: number; low: number; close: number; date: string }[];
}> {
  // Current price + 24h stats
  const tickerRes = await fetch(
    "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"
  );
  if (!tickerRes.ok) throw new Error(`Binance ticker: ${tickerRes.status}`);
  const ticker = await tickerRes.json();

  // 30-day daily klines
  const klinesRes = await fetch(
    "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=30"
  );
  if (!klinesRes.ok) throw new Error(`Binance klines: ${klinesRes.status}`);
  const rawKlines = await klinesRes.json();

  const klines = (rawKlines as any[]).map((k) => ({
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    date: new Date(k[0]).toISOString().split("T")[0],
  }));

  return {
    current: parseFloat(ticker.lastPrice),
    high24h: parseFloat(ticker.highPrice),
    low24h: parseFloat(ticker.lowPrice),
    klines,
  };
}

// Compute volatility from daily returns
function computeVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

export async function fetchBTCData(): Promise<BTCPriceData> {
  console.log("  Fetching BTC price data...");

  let current: number;
  let high24h: number;
  let low24h: number;
  let dailyPrices: { date: string; price: number }[] = [];

  // Try CoinGecko first, fallback to Binance
  try {
    const cg = await fetchCoinGecko();
    current = cg.current;
    high24h = cg.high24h;
    low24h = cg.low24h;
    dailyPrices = cg.prices30d;
    console.log(`  CoinGecko: $${current.toFixed(2)}`);
  } catch (err) {
    console.log("  CoinGecko failed, trying Binance...");
    const bn = await fetchBinance();
    current = bn.current;
    high24h = bn.high24h;
    low24h = bn.low24h;
    dailyPrices = bn.klines.map((k) => ({ date: k.date, price: k.close }));
    console.log(`  Binance: $${current.toFixed(2)}`);
  }

  const prices = dailyPrices.map((p) => p.price);
  const price24hAgo = prices.length >= 2 ? prices[prices.length - 2] : current;
  const change24h = current - price24hAgo;
  const change24hPct = (change24h / price24hAgo) * 100;

  // Volatility
  const volatility7d = computeVolatility(prices.slice(-7));
  const volatility30d = computeVolatility(prices);

  // Average daily range (high-low as % of price)
  // We'll estimate from daily returns if we don't have high/low
  const avgDailyRange = volatility30d * Math.sqrt(1) * 100; // approx daily range in %

  // Momentum
  const sma7 = prices.slice(-7).reduce((a, b) => a + b, 0) / 7;
  const sma30 = prices.reduce((a, b) => a + b, 0) / prices.length;
  const momentum: "bullish" | "neutral" | "bearish" =
    current > sma7 && sma7 > sma30
      ? "bullish"
      : current < sma7 && sma7 < sma30
        ? "bearish"
        : "neutral";

  return {
    currentPrice: current,
    price24hAgo,
    change24h,
    change24hPct,
    high24h,
    low24h,
    volatility7d,
    volatility30d,
    dailyPrices,
    avgDailyRange,
    momentum,
    fetchedAt: new Date().toISOString(),
  };
}

// Compute probability for each BTC price bracket using log-normal model
// BTC brackets on Kalshi are typically: "Bitcoin price range on [date]?"
// e.g., below $75,000, $75,000-$75,050, $75,050-$75,100, etc.
export function computeBTCBracketProbabilities(
  btcData: BTCPriceData,
  brackets: { low: number; high: number }[],
  hoursAhead: number = 24
): BracketProbability[] {
  const S = btcData.currentPrice;
  // Annualized vol → scale to time horizon
  const dailyVol = btcData.volatility30d; // already daily
  const horizonVol = dailyVol * Math.sqrt(hoursAhead / 24);

  // Log-normal distribution: ln(S_t/S_0) ~ N(mu*t, sigma^2*t)
  // For short horizons, drift is negligible — use 0
  const mu = 0;

  return brackets.map(({ low, high }) => {
    // P(low < S_t < high) using log-normal CDF
    const zLow = low > 0 ? (Math.log(low / S) - mu) / horizonVol : -10;
    const zHigh = high < Infinity ? (Math.log(high / S) - mu) / horizonVol : 10;
    const probability = normalCDF(zHigh) - normalCDF(zLow);

    return {
      bracketLow: low,
      bracketHigh: high,
      label: `$${formatPrice(low)} - $${formatPrice(high)}`,
      probability: Math.max(0, Math.min(1, probability)),
      reasoning: `Log-normal model: vol=${(horizonVol * 100).toFixed(1)}%, z=[${zLow.toFixed(2)}, ${zHigh.toFixed(2)}]`,
    };
  });
}

// Standard normal CDF approximation (Abramowitz & Stegun)
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toString();
}
