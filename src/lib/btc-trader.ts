// ============================================================
// BTC Bracket Trader — Kalshi KXBTC Bot Core
//
// Fetches Bitcoin price brackets from Kalshi, computes
// fair probabilities using log-normal volatility model,
// and places MAKER limit orders when edge > threshold.
//
// Same rules as weather bot:
// 1. Always MAKER (limit orders)
// 2. Edge > 8% to trade
// 3. Fractional Kelly (0.2x)
// 4. Max 5% bankroll per trade
// 5. Price bounds: 5¢ - 85¢
// ============================================================

import type { BTCPriceData, BracketProbability } from "./btc-api";
import { computeBTCBracketProbabilities } from "./btc-api";
import {
  Configuration,
  MarketApi,
  OrdersApi,
  PortfolioApi,
} from "kalshi-typescript";
import * as fs from "fs";
import * as path from "path";

const MIN_EDGE = 0.08;
const KELLY_FRACTION = 0.2;
const MAX_POSITION_PCT = 0.05;
const MIN_PRICE_CENTS = 5;
const MAX_PRICE_CENTS = 85;

export interface BTCTradeSignal {
  bracket: string;
  marketTicker: string;
  marketTitle: string;
  side: "yes" | "no";
  ourProbability: number;
  marketPrice: number;
  edge: number;
  kellyFraction: number;
  contracts: number;
  costCents: number;
  limitPriceCents: number;
  reasoning: string;
}

export interface BTCTradeResult {
  signal: BTCTradeSignal;
  orderId?: string;
  status: "placed" | "skipped" | "failed";
  error?: string;
}

function getKalshiConfig(): Configuration {
  const apiKey = process.env.KALSHI_API_KEY;
  let privateKey = process.env.KALSHI_PRIVATE_KEY;

  if (!privateKey) {
    const keyPath = process.env.KALSHI_PRIVATE_KEY_PATH || "./kalshi-private-key.pem";
    try {
      privateKey = fs.readFileSync(path.resolve(keyPath), "utf-8");
    } catch {
      throw new Error("KALSHI_PRIVATE_KEY not set and key file not found");
    }
  }
  if (!apiKey) throw new Error("KALSHI_API_KEY must be set");

  return new Configuration({
    apiKey,
    privateKeyPem: privateKey,
    basePath: "https://api.elections.kalshi.com/trade-api/v2",
  });
}

export interface KalshiBTCMarket {
  ticker: string;
  title: string;
  subtitle: string;
  event_ticker: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  open_interest: number;
  close_time: string;
  bracketLow: number;
  bracketHigh: number;
}

