"use client";

import { useEffect, useState } from "react";
import { VerdictBadge } from "./VerdictBadge";
import type { Verdict, Confidence } from "@/lib/types";

interface KalshiBet {
  id: number;
  analysis_id: number;
  market_ticker: string;
  market_title: string;
  order_id: string | null;
  side: string;
  contracts: number;
  price_cents: number;
  cost_cents: number;
  status: string;
  pnl_cents: number | null;
  created_at: string;
  player_name: string;
  stat_category: string;
  line: number;
  verdict: string;
  confidence: string;
  hit_rate_l10: number;
  season_average: number;
  reasoning: string;
}

interface KalshiStats {
  totalBets: number;
  active: number;
  won: number;
  lost: number;
  failed: number;
  totalWagered: number;
  totalPnl: number;
}

const STATUS_STYLES: Record<string, string> = {
  PLACED: "bg-blue-500/20 text-blue-400",
  WON: "bg-emerald-500/20 text-emerald-400",
  LOST: "bg-red-500/20 text-red-400",
  FAILED: "bg-zinc-500/20 text-zinc-500",
};

export function KalshiPortfolio() {
  const [bets, setBets] = useState<KalshiBet[]>([]);
  const [stats, setStats] = useState<KalshiStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/kalshi");
        const data = await res.json();
        setBets(data.bets);
        setStats(data.stats);
      } catch {
        // No Kalshi data yet
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return null;
  if (!stats || stats.totalBets === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-3">
          Kalshi Auto-Bets
        </h2>
        <p className="text-sm text-zinc-500">
          No bets placed yet. The pipeline will auto-bet on STRONG edges when it runs.
        </p>
      </div>
    );
  }

  const winRate = stats.won + stats.lost > 0
    ? Math.round((stats.won / (stats.won + stats.lost)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Active Bets" value={stats.active.toString()} />
        <StatCard
          label="Record"
          value={`${stats.won}W-${stats.lost}L`}
          highlight={stats.won > stats.lost}
          warn={stats.lost > stats.won}
        />
        <StatCard
          label="Win Rate"
          value={`${winRate}%`}
          highlight={winRate >= 55}
          warn={winRate < 45 && stats.won + stats.lost > 0}
        />
        <StatCard
          label="Wagered"
          value={`$${(stats.totalWagered / 100).toFixed(2)}`}
        />
        <StatCard
          label="P&L"
          value={`${stats.totalPnl >= 0 ? "+" : ""}$${(stats.totalPnl / 100).toFixed(2)}`}
          highlight={stats.totalPnl > 0}
          warn={stats.totalPnl < 0}
        />
      </div>

      {/* Bets Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">
            Kalshi Bets
          </h2>
          <span className="text-xs text-zinc-500">{bets.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 uppercase">
                <th className="text-left px-5 py-3">Player / Prop</th>
                <th className="text-left px-3 py-3">Market</th>
                <th className="text-center px-3 py-3">Side</th>
                <th className="text-right px-3 py-3">Contracts</th>
                <th className="text-right px-3 py-3">Cost</th>
                <th className="text-center px-3 py-3">Status</th>
                <th className="text-right px-5 py-3">P&L</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => (
                <tr
                  key={bet.id}
                  className="border-t border-zinc-800/50 hover:bg-zinc-800/30"
                >
                  <td className="px-5 py-3">
                    <div className="font-medium text-white">{bet.player_name}</div>
                    <div className="text-xs text-zinc-500">
                      {bet.stat_category} {bet.line}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-xs text-zinc-400 max-w-[200px] truncate">
                      {bet.market_title}
                    </div>
                    <div className="text-xs text-zinc-600 font-mono">{bet.market_ticker}</div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        bet.side === "yes"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {bet.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{bet.contracts}</td>
                  <td className="px-3 py-3 text-right font-mono">
                    ${(bet.cost_cents / 100).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        STATUS_STYLES[bet.status] || STATUS_STYLES.PLACED
                      }`}
                    >
                      {bet.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-bold">
                    {bet.pnl_cents !== null ? (
                      <span className={bet.pnl_cents >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {bet.pnl_cents >= 0 ? "+" : ""}${(bet.pnl_cents / 100).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p
        className={`text-lg font-mono font-bold ${
          highlight ? "text-emerald-400" : warn ? "text-red-400" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
