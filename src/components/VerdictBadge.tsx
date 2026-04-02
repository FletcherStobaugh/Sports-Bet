"use client";

import type { Verdict, Confidence } from "@/lib/types";

const VERDICT_STYLES: Record<Verdict, string> = {
  "STRONG OVER": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "LEAN OVER": "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  "LEAN UNDER": "bg-red-500/10 text-red-300 border-red-500/20",
  "STRONG UNDER": "bg-red-500/20 text-red-400 border-red-500/30",
  "NO EDGE": "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

const CONFIDENCE_DOT: Record<Confidence, string> = {
  High: "bg-yellow-400",
  Medium: "bg-yellow-400/60",
  Low: "bg-zinc-500",
};

export function VerdictBadge({
  verdict,
  confidence,
  size = "md",
}: {
  verdict: Verdict;
  confidence: Confidence;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-3 py-1",
    lg: "text-base px-4 py-1.5",
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={`font-mono font-bold border rounded-md ${VERDICT_STYLES[verdict]} ${sizeClasses[size]}`}
      >
        {verdict}
      </span>
      <span className="flex items-center gap-1 text-xs text-zinc-500">
        <span className={`w-2 h-2 rounded-full ${CONFIDENCE_DOT[confidence]}`} />
        {confidence}
      </span>
    </div>
  );
}

export function ResultBadge({ result }: { result: string }) {
  const styles: Record<string, string> = {
    HIT: "bg-emerald-500/20 text-emerald-400",
    MISS: "bg-red-500/20 text-red-400",
    VOID: "bg-zinc-500/20 text-zinc-400",
    PENDING: "bg-yellow-500/10 text-yellow-400",
  };

  return (
    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${styles[result] || styles.PENDING}`}>
      {result}
    </span>
  );
}
