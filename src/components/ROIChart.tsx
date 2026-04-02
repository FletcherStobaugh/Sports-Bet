"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface DailyData {
  date: string;
  hits: number;
  misses: number;
  total: number;
}

export function ROIChart({ data }: { data: DailyData[] }) {
  // Compute cumulative hit rate
  let cumulativeHits = 0;
  let cumulativeTotal = 0;
  const chartData = data.map((d) => {
    cumulativeHits += Number(d.hits);
    cumulativeTotal += Number(d.total);
    return {
      date: d.date,
      hitRate: cumulativeTotal > 0 ? Math.round((cumulativeHits / cumulativeTotal) * 100) : 0,
      dailyHits: Number(d.hits),
      dailyTotal: Number(d.total),
    };
  });

  if (chartData.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
        <p className="text-zinc-500">No resolved bets yet. Data will appear after games finish.</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-4">
        Cumulative Hit Rate
      </h2>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="hitRateGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              color: "#e4e4e7",
            }}
            formatter={(value) => [`${value}%`, "Hit Rate"]}
          />
          {/* Reference line at 50% */}
          <Area
            type="monotone"
            dataKey="hitRate"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#hitRateGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
