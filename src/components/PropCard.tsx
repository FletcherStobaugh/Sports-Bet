"use client";

import type { DBAnalysis } from "@/lib/types";
import { VerdictBadge, ResultBadge } from "./VerdictBadge";
import type { Verdict, Confidence } from "@/lib/types";

function formatStatCategory(cat: string): string {
  const labels: Record<string, string> = {
    pts: "Points",
    reb: "Rebounds",
    ast: "Assists",
    stl: "Steals",
    blk: "Blocks",
    fg3m: "3-Pt Made",
    turnover: "Turnovers",
    "pts+reb": "Pts+Rebs",
    "pts+ast": "Pts+Asts",
    "reb+ast": "Rebs+Asts",
    "pts+reb+ast": "Pts+Rebs+Asts",
    "stl+blk": "Stls+Blks",
    fantasy: "Fantasy",
  };
  return labels[cat] || cat;
}

export function PropCard({ analysis, rank }: { analysis: DBAnalysis; rank?: number }) {
  const a = analysis;
  const hitPctL10 = Math.round(a.hit_rate_l10 * 100);
  const hitPctL20 = Math.round(a.hit_rate_l20 * 100);
  const lineGap = a.line_vs_average;
  const lineGapStr =
    lineGap > 0
      ? `${lineGap.toFixed(1)} above avg`
      : lineGap < 0
      ? `${Math.abs(lineGap).toFixed(1)} below avg`
      : "at avg";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          {rank && (
            <span className="text-2xl font-mono font-bold text-zinc-600">#{rank}</span>
          )}
          <div>
          <h3 className="text-lg font-bold text-white">{a.player_name}</h3>
          <p className="text-sm text-zinc-400">
            {formatStatCategory(a.stat_category)} — {a.game_info}
          </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold text-white">{a.line}</div>
          <p className="text-xs text-zinc-500">Line</p>
        </div>
      </div>

      {/* Verdict */}
      <div className="mb-4">
        <VerdictBadge verdict={a.verdict as Verdict} confidence={a.confidence as Confidence} />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatBox
          label="Hit Rate L10"
          value={`${hitPctL10}%`}
          sub={`${Math.round(a.hit_rate_l10 * a.hit_rate_l10_games)}/${a.hit_rate_l10_games}`}
          highlight={hitPctL10 >= 75}
          warn={hitPctL10 <= 25}
        />
        <StatBox
          label="Hit Rate L20"
          value={`${hitPctL20}%`}
          sub={`${Math.round(a.hit_rate_l20 * a.hit_rate_l20_games)}/${a.hit_rate_l20_games}`}
          highlight={hitPctL20 >= 65}
          warn={hitPctL20 <= 35}
        />
        <StatBox
          label="Season Avg"
          value={a.season_average.toFixed(1)}
          sub={lineGapStr}
          highlight={lineGap < -2}
          warn={lineGap > 2}
        />
        <StatBox
          label="Avg Min L10"
          value={a.avg_minutes_l10.toFixed(1)}
          sub={a.minutes_trend === "increasing" ? "↑ trending up" : a.minutes_trend === "declining" ? "↓ trending down" : "→ stable"}
          highlight={a.minutes_trend === "increasing"}
          warn={a.minutes_trend === "declining"}
        />
      </div>

      {/* Context */}
      <div className="flex items-center gap-3 text-xs text-zinc-500 mb-3">
        <span>{a.is_home ? "🏠 Home" : "✈️ Away"}</span>
        {a.opponent_abbr && <span>vs {a.opponent_abbr}</span>}
        {a.opponent_def_rank && <span>Def Rank: #{a.opponent_def_rank}</span>}
      </div>

      {/* Reasoning */}
      <p className="text-sm text-zinc-400 leading-relaxed">{a.reasoning}</p>

      {/* Result (if resolved) */}
      {a.result !== "PENDING" && (
        <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between">
          <ResultBadge result={a.result} />
          {a.actual_value !== null && (
            <span className="text-sm text-zinc-400">
              Actual: <span className="font-mono font-bold text-white">{a.actual_value}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({
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
    <div className="bg-zinc-800/50 rounded-lg p-3">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p
        className={`text-lg font-mono font-bold ${
          highlight ? "text-emerald-400" : warn ? "text-red-400" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-zinc-500">{sub}</p>
    </div>
  );
}
