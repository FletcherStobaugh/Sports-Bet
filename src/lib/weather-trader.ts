// ============================================================
// Weather Bracket Trader — Kalshi Weather Bot Core
//
// Compares GFS ensemble probabilities against Kalshi market
// prices to find mispricings. Places MAKER (limit) orders
// when edge exceeds threshold. Uses fractional Kelly criterion
// for position sizing.
//
// RULES:
// 1. Always be a MAKER (limit orders) — 75% lower fees
// 2. Only trade when edge > 8%
// 3. Fractional Kelly (0.2x) for position sizing
// 4. Max 5% of bankroll per single trade
// 5. Never buy contracts priced < $0.05 or > $0.85
// ============================================================

import type { EnsembleForecast, BracketProbability } from "./weather-api";
import { computeBracketProbabilities, generateBrackets } from "./weather-api";
import {
  Configuration,
  MarketApi,
  OrdersApi,
  PortfolioApi,
} from "kalshi-typescript";

// --- Configuration ---

const MIN_EDGE = 0.08; // 8% minimum edge to trade
const KELLY_FRACTION = 0.2; // 20% Kelly (conservative)
const MAX_POSITION_PCT = 0.05; // Max 5% of bankroll per trade
const MIN_PRICE_CENTS = 5; // Don't buy below 5¢ (longshot trap)
const MAX_PRICE_CENTS = 85; // Don't buy above 85¢ (low upside)
const ORDER_OFFSET_CENTS = 1; // Place limit 1¢ inside the spread (maker)

export interface TradeSignal {
  city: string;
  date: string;
  bracket: string;
  marketTicker: string;
  side: "yes" | "no";
  ourProbability: number;
  marketPrice: number; // 0-1 implied probability
  edge: number;
  kellyFraction: number;
  recommendedContracts: number;
  recommendedCostCents: number;
  limitPriceCents: number;
  reasoning: string;
}

export interface TradeResult {
  signal: TradeSignal;
  orderId?: string;
  status: "placed" | "skipped" | "failed";
  error?: string;
}

function getKalshiConfig(): Configuration {
  const apiKey = process.env.KALSHI_API_KEY;
  let privateKey = process.env.KALSHI_PRIVATE_KEY;

  // Load from file if env var points to a path or isn't set
  if (!privateKey) {
    const keyPath = process.env.KALSHI_PRIVATE_KEY_PATH || "./kalshi-private-key.pem";
    try {
      const fs = require("fs");
      const path = require("path");
      const resolved = path.resolve(keyPath);
      privateKey = fs.readFileSync(resolved, "utf-8");
    } catch {
      throw new Error("KALSHI_PRIVATE_KEY not set and key file not found");
    }
  }

  if (!apiKey) {
    throw new Error("KALSHI_API_KEY must be set");
  }

  return new Configuration({
    apiKey,
    privateKeyPem: privateKey,
    basePath: "https://api.elections.kalshi.com/trade-api/v2",
  });
}

// --- Find tradeable weather markets on Kalshi ---

interface KalshiWeatherMarket {
  ticker: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  close_time: string;
  bracketLow?: number;
  bracketHigh?: number;
}

