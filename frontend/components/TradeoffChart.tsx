"use client";

import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { tradeoffPoints } from "@/lib/advisorUtils";
import type { ImpactSet } from "@/lib/types";

// Up and to the left is better: more attack campaigns caught, fewer genuine payments bothered.
export function TradeoffChart({ impact }: { impact: ImpactSet[] }) {
  const { before, after } = tradeoffPoints(impact);

  if (!before.length && !after.length) {
    return (
      <p className="mt-4 text-[13px] text-faint">
        Not enough campaign data in these runs to draw the trade-off.
      </p>
    );
  }

  return (
    <div className="mt-5">
      <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-dim">
        Trade-off · each dot is one run · up and left is better
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" />
            <XAxis
              type="number"
              dataKey="friction"
              name="Genuine payments bothered"
              unit="%"
              domain={[0, "auto"]}
              stroke="var(--chart-axis)"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              dataKey="caught"
              name="Attack campaigns caught"
              unit="%"
              domain={[0, 100]}
              stroke="var(--chart-axis)"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#131519",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 10,
                color: "#f7f8f8",
                fontSize: 12,
              }}
            />
            <Legend />
            <Scatter name="Current policy" data={before} fill="#8a8f98" />
            <Scatter name="Proposed policy" data={after} fill="#a78bfa" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
        <span>Across: genuine payments challenged or blocked (%)</span>
        <span>Up: attack campaigns caught (%)</span>
      </div>
    </div>
  );
}