// Fetch KXBTC markets from Kalshi
export async function findBTCMarkets(): Promise<KalshiBTCMarket[]> {
  const config = getKalshiConfig();
  const api = new MarketApi(config);
  const allMarkets: KalshiBTCMarket[] = [];

  // Search by series ticker prefix
  try {
    const res = await api.getMarkets(200, undefined, undefined, "KXBTC");
    const markets = (res.data.markets || []) as any[];
    console.log(`  KXBTC series: ${markets.length} markets found`);

    for (const m of markets) {
      const ticker = m.ticker || "";
      const title = m.title || "";

      // Parse bracket bounds from ticker
      // Format: KXBTC-26APR0400-T75299.99 (above $75,299.99)
      //         KXBTC-26APR0400-B75250   (below $75,250)
      //         or range brackets
      let bracketLow = 0;
      let bracketHigh = Infinity;

      // Try "T" threshold (above X)
      const aboveMatch = ticker.match(/-T([\d.]+)$/);
      if (aboveMatch) {
        bracketLow = parseFloat(aboveMatch[1]);
        bracketHigh = Infinity;
      }

      // Try "B" threshold (below X)
      const belowMatch = ticker.match(/-B([\d.]+)$/);
      if (belowMatch) {
        bracketHigh = parseFloat(belowMatch[1]);
        bracketLow = 0;
      }

      // Parse from title if ticker parsing fails
      if (bracketLow === 0 && bracketHigh === Infinity) {
        // "Bitcoin price range on Apr 4, 2026?" with subtitle showing range
        const rangeMatch = title.match(/\$([\d,]+(?:\.\d+)?)\s*(?:to|-)\s*\$([\d,]+(?:\.\d+)?)/i);
        if (rangeMatch) {
          bracketLow = parseFloat(rangeMatch[1].replace(/,/g, ""));
          bracketHigh = parseFloat(rangeMatch[2].replace(/,/g, ""));
        }
      }

      allMarkets.push({
        ticker,
        title,
        subtitle: m.subtitle || m.yes_sub_title || "",
        event_ticker: m.event_ticker || "",
        yes_bid: m.yes_bid ?? 0,
        yes_ask: m.yes_ask ?? 0,
        no_bid: m.no_bid ?? 0,
        no_ask: m.no_ask ?? 0,
        volume: m.volume ?? 0,
        open_interest: m.open_interest ?? 0,
        close_time: m.close_time || "",
        bracketLow,
        bracketHigh,
      });
    }
  } catch (err) {
    console.error("KXBTC fetch error:", err instanceof Error ? err.message : err);
  }

  // Sort by bracket low
  allMarkets.sort((a, b) => a.bracketLow - b.bracketLow);
  return allMarkets;
}

// Generate trade signals
export function generateBTCSignals(
  btcData: BTCPriceData,
  markets: KalshiBTCMarket[],
  balanceCents: number
): BTCTradeSignal[] {
  const signals: BTCTradeSignal[] = [];

  // Compute hours until first market closes
  const now = Date.now();
  const firstClose = markets.reduce(
    (min, m) => Math.min(min, new Date(m.close_time).getTime()),
    Infinity
  );
  const hoursAhead = Math.max(1, (firstClose - now) / (1000 * 60 * 60));

  // Build brackets from markets
  const brackets = markets
    .filter((m) => m.bracketLow > 0 || m.bracketHigh < Infinity)
    .map((m) => ({ low: m.bracketLow, high: m.bracketHigh }));

  // Compute model probabilities
  const probs = computeBTCBracketProbabilities(btcData, brackets, hoursAhead);
  const probMap = new Map<string, BracketProbability>();
  for (const p of probs) {
    probMap.set(`${p.bracketLow}-${p.bracketHigh}`, p);
  }

  for (const market of markets) {
    const key = `${market.bracketLow}-${market.bracketHigh}`;
    const prob = probMap.get(key);
    if (!prob) continue;

    const yesBid = (market.yes_bid || 0) / 100;
    const yesAsk = (market.yes_ask || 0) / 100;
    const noBid = (market.no_bid || 0) / 100;
    const noAsk = (market.no_ask || 0) / 100;

    // Check YES side
    if (yesAsk > 0 && yesAsk * 100 >= MIN_PRICE_CENTS && yesAsk * 100 <= MAX_PRICE_CENTS) {
      const edge = prob.probability - yesAsk;
      if (edge >= MIN_EDGE) {
        const signal = buildBTCSignal(market, "yes", prob.probability, yesAsk, edge, balanceCents);
        if (signal) signals.push(signal);
      }
    }

    // Check NO side
    const noProb = 1 - prob.probability;
    if (noAsk > 0 && noAsk * 100 >= MIN_PRICE_CENTS && noAsk * 100 <= MAX_PRICE_CENTS) {
      const edge = noProb - noAsk;
      if (edge >= MIN_EDGE) {
        const signal = buildBTCSignal(market, "no", noProb, noAsk, edge, balanceCents);
        if (signal) signals.push(signal);
      }
    }
  }

  signals.sort((a, b) => b.edge - a.edge);
  return signals;
}