export async function findWeatherMarkets(
  dateStr: string
): Promise<KalshiWeatherMarket[]> {
  const config = getKalshiConfig();
  const api = new MarketApi(config);

  // Search for weather/temperature markets
  // Kalshi uses tickers like KXHIGHNY-26APR03-T75 (high temp in NY on Apr 3)
  const allMarkets: KalshiWeatherMarket[] = [];
  let cursor: string | undefined;

  // Paginate through markets looking for weather ones
  for (let page = 0; page < 5; page++) {
    try {
      const res = await api.getMarkets(200, cursor);
      const markets = (res.data.markets || []) as any[];
      if (markets.length === 0) break;

      for (const m of markets) {
        const ticker = (m.ticker || "") as string;
        const title = (m.title || "") as string;

        // Match weather market tickers (KXHIGH*)
        if (
          ticker.startsWith("KXHIGH") ||
          title.toLowerCase().includes("high temperature") ||
          title.toLowerCase().includes("temperature")
        ) {
          // Parse bracket from title, e.g. "High temperature 75°F to 79°F"
          const bracketMatch = title.match(/(\d+)°?F?\s*to\s*(\d+)°?F?/i);
          // Or from ticker: KXHIGHNY-26APR03-B75 (below 75) or -T75 (above 75)
          const tickerMatch = ticker.match(
            /KXHIGH\w+-\w+-[TB](\d+)/
          );

          allMarkets.push({
            ticker,
            title,
            yes_bid: m.yes_bid ?? 0,
            yes_ask: m.yes_ask ?? 0,
            no_bid: m.no_bid ?? 0,
            no_ask: m.no_ask ?? 0,
            volume: m.volume ?? 0,
            close_time: m.close_time || "",
            bracketLow: bracketMatch ? parseInt(bracketMatch[1]) : undefined,
            bracketHigh: bracketMatch ? parseInt(bracketMatch[2]) : undefined,
          });
        }
      }

      cursor = (res.data as any).cursor;
      if (!cursor) break;
    } catch (err) {
      console.error(
        "Market fetch error:",
        err instanceof Error ? err.message : err
      );
      break;
    }
  }

  console.log(`Found ${allMarkets.length} weather markets on Kalshi`);
  return allMarkets;
}

// --- Generate trade signals ---

export function generateSignals(
  forecast: EnsembleForecast,
  markets: KalshiWeatherMarket[],
  balanceCents: number
): TradeSignal[] {
  const signals: TradeSignal[] = [];

  // Compute probabilities for all brackets
  const brackets = generateBrackets(forecast);
  const probs = computeBracketProbabilities(forecast, brackets);

  // Build lookup: bracketLow -> probability
  const probMap = new Map<string, BracketProbability>();
  for (const p of probs) {
    probMap.set(`${p.bracketLow}-${p.bracketHigh}`, p);
  }

  // Match markets to our probability estimates
  for (const market of markets) {
    // Skip markets with no bracket info
    if (market.bracketLow == null || market.bracketHigh == null) continue;

    const key = `${market.bracketLow}-${market.bracketHigh}`;
    const prob = probMap.get(key);
    if (!prob) continue;

    // Get market-implied probability from best available price
    const yesBid = market.yes_bid / 100; // Convert cents to probability
    const yesAsk = market.yes_ask / 100;
    const noBid = market.no_bid / 100;
    const noAsk = market.no_ask / 100;

    // Evaluate YES side: our prob vs ask price (cost to buy YES)
    if (yesAsk > 0 && yesAsk >= MIN_PRICE_CENTS / 100 && yesAsk <= MAX_PRICE_CENTS / 100) {
      const edge = prob.probability - yesAsk;
      if (edge >= MIN_EDGE) {
        const signal = buildSignal(
          forecast,
          prob,
          market,
          "yes",
          prob.probability,
          yesAsk,
          edge,
          balanceCents
        );
        if (signal) signals.push(signal);
      }
    }

    // Evaluate NO side: (1 - our prob) vs no ask price
    const noProb = 1 - prob.probability;
    if (noAsk > 0 && noAsk >= MIN_PRICE_CENTS / 100 && noAsk <= MAX_PRICE_CENTS / 100) {
      const edge = noProb - noAsk;
      if (edge >= MIN_EDGE) {
        const signal = buildSignal(
          forecast,
          prob,
          market,
          "no",
          noProb,
          noAsk,
          edge,
          balanceCents
        );
        if (signal) signals.push(signal);
      }
    }
  }

  // Sort by edge (highest first)
  signals.sort((a, b) => b.edge - a.edge);
  return signals;
}

