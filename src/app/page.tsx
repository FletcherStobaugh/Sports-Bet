"use client";

import { useEffect, useState } from "react";
import { PropCard } from "@/components/PropCard";
import { PipelineStatusBar } from "@/components/PipelineStatus";
import { KalshiPortfolio } from "@/components/KalshiPortfolio";
import type { DBAnalysis, PipelineStatus, Verdict } from "@/lib/types";

type VerdictFilter = Verdict | "all";

const VERDICT_FILTERS: { label: string; value: VerdictFilter }[] = [
  { label: "All", value: "all" },
  { label: "Strong Over", value: "STRONG OVER" },
  { label: "Strong Under", value: "STRONG UNDER" },
  { label: "Lean Over", value: "LEAN OVER" },
  { label: "Lean Under", value: "LEAN UNDER" },
  { label: "No Edge", value: "NO EDGE" },
];

export default function Dashboard() {
  const [analyses, setAnalyses] = useState<DBAnalysis[]>([]);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [filter, setFilter] = useState<VerdictFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/props?verdict=${filter}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setAnalyses(data.analyses);
        setPipeline(data.pipeline);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [filter]);

  const strongEdges = analyses.filter(
    (a) => a.verdict === "STRONG OVER" || a.verdict === "STRONG UNDER"
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Pipeline Status */}
      {pipeline && <PipelineStatusBar status={pipeline} />}

      {/* Kalshi Portfolio */}
      <KalshiPortfolio />

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Today&apos;s Picks</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {analyses.length} props analyzed
            {strongEdges.length > 0 && (
              <span className="text-emerald-400">
                {" "}
                — {strongEdges.length} strong edge{strongEdges.length !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div className="text-sm text-zinc-500">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {VERDICT_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
              filter === f.value
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Props Grid */}
      {loading ? (
        <div className="text-center py-20">
          <div className="inline-block w-8 h-8 border-2 border-zinc-700 border-t-emerald-400 rounded-full animate-spin" />
          <p className="text-sm text-zinc-500 mt-3">Loading analyses...</p>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <p className="text-red-400 font-mono text-sm">{error}</p>
          <p className="text-zinc-500 text-xs mt-2">
            Make sure DATABASE_URL is set and tables are initialized.
          </p>
        </div>
      ) : analyses.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {analyses.map((a) => (
            <PropCard key={a.id} analysis={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
      <div className="text-4xl mb-4">🏀</div>
      <h3 className="text-lg font-bold text-white mb-2">No Props Today</h3>
      <p className="text-sm text-zinc-500 max-w-md mx-auto">
        Either it&apos;s an off-day, the pipeline hasn&apos;t run yet, or the
        season is over. Props will appear automatically when games are scheduled
        and the daily pipeline runs.
      </p>
      <div className="mt-6 space-y-2 text-xs text-zinc-600">
        <p>Pipeline runs daily:</p>
        <p>Lines scraped ~2:00 PM ET → Analyzed ~3:30 PM ET → Resolved ~1:00 AM ET</p>
      </div>
    </div>
  );
}
