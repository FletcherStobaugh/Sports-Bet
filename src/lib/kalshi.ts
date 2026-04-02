// ============================================================
// Kalshi API Client
// Handles auth, market discovery, and order placement
// Docs: https://trading-api.readme.io/reference
// ============================================================

import jwt from "jsonwebtoken";
import crypto from "crypto";

const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// --- Auth ---

function generateToken(): string {
  const apiKey = process.env.KALSHI_API_KEY;
  const privateKeyPem = process.env.KALSHI_PRIVATE_KEY;

  if (!apiKey || !privateKeyPem) {
    throw new Error("KALSHI_API_KEY and KALSHI_PRIVATE_KEY must be set");
  }

  // Kalshi uses RSA-signed JWTs for API auth
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: apiKey,
    iat: now,
    exp: now + 300, // 5 minute expiry
  };

  return jwt.sign(payload, privateKeyPem, { algorithm: "RS256" });
}

async function kalshiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${KALSHI_API_BASE}${path}`);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      url.searchParams.set(k, v);
    }
  }

  const token = generateToken();
  const res = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Kalshi API ${res.status}: ${errText}`);
  }

  return res.json();
}

// --- Account ---

export interface KalshiBalance {
  balance: number; // in cents
  payout: number;
}

export async function getBalance(): Promise<KalshiBalance> {
  const data = await kalshiFetch<{ balance: number; payout: number }>("/portfolio/balance");
  return data;
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

export interface KalshiEvent {
  event_ticker: string;
  title: string;
  category: string;
  markets: KalshiMarket[];
}

// Get markets for NBA/sports
export async function getNBAMarkets(): Promise<KalshiMarket[]> {
  // Search for NBA-related markets
  const data = await kalshiFetch<{ markets: KalshiMarket[]; cursor: string }>("/markets", {
    params: {
      limit: "200",
      status: "open",
      // Kalshi categorizes sports markets — search for NBA
      series_ticker: "NBA",
    },
  });

  return data.markets || [];
}

// Search markets by text
export async function searchMarkets(query: string): Promise<KalshiMarket[]> {
  const data = await kalshiFetch<{ markets: KalshiMarket[]; cursor: string }>("/markets", {
    params: {
      limit: "100",
      status: "open",
    },
  });

  // Filter by query text
  const q = query.toLowerCase();
  return (data.markets || []).filter(
    (m) =>
      m.title.toLowerCase().includes(q) ||
      m.subtitle?.toLowerCase().includes(q) ||
      m.ticker.toLowerCase().includes(q)
  );
}

// Get a specific event with all its markets
export async function getEvent(eventTicker: string): Promise<KalshiEvent> {
  const data = await kalshiFetch<{ event: KalshiEvent }>(`/events/${eventTicker}`);
  return data.event;
}

// Get a specific market
export async function getMarket(ticker: string): Promise<KalshiMarket> {
  const data = await kalshiFetch<{ market: KalshiMarket }>(`/markets/${ticker}`);
  return data.market;
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

export interface PlaceOrderParams {
  ticker: string;
  side: "yes" | "no"; // yes = over, no = under (typically)
  count: number; // number of contracts
  type: "market" | "limit";
  yes_price?: number; // limit price in cents (1-99)
  no_price?: number;
}

export async function placeOrder(params: PlaceOrderParams): Promise<KalshiOrder> {
  const body: Record<string, unknown> = {
    ticker: params.ticker,
    action: "buy",
    side: params.side,
    count: params.count,
    type: params.type,
  };

  if (params.type === "limit") {
    if (params.side === "yes" && params.yes_price) {
      body.yes_price = params.yes_price;
    } else if (params.side === "no" && params.no_price) {
      body.no_price = params.no_price;
    }
  }

  const data = await kalshiFetch<{ order: KalshiOrder }>("/portfolio/orders", {
    method: "POST",
    body,
  });

  return data.order;
}

// Get open orders
export async function getOpenOrders(): Promise<KalshiOrder[]> {
  const data = await kalshiFetch<{ orders: KalshiOrder[] }>("/portfolio/orders", {
    params: { status: "resting" },
  });
  return data.orders || [];
}

// Get positions
export interface KalshiPosition {
  ticker: string;
  market_exposure: number;
  resting_orders_count: number;
  total_traded: number;
  realized_pnl: number;
  fees_paid: number;
}

export async function getPositions(): Promise<KalshiPosition[]> {
  const data = await kalshiFetch<{ market_positions: KalshiPosition[] }>("/portfolio/positions");
  return data.market_positions || [];
}

// --- Convenience: Find NBA player prop market ---

export async function findPlayerPropMarket(
  playerName: string,
  statCategory: string
): Promise<KalshiMarket | null> {
  // Kalshi market titles typically look like:
  // "Will Nikola Jokic score 25+ points?" or "Jokic Over 25.5 Points"
  const searchTerms = [
    playerName.split(" ").pop() || playerName, // Last name
    statCategory === "pts" ? "points" :
    statCategory === "reb" ? "rebounds" :
    statCategory === "ast" ? "assists" :
    statCategory === "fg3m" ? "threes" :
    statCategory,
  ];

  const markets = await searchMarkets(searchTerms[0]);
  const statTerm = searchTerms[1].toLowerCase();

  // Find a market matching both player and stat
  const match = markets.find((m) => {
    const title = m.title.toLowerCase();
    return (
      title.includes(searchTerms[0].toLowerCase()) &&
      (title.includes(statTerm) || title.includes(statCategory))
    );
  });

  return match || null;
}
