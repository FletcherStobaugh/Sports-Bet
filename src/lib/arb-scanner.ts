// ============================================================
// Structural Arbitrage Scanner for Kalshi
//
// Scans ALL open markets for risk-free arbitrage:
// 1. Single-market arb: YES ask + NO ask < $1.00 (after fees)
// 2. Bracket arb: Sum of all bracket YES prices < $1.00
//
// When found, buys both sides for guaranteed profit on resolution.
// ============================================================

import { Configuration, MarketApi, OrdersApi, PortfolioApi } from "kalshi-typescript";
import * as fs from "fs";
import * as path from "path";

// Kalshi fee formula: round_up(fee_rate * contracts * price * (1-price))
// Taker: 0.07, Maker: 0.0175
const TAKER_FEE_RATE = 0.07;
const MAKER_FEE_RATE = 0.0175;

// Minimum profit in cents to execute (after fees)
const MIN_PROFIT_CENTS = 2; // $0.02 minimum profit per contract

export interface ArbOpportunity {
  type: "single" | "bracket";
  ticker: string;
  title: string;
  yesAskCents: number;
  noAskCents: number;
  totalCostCents: number;
  feesCents: number;
  profitPerContractCents: number;
  maxContracts: number;
  totalProfitCents: number;
  details: string;
}

export interface ArbResult {
  opportunity: ArbOpportunity;
  yesOrderId?: string;
  noOrderId?: string;
  status: "executed" | "partial" | "failed" | "skipped";
  error?: string;
}

function getKalshiConfig(): Configuration {
  const apiKey = process.env.KALSHI_API_KEY;
  let privateKey = process.env.KALSHI_PRIVATE_KEY;
  if (!privateKey) {
    try {
      privateKey = fs.readFileSync(path.resolve(process.env.KALSHI_PRIVATE_KEY_PATH || "./kalshi-private-key.pem"), "utf-8");
    } catch {
      throw new Error("KALSHI_PRIVATE_KEY not set and key file not found");
    }
  }
  if (!apiKey) throw new Error("KALSHI_API_KEY must be set");
  return new Configuration({ apiKey, privateKeyPem: privateKey, basePath: "https://api.elections.kalshi.com/trade-api/v2" });
}

// Calculate taker fee in cents for a given price and contract count
function takerFee(priceCents: number, contracts: number): number {
  const p = priceCents / 100; // Convert to 0-1
  const fee = TAKER_FEE_RATE * contracts * p * (1 - p);
  return Math.ceil(fee * 100); // Round up, in cents
}

// Calculate maker fee
function makerFee(priceCents: number, contracts: number): number {
  const p = priceCents / 100;
  const fee = MAKER_FEE_RATE * contracts * p * (1 - p);
  return Math.ceil(fee * 100);
}

interface RawMarket {
  ticker: string;
  title: string;
  event_ticker: string;
  status: string;
  yes_ask_cents: number;
  no_ask_cents: number;
  yes_bid_cents: number;
  no_bid_cents: number;
  volume: number;
  close_time: string;
  open_time: string;
}

// Fetch ALL open markets with correct price parsing
export async function fetchAllMarkets(): Promise<RawMarket[]> {
  const config = getKalshiConfig();
  const api = new MarketApi(config);
  const allMarkets: RawMarket[] = [];
  let cursor: string | undefined;
  let pages = 0;

  while (pages < 50) { // Max 50 pages = 10,000 markets
    try {
      const res = await api.getMarkets(200, cursor, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "open");
      const markets = (res.data.markets || []) as any[];
      if (markets.length === 0) break;

      for (const m of markets) {
        // Parse dollar string prices to cents
        const yesAsk = Math.round(parseFloat(m.yes_ask_dollars || m.yes_ask || "0") * 100);
        const noAsk = Math.round(parseFloat(m.no_ask_dollars || m.no_ask || "0") * 100);
        const yesBid = Math.round(parseFloat(m.yes_bid_dollars || m.yes_bid || "0") * 100);
        const noBid = Math.round(parseFloat(m.no_bid_dollars || m.no_bid || "0") * 100);

        // Skip markets with no prices
        if (yesAsk === 0 && noAsk === 0) continue;

        // Skip markets that haven't opened
        const openTime = m.open_time || "";
        if (openTime && new Date(openTime).getTime() > Date.now()) continue;

        allMarkets.push({
          ticker: m.ticker || "",
          title: m.title || "",
          event_ticker: m.event_ticker || "",
          status: m.status || "",
          yes_ask_cents: yesAsk,
          no_ask_cents: noAsk,
          yes_bid_cents: yesBid,
          no_bid_cents: noBid,
          volume: parseInt(m.volume_dollars || String(m.volume || 0)) || 0,
          close_time: m.close_time || "",
          open_time: openTime,
        });
      }

      cursor = (res.data as any).cursor;
      if (!cursor) break;
      pages++;
    } catch (err) {
      console.error("Market fetch error:", err instanceof Error ? err.message : err);
      break;
    }
  }

  return allMarkets;
}

