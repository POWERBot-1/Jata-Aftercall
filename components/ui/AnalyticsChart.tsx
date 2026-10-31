"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";
import { formatNumber } from "@/lib/dateFormat";
import { cn } from "@/lib/ui";

export type ChartSeries = { label: string; value: number; colour?: string };

/**
 * Customer-response chart.
 *
 * A deliberately small visualisation: it answers one question ("where are customers responding
 * to my page?") with the numbers JATA already knows and is authorized to show the owner. It is
 * loaded lazily by its callers, so it never delays the dashboard's first paint, and the same
 * numbers are also rendered as a table below the chart — the chart is decoration around the
 * data, not the only way to read it.
 */
export function AnalyticsChart({
  title,
  series,
  className,
  height = 208,
}: {
  title: string;
  series: ChartSeries[];
  className?: string;
  height?: number;
}) {
  // Recharts animates bars by default and knows nothing about `prefers-reduced-motion`, so the
  // chart used to grow from zero on every mount even for a customer who asked the operating system
  // for stillness. The decision is read from the same preference the rest of the product uses.
  const reducedMotion = useReducedMotion();
  const total = series.reduce((sum, entry) => sum + entry.value, 0);
  if (total === 0) {
    return (
      <p className={cn("text-sm text-[color:var(--jata-muted)]", className)}>
        No customer responses yet. Responses appear here as people view your page, tap WhatsApp, call or ask for directions.
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="jata-chart-shell" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
            <CartesianGrid stroke="var(--jata-line)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--jata-muted)" }}
              stroke="var(--jata-line)"
              interval={0}
              tickLine={false}
            />
            <YAxis tick={{ fontSize: 11, fill: "var(--jata-muted)" }} stroke="var(--jata-line)" allowDecimals={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "color-mix(in srgb, var(--jata-line) 30%, transparent)" }}
              contentStyle={{
                borderRadius: "var(--jata-radius-md)",
                border: "1px solid var(--jata-line)",
                background: "var(--jata-card)",
                fontSize: 12,
              }}
              formatter={(value: number) => [formatNumber(value), title]}
            />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={reducedMotion === false}>
              {series.map((entry) => (
                <Cell key={entry.label} fill={entry.colour ?? "var(--jata-accent)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="jata-chart-legend">
        {series.map((entry) => (
          <span key={entry.label}>
            <i style={{ background: entry.colour ?? "var(--jata-accent)" }} aria-hidden="true" />
            {entry.label}: {formatNumber(entry.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default AnalyticsChart;