function buildBTCSignal(
  market: KalshiBTCMarket,
  side: "yes" | "no",
  ourProb: number,
  marketPrice: number,
  edge: number,
  balanceCents: number
): BTCTradeSignal | null {
  const b = (1 - marketPrice) / marketPrice;
  const p = ourProb;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  const kelly = Math.max(0, fullKelly * KELLY_FRACTION);
  if (kelly <= 0) return null;

  const maxBet = Math.floor(balanceCents * MAX_POSITION_PCT);
  const kellyBet = Math.floor(balanceCents * kelly);
  const bet = Math.min(kellyBet, maxBet);
  const priceCents = Math.round(marketPrice * 100);
  const limitPrice = Math.max(MIN_PRICE_CENTS, priceCents - 1); // 1¢ inside spread
  const contracts = Math.max(1, Math.floor(bet / limitPrice));
  const cost = contracts * limitPrice;

  return {
    bracket: market.bracketLow > 0 && market.bracketHigh < Infinity
      ? `$${market.bracketLow.toLocaleString()} - $${market.bracketHigh.toLocaleString()}`
      : market.bracketLow > 0
        ? `Above $${market.bracketLow.toLocaleString()}`
        : `Below $${market.bracketHigh.toLocaleString()}`,
    marketTicker: market.ticker,
    marketTitle: market.title,
    side,
    ourProbability: Math.round(ourProb * 1000) / 1000,
    marketPrice: Math.round(marketPrice * 1000) / 1000,
    edge: Math.round(edge * 1000) / 1000,
    kellyFraction: Math.round(kelly * 1000) / 1000,
    contracts,
    costCents: cost,
    limitPriceCents: limitPrice,
    reasoning: `${side.toUpperCase()} ${market.ticker}: our=${(ourProb * 100).toFixed(1)}% vs market=${(marketPrice * 100).toFixed(1)}¢, edge=${(edge * 100).toFixed(1)}%, Kelly=${(kelly * 100).toFixed(1)}%`,
  };
}

// Execute trades
export async function executeBTCTrades(
  signals: BTCTradeSignal[],
  dryRun: boolean = true
): Promise<BTCTradeResult[]> {
  const results: BTCTradeResult[] = [];

  if (dryRun) {
    console.log("\n=== DRY RUN ===\n");
    for (const s of signals) {
      console.log(`  ${s.side.toUpperCase()} ${s.bracket}`);
      console.log(`    Edge: ${(s.edge * 100).toFixed(1)}% | Our: ${(s.ourProbability * 100).toFixed(1)}% vs Market: ${(s.marketPrice * 100).toFixed(1)}%`);
      console.log(`    ${s.contracts} contracts @ ${s.limitPriceCents}¢ = $${(s.costCents / 100).toFixed(2)}`);
      results.push({ signal: s, status: "skipped" });
    }
    return results;
  }

  const config = getKalshiConfig();
  const ordersApi = new OrdersApi(config);

  for (const s of signals) {
    try {
      console.log(`  Placing ${s.side.toUpperCase()} limit: ${s.marketTicker}`);
      const orderReq: any = {
        ticker: s.marketTicker,
        action: "buy",
        side: s.side,
        count: s.contracts,
        type: "limit",
      };
      if (s.side === "yes") orderReq.yes_price = s.limitPriceCents;
      else orderReq.no_price = s.limitPriceCents;

      const res = await ordersApi.createOrder(orderReq);
      const order = res.data.order as any;
      console.log(`    Placed: ${order.order_id}`);
      results.push({ signal: s, orderId: order.order_id, status: "placed" });
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    Failed: ${msg}`);
      results.push({ signal: s, status: "failed", error: msg });
    }
  }
  return results;
}

export async function getBalanceCents(): Promise<number> {
  const config = getKalshiConfig();
  const api = new PortfolioApi(config);
  const res = await api.getBalance();
  return res.data.balance;
}
