"use client";

import type { PipelineStatus } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

function formatTime(timestamp: string | null): string {
  if (!timestamp) return "Never";
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        ok ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" : "bg-zinc-600"
      }`}
    />
  );
}

export function PipelineStatusBar({ status }: { status: PipelineStatus }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Pipeline Status</h2>
        <span
          className={`text-xs font-mono px-2 py-0.5 rounded ${
            status.status === "healthy"
              ? "bg-emerald-500/20 text-emerald-400"
              : status.status === "stale"
              ? "bg-yellow-500/20 text-yellow-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {status.status.toUpperCase()}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="flex items-center gap-2">
          <StatusDot ok={!!status.lastScrape} />
          <div>
            <p className="text-xs text-zinc-500">Lines Scraped</p>
            <p className="text-sm text-zinc-300">{formatTime(status.lastScrape)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot ok={!!status.lastAnalysis} />
          <div>
            <p className="text-xs text-zinc-500">Analysis Run</p>
            <p className="text-sm text-zinc-300">{formatTime(status.lastAnalysis)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot ok={!!status.lastResolve} />
          <div>
            <p className="text-xs text-zinc-500">Bets Resolved</p>
            <p className="text-sm text-zinc-300">{formatTime(status.lastResolve)}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono font-bold text-white">{status.strongEdges}</p>
          <p className="text-xs text-zinc-500">Strong Edges Today</p>
        </div>
      </div>
    </div>
  );
}
