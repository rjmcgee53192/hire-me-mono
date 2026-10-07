"use client";

import { cn } from "../cn";

export interface BarChartDatum {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarChartDatum[];
  height?: number;
}

const DEFAULT_COLOR = "#3b82f6";

export function BarChart({ data, height = 200 }: BarChartProps) {
  const max = data.length > 0 ? Math.max(...data.map((d) => d.value), 0) : 0;

  return (
    <div className={cn("w-full")}>
      <div
        className="flex w-full items-end gap-2"
        style={{ height }}
        role="img"
        aria-label="Bar chart"
      >
        {data.map((d) => {
          const pct = max > 0 ? (d.value / max) * 100 : 0;
          return (
            <div
              key={d.label}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${d.label}: ${d.value}`}
            >
              <div
                className="w-full rounded-t"
                style={{
                  height: `${pct}%`,
                  backgroundColor: d.color ?? DEFAULT_COLOR,
                  minHeight: d.value > 0 ? 2 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        {data.map((d) => (
          <div
            key={d.label}
            className="flex-1 truncate text-center text-xs text-slate-400"
            title={d.label}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