// Scan for single-market arbitrage: YES ask + NO ask < 100¢
export function scanSingleArbs(markets: RawMarket[], balanceCents: number): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];

  for (const m of markets) {
    if (m.yes_ask_cents <= 0 || m.no_ask_cents <= 0) continue;
    if (m.yes_ask_cents >= 100 || m.no_ask_cents >= 100) continue;

    const totalCost = m.yes_ask_cents + m.no_ask_cents;
    if (totalCost >= 100) continue; // No arb if costs >= $1

    // Calculate fees for 1 contract
    const yesFee = takerFee(m.yes_ask_cents, 1);
    const noFee = takerFee(m.no_ask_cents, 1);
    const totalFees = yesFee + noFee;

    // Profit = $1.00 payout - total cost - fees
    const profitPerContract = 100 - totalCost - totalFees;

    if (profitPerContract < MIN_PROFIT_CENTS) continue;

    // Max contracts we can buy (limited by balance)
    const costPerPair = totalCost + totalFees;
    const maxContracts = Math.floor(balanceCents / costPerPair);
    if (maxContracts < 1) continue;

    opportunities.push({
      type: "single",
      ticker: m.ticker,
      title: m.title,
      yesAskCents: m.yes_ask_cents,
      noAskCents: m.no_ask_cents,
      totalCostCents: totalCost,
      feesCents: totalFees,
      profitPerContractCents: profitPerContract,
      maxContracts,
      totalProfitCents: profitPerContract * maxContracts,
      details: `YES@${m.yes_ask_cents}¢ + NO@${m.no_ask_cents}¢ = ${totalCost}¢ + ${totalFees}¢ fees = ${totalCost + totalFees}¢ cost → ${profitPerContract}¢ profit/contract`,
    });
  }

  // Sort by profit per contract (highest first)
  opportunities.sort((a, b) => b.profitPerContractCents - a.profitPerContractCents);
  return opportunities;
}

// Scan for bracket arbitrage: sum of all bracket YES prices in an event < $1.00
export function scanBracketArbs(markets: RawMarket[], balanceCents: number): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];

  // Group markets by event_ticker
  const events = new Map<string, RawMarket[]>();
  for (const m of markets) {
    if (!m.event_ticker) continue;
    if (!events.has(m.event_ticker)) events.set(m.event_ticker, []);
    events.get(m.event_ticker)!.push(m);
  }

  for (const [eventTicker, eventMarkets] of events) {
    if (eventMarkets.length < 2) continue;

    // Sum of all YES ask prices — in a complete bracket set, exactly one resolves YES
    const totalYesAsk = eventMarkets.reduce((sum, m) => sum + m.yes_ask_cents, 0);
    if (totalYesAsk <= 0 || totalYesAsk >= 100) continue;

    // Calculate total fees for buying YES on all brackets
    const totalFees = eventMarkets.reduce((sum, m) => sum + takerFee(m.yes_ask_cents, 1), 0);
    const profitPerSet = 100 - totalYesAsk - totalFees;

    if (profitPerSet < MIN_PROFIT_CENTS) continue;

    const costPerSet = totalYesAsk + totalFees;
    const maxSets = Math.floor(balanceCents / costPerSet);
    if (maxSets < 1) continue;

    opportunities.push({
      type: "bracket",
      ticker: eventTicker,
      title: `Bracket arb: ${eventMarkets.length} markets in ${eventTicker}`,
      yesAskCents: totalYesAsk,
      noAskCents: 0,
      totalCostCents: totalYesAsk,
      feesCents: totalFees,
      profitPerContractCents: profitPerSet,
      maxContracts: maxSets,
      totalProfitCents: profitPerSet * maxSets,
      details: `${eventMarkets.length} brackets, sum of YES asks = ${totalYesAsk}¢ + ${totalFees}¢ fees → ${profitPerSet}¢ profit/set`,
    });
  }

  opportunities.sort((a, b) => b.profitPerContractCents - a.profitPerContractCents);
  return opportunities;
}

// Execute arbitrage — buy both sides simultaneously
export async function executeArb(
  opp: ArbOpportunity,
  contracts: number,
  dryRun: boolean = true
): Promise<ArbResult> {
  if (dryRun) {
    return { opportunity: opp, status: "skipped" };
  }

  const config = getKalshiConfig();
  const ordersApi = new OrdersApi(config);

  try {
    if (opp.type === "single") {
      // Buy YES
      const yesOrder = await ordersApi.createOrder({
        ticker: opp.ticker,
        action: "buy",
        side: "yes",
        count: contracts,
        type: "market",
        buy_max_cost: contracts * opp.yesAskCents,
      } as any);

      // Immediately buy NO
      const noOrder = await ordersApi.createOrder({
        ticker: opp.ticker,
        action: "buy",
        side: "no",
        count: contracts,
        type: "market",
        buy_max_cost: contracts * opp.noAskCents,
      } as any);

      return {
        opportunity: opp,
        yesOrderId: (yesOrder.data.order as any).order_id,
        noOrderId: (noOrder.data.order as any).order_id,
        status: "executed",
      };
    }

    // For bracket arbs, would need to buy YES on every bracket market
    // More complex — implement when we find a real bracket arb
    return { opportunity: opp, status: "skipped", error: "Bracket execution not yet implemented" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { opportunity: opp, status: "failed", error: msg };
  }
}

export async function getBalanceCents(): Promise<number> {
  const config = getKalshiConfig();
  const api = new PortfolioApi(config);
  const res = await api.getBalance();
  return res.data.balance;
}
