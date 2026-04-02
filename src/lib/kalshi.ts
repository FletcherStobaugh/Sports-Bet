// ============================================================
// Kalshi API Client — using official kalshi-typescript SDK
// ============================================================

import { Configuration, MarketApi, OrdersApi, PortfolioApi, EventsApi } from "kalshi-typescript";

function getConfig(): Configuration {
  const apiKey = process.env.KALSHI_API_KEY;
  const privateKey = process.env.KALSHI_PRIVATE_KEY;

  if (!apiKey || !privateKey) {
    throw new Error("KALSHI_API_KEY and KALSHI_PRIVATE_KEY must be set");
  }

  return new Configuration({
    apiKey,
    privateKeyPem: privateKey,
    basePath: "https://api.elections.kalshi.com/trade-api/v2",
  });
}

// --- Account ---

export async function getBalance(): Promise<{ balance: number }> {
  const api = new PortfolioApi(getConfig());
  const res = await api.getBalance();
  return { balance: res.data.balance };
}

// --- Markets ---

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  close_time: string;
  result: string;
  category: string;
  yes_sub_title: string;
  no_sub_title: string;
}

export async function getNBAMarkets(): Promise<KalshiMarket[]> {
  const api = new MarketApi(getConfig());

  // Try to get NBA series markets
  try {
    const res = await api.getMarkets(200, undefined, undefined, "KXNBA", undefined, undefined, undefined, undefined, undefined, undefined, undefined, "open");
    return (res.data.markets || []) as unknown as KalshiMarket[];
  } catch {
    // Fallback: search broader sports markets
  }

  // Try broader search
  try {
    const res = await api.getMarkets(200, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "open");
    const markets = (res.data.markets || []) as unknown as KalshiMarket[];
    // Filter for NBA/sports
    return markets.filter((m) => {
      const t = (m.title || "").toLowerCase();
      return t.includes("nba") || t.includes("points") || t.includes("rebounds") || t.includes("assists");
    });
  } catch (err) {
    console.error("Failed to fetch markets:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function searchMarkets(query: string): Promise<KalshiMarket[]> {
  const api = new MarketApi(getConfig());
  const res = await api.getMarkets(200, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "open");
  const q = query.toLowerCase();
  return ((res.data.markets || []) as unknown as KalshiMarket[]).filter(
    (m) =>
      (m.title || "").toLowerCase().includes(q) ||
      (m.subtitle || "").toLowerCase().includes(q) ||
      (m.ticker || "").toLowerCase().includes(q)
  );
}

export async function getMarket(ticker: string): Promise<KalshiMarket> {
  const api = new MarketApi(getConfig());
  const res = await api.getMarket(ticker);
  return res.data.market as unknown as KalshiMarket;
}

// --- Orders ---

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  type: "market" | "limit";
  status: string;
  count: number;
  yes_price: number;
  no_price: number;
  created_time: string;
}

export async function placeOrder(params: {
  ticker: string;
  side: "yes" | "no";
  count: number;
  type: "market" | "limit";
  yes_price?: number;
  no_price?: number;
}): Promise<KalshiOrder> {
  const api = new OrdersApi(getConfig());

  const orderReq: {
    ticker: string;
    action: "buy";
    side: "yes" | "no";
    count: number;
    yes_price?: number;
    no_price?: number;
    buy_max_cost?: number;
  } = {
    ticker: params.ticker,
    action: "buy",
    side: params.side,
    count: params.count,
  };

  if (params.type === "limit") {
    if (params.side === "yes" && params.yes_price) orderReq.yes_price = params.yes_price;
    if (params.side === "no" && params.no_price) orderReq.no_price = params.no_price;
  } else {
    // Market order: set buy_max_cost high enough to fill
    orderReq.buy_max_cost = params.count * 99; // max possible cost
  }

  const res = await api.createOrder(orderReq);
  return res.data.order as unknown as KalshiOrder;
}

export async function getPositions(): Promise<unknown[]> {
  const api = new PortfolioApi(getConfig());
  const res = await api.getPositions();
  return res.data.market_positions || [];
}
