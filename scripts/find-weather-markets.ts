// Quick script to discover actual Kalshi weather market tickers
// Run from GitHub Actions or hotspot (school wifi blocks Kalshi)
import "dotenv/config";
import { Configuration, MarketApi, EventsApi } from "kalshi-typescript";
import * as fs from "fs";
import * as path from "path";

let privateKey = process.env.KALSHI_PRIVATE_KEY;
if (!privateKey) {
  try {
    privateKey = fs.readFileSync(path.resolve("./kalshi-private-key.pem"), "utf-8");
  } catch {}
}

const config = new Configuration({
  apiKey: process.env.KALSHI_API_KEY!,
  privateKeyPem: privateKey!,
  basePath: "https://api.elections.kalshi.com/trade-api/v2",
});

async function main() {
  const markets = new MarketApi(config);
  const events = new EventsApi(config);

  // Search events for weather/climate
  console.log("=== WEATHER EVENTS ===\n");
  try {
    const res = await events.getEvents(200);
    const evts = (res.data.events || []) as any[];
    const weather = evts.filter((e: any) => {
      const t = `${e.title} ${e.category} ${e.ticker}`.toLowerCase();
      return t.includes("weather") || t.includes("temperature") || t.includes("climate") ||
             t.includes("high") || t.includes("forecast") || t.includes("degree");
    });
    console.log(`Found ${weather.length} weather events out of ${evts.length} total\n`);
    for (const e of weather) {
      console.log(`  [${e.ticker}] ${e.title} | cat: ${e.category}`);
    }
  } catch (e: any) {
    console.error("Events error:", e.message?.slice(0, 200));
  }

  // Search markets with weather keywords
  console.log("\n=== WEATHER MARKETS (keyword search) ===\n");
  const keywords = ["temperature", "weather", "high", "forecast", "degree", "fahrenheit"];
  const found = new Map<string, any>();

  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    try {
      const res = await markets.getMarkets(200, cursor);
      const mkts = (res.data.markets || []) as any[];
      if (mkts.length === 0) break;

      for (const m of mkts) {
        const text = `${m.ticker} ${m.title} ${m.subtitle} ${m.event_ticker}`.toLowerCase();
        if (keywords.some(k => text.includes(k))) {
          found.set(m.ticker, m);
        }
      }

      cursor = (res.data as any).cursor;
      if (!cursor) break;
    } catch { break; }
  }

  console.log(`Found ${found.size} weather markets across all pages\n`);
  for (const [ticker, m] of found) {
    console.log(`  [${ticker}] ${m.title} | yes: ${m.yes_bid}/${m.yes_ask} | vol: ${m.volume} | close: ${m.close_time}`);
  }

  // Try specific series prefixes
  console.log("\n=== SPECIFIC SERIES SEARCH ===\n");
  for (const prefix of ["KXHIGH", "HIGHTEMP", "WEATHER", "TEMP", "KXTEMP", "KXWEATHER"]) {
    try {
      const res = await markets.getMarkets(10, undefined, undefined, prefix);
      const mkts = (res.data.markets || []) as any[];
      if (mkts.length > 0) {
        console.log(`  ${prefix}: ${mkts.length} markets`);
        for (const m of mkts.slice(0, 3) as any[]) {
          console.log(`    [${m.ticker}] ${m.title}`);
        }
      }
    } catch {}
  }
}

main().catch(e => console.error("Fatal:", e.message));
