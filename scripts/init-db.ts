// Run: npx tsx scripts/init-db.ts
// Initializes the Neon Postgres database tables

import { initDB } from "../src/lib/db";

async function main() {
  console.log("Initializing database...");
  await initDB();
  console.log("Database initialized successfully!");
}

main().catch((err) => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