function buildSignal(
  forecast: EnsembleForecast,
  prob: BracketProbability,
  market: KalshiWeatherMarket,
  side: "yes" | "no",
  ourProb: number,
  marketPrice: number,
  edge: number,
  balanceCents: number
): TradeSignal | null {
  // Kelly criterion: f* = (bp - q) / b
  // where b = net odds (payout/cost - 1), p = our prob, q = 1-p
  const payout = 1.0; // Binary contract pays $1
  const cost = marketPrice;
  const b = (payout - cost) / cost; // net odds
  const p = ourProb;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  const kellyFraction = Math.max(0, fullKelly * KELLY_FRACTION);

  if (kellyFraction <= 0) return null;

  // Position sizing
  const maxBetCents = Math.floor(balanceCents * MAX_POSITION_PCT);
  const kellyBetCents = Math.floor(balanceCents * kellyFraction);
  const betCents = Math.min(kellyBetCents, maxBetCents);

  const priceCents = Math.round(marketPrice * 100);
  // Place limit order 1¢ inside spread to be a maker
  const limitPriceCents =
    side === "yes"
      ? Math.min(priceCents - ORDER_OFFSET_CENTS, priceCents)
      : Math.min(priceCents - ORDER_OFFSET_CENTS, priceCents);

  if (limitPriceCents < MIN_PRICE_CENTS) return null;

  const contracts = Math.max(1, Math.floor(betCents / limitPriceCents));
  const totalCost = contracts * limitPriceCents;

  return {
    city: forecast.city.name,
    date: forecast.date,
    bracket: prob.label,
    marketTicker: market.ticker,
    side,
    ourProbability: Math.round(ourProb * 1000) / 1000,
    marketPrice: Math.round(marketPrice * 1000) / 1000,
    edge: Math.round(edge * 1000) / 1000,
    kellyFraction: Math.round(kellyFraction * 1000) / 1000,
    recommendedContracts: contracts,
    recommendedCostCents: totalCost,
    limitPriceCents,
    reasoning: `${forecast.city.name} ${prob.label}: ${prob.ensembleHits}/${prob.totalMembers} ensemble members (${(ourProb * 100).toFixed(1)}%) vs market ${(marketPrice * 100).toFixed(1)}¢. Edge: ${(edge * 100).toFixed(1)}%. Kelly: ${(kellyFraction * 100).toFixed(1)}% of bankroll.`,
  };
}

// --- Execute trades ---

export async function executeTrades(
  signals: TradeSignal[],
  dryRun: boolean = true
): Promise<TradeResult[]> {
  const results: TradeResult[] = [];

  if (dryRun) {
    console.log("\n=== DRY RUN — no orders placed ===\n");
    for (const signal of signals) {
      console.log(
        `  SIGNAL: ${signal.side.toUpperCase()} ${signal.bracket} (${signal.city})`
      );
      console.log(`    Edge: ${(signal.edge * 100).toFixed(1)}% | Our: ${(signal.ourProbability * 100).toFixed(1)}% vs Market: ${(signal.marketPrice * 100).toFixed(1)}%`);
      console.log(`    ${signal.recommendedContracts} contracts @ ${signal.limitPriceCents}¢ = $${(signal.recommendedCostCents / 100).toFixed(2)}`);
      console.log(`    ${signal.reasoning}`);
      results.push({ signal, status: "skipped" });
    }
    return results;
  }

  const config = getKalshiConfig();
  const ordersApi = new OrdersApi(config);

  for (const signal of signals) {
    try {
      console.log(
        `  Placing ${signal.side.toUpperCase()} limit order: ${signal.marketTicker}`
      );
      console.log(`    ${signal.recommendedContracts} contracts @ ${signal.limitPriceCents}¢`);

      const orderReq: any = {
        ticker: signal.marketTicker,
        action: "buy",
        side: signal.side,
        count: signal.recommendedContracts,
        type: "limit",
      };

      if (signal.side === "yes") {
        orderReq.yes_price = signal.limitPriceCents;
      } else {
        orderReq.no_price = signal.limitPriceCents;
      }

      const res = await ordersApi.createOrder(orderReq);
      const order = res.data.order as any;

      console.log(`    Order placed: ${order.order_id}`);
      results.push({
        signal,
        orderId: order.order_id,
        status: "placed",
      });

      // Rate limit between orders
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    Order failed: ${msg}`);
      results.push({ signal, status: "failed", error: msg });
    }
  }

  return results;
}

// --- Get account balance ---

export async function getBalanceCents(): Promise<number> {
  const config = getKalshiConfig();
  const api = new PortfolioApi(config);
  const res = await api.getBalance();
  return res.data.balance;
}
