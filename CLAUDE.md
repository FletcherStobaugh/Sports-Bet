@AGENTS.md

# Sports-Bet

Automated NBA player prop value finder for PrizePicks.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind
- Neon Postgres (serverless)
- ball-dont-lie API for NBA stats
- Playwright for PrizePicks scraping
- GitHub Actions for daily pipeline
- Vercel for hosting

## Architecture
- `src/lib/` — core logic (types, db, stats API client, analyzer engine, scraper, resolver)
- `src/app/` — Next.js pages + API routes
- `src/components/` — React UI components
- `scripts/` — pipeline entry points for GitHub Actions
- `.github/workflows/` — cron jobs (daily scrape+analyze, nightly resolve)

## Pipeline Schedule
1. **2:00 PM ET** — Scrape PrizePicks NBA props + fetch stats + run analysis
2. **1:00 AM ET** — Resolve bets against final box scores

## Key Env Vars
- `DATABASE_URL` — Neon Postgres connection string
- `BDL_API_KEY` — ball-dont-lie API key (optional for free tier)
- `PIPELINE_SECRET` — protects pipeline API endpoints
