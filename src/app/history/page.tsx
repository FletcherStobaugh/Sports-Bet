"use client";

import { useEffect, useState } from "react";
import { ROIChart } from "@/components/ROIChart";
import { ResultBadge, VerdictBadge } from "@/components/VerdictBadge";
import type { DBAnalysis, Verdict, Confidence } from "@/lib/types";

interface ROIData {
  totalBets: number;
  hits: number;
  misses: number;
  voids: number;
  pending: number;
  hitRate: number;
  strongHitRate: number;
}

export default function HistoryPage() {
  const [roi, setRoi] = useState<ROIData | null>(null);
  const [daily, setDaily] = useState<{ date: string; hits: number; misses: number; total: number }[]>([]);
  const [recent, setRecent] = useState<DBAnalysis[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/history?days=${days}`);
        const data = await res.json();
        setRoi(data.roi);
        setDaily(data.daily);
        setRecent(data.recent);
      } catch (err) {
        console.error("Failed to load history:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [days]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 text-center">
        <div className="inline-block w-8 h-8 border-2 border-zinc-700 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Performance</h1>
          <p className="text-sm text-zinc-500 mt-1">Track your edge over time</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
                days === d
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* ROI Summary Cards */}
      {roi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Overall Hit Rate"
            value={`${roi.hitRate}%`}
            sub={`${roi.hits}/${roi.totalBets}`}
            highlight={roi.hitRate >= 55}
          />
          <SummaryCard
            label="STRONG Edge Hit Rate"
            value={`${roi.strongHitRate}%`}
            sub="Filtered to STRONG verdicts"
            highlight={roi.strongHitRate >= 65}
          />
          <SummaryCard
            label="Total Bets"
            value={roi.totalBets.toString()}
            sub={`${roi.pending} pending`}
          />
          <SummaryCard
            label="Record"
            value={`${roi.hits}W - ${roi.misses}L`}
            sub={roi.voids > 0 ? `${roi.voids} voided` : ""}
            highlight={roi.hits > roi.misses}
            warn={roi.misses > roi.hits}
          />
        </div>
      )}

      {/* Chart */}
      <ROIChart data={daily} />

      {/* Recent Bets Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">
            Recent Results
          </h2>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No resolved bets yet. Results appear after games finish.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 uppercase">
                  <th className="text-left px-5 py-3">Player</th>
                  <th className="text-left px-3 py-3">Stat</th>
                  <th className="text-right px-3 py-3">Line</th>
                  <th className="text-left px-3 py-3">Verdict</th>
                  <th className="text-right px-3 py-3">Actual</th>
                  <th className="text-center px-3 py-3">Result</th>
                  <th className="text-right px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="px-5 py-3 font-medium text-white">
                      {a.player_name}
                    </td>
                    <td className="px-3 py-3 text-zinc-400">{a.stat_category}</td>
                    <td className="px-3 py-3 text-right font-mono">{a.line}</td>
                    <td className="px-3 py-3">
                      <VerdictBadge
                        verdict={a.verdict as Verdict}
                        confidence={a.confidence as Confidence}
                        size="sm"
                      />
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-bold">
                      {a.actual_value ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <ResultBadge result={a.result} />
                    </td>
                    <td className="px-5 py-3 text-right text-zinc-500">{a.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p
        className={`text-2xl font-mono font-bold ${
          highlight ? "text-emerald-400" : warn ? "text-red-400" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-zinc-500 mt-1">{sub}</p>
    </div>
  );
}
