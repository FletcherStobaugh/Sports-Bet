"use client";

import { useEffect, useState } from "react";
import { PropCard } from "@/components/PropCard";
import type { DBAnalysis } from "@/lib/types";

export default function Dashboard() {
  const [analyses, setAnalyses] = useState<DBAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/props");
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setAnalyses(data.analyses);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Today&apos;s Bets</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {analyses.length} strong edge{analyses.length !== 1 ? "s" : ""} — sorted by best odds
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

      {/* Props */}
      {loading ? (
        <div className="text-center py-20">
          <div className="inline-block w-8 h-8 border-2 border-zinc-700 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <p className="text-red-400 font-mono text-sm">{error}</p>
        </div>
      ) : analyses.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <h3 className="text-lg font-bold text-white mb-2">No Strong Edges Today</h3>
          <p className="text-sm text-zinc-500">
            No games today or pipeline hasn&apos;t run yet. Check back after 2:00 PM ET.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {analyses.map((a, i) => (
            <PropCard key={a.id} analysis={a} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
