import { getNBAMarkets, getBalance } from "../src/lib/kalshi";
import fs from "fs";

if (!process.env.KALSHI_PRIVATE_KEY) {
  process.env.KALSHI_PRIVATE_KEY = fs.readFileSync("kalshi-private-key.pem", "utf-8");
}

async function main() {
  console.log("Fetching Kalshi NBA markets...\n");

  const balance = await getBalance();
  console.log(`Balance: $${(balance.balance / 100).toFixed(2)}\n`);

  const markets = await getNBAMarkets();
  console.log(`Found ${markets.length} NBA markets:\n`);

  for (const m of markets) {
    console.log(`  ${m.ticker}`);
    console.log(`    Title: ${m.title}`);
    console.log(`    Subtitle: ${m.subtitle || "(none)"}`);
    console.log(`    Yes: ${m.yes_bid}-${m.yes_ask}  No: ${m.no_bid}-${m.no_ask}`);
    console.log(`    Volume: ${m.volume}  Status: ${m.status}`);
    console.log();
  }
}

main().catch(console.error);
