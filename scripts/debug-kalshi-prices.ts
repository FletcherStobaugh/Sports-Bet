// Debug: see raw Kalshi API response for BTC markets
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";

const API_KEY = process.env.KALSHI_API_KEY!;
let PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  PRIVATE_KEY = fs.readFileSync(path.resolve("./kalshi-private-key.pem"), "utf-8");
}

// Sign request using RSA-PSS (Kalshi's auth method)
function signRequest(method: string, urlPath: string, timestamp: string): string {
  const message = `${timestamp}\n${method}\n${urlPath}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message);
  return sign.sign({ key: PRIVATE_KEY!, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, "base64");
}

async function rawFetch(urlPath: string): Promise<any> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sig = signRequest("GET", urlPath, timestamp);

  const res = await fetch(`https://api.elections.kalshi.com${urlPath}`, {
    headers: {
      "KALSHI-ACCESS-KEY": API_KEY,
      "KALSHI-ACCESS-SIGNATURE": sig,
      "KALSHI-ACCESS-TIMESTAMP": timestamp,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // Get first page of KXBTC markets raw
  console.log("=== RAW KXBTC MARKET DATA ===\n");
  const data = await rawFetch("/trade-api/v2/markets?limit=5&series_ticker=KXBTC");

  // Show raw first market
  const first = data.markets?.[0];
  if (first) {
    console.log("First market (all fields):\n");
    console.log(JSON.stringify(first, null, 2));
  } else {
    console.log("No markets in response. Keys:", Object.keys(data));
    console.log(JSON.stringify(data).slice(0, 500));
  }
}

main().catch(e => console.error("Error:", e.message));
