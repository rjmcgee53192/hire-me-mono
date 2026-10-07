"use client";

import { cn } from "../cn";

export interface HeatmapProps {
  data: number[][];
  rowLabels: string[];
  colLabels: string[];
  min: number;
  max: number;
  lowColor?: string;
  highColor?: string;
  onCellClick?: (r: number, c: number) => void;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function cellColor(
  value: number,
  min: number,
  max: number,
  low: string,
  high: string
): string {
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const [r1, g1, b1] = parseHex(low);
  const [r2, g2, b2] = parseHex(high);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function Heatmap({
  data,
  rowLabels,
  colLabels,
  min,
  max,
  lowColor = "#1e293b",
  highColor = "#3b82f6",
  onCellClick,
}: HeatmapProps) {
  const cols = Math.max(colLabels.length, ...data.map((r) => r.length));

  return (
    <div className="w-full overflow-x-auto">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `auto repeat(${cols}, minmax(0, 1fr))` }}
      >
        <div />
        {colLabels.map((c) => (
          <div
            key={`col-${c}`}
            className="truncate px-1 text-center text-xs text-slate-400"
            title={c}
          >
            {c}
          </div>
        ))}
        {data.map((row, r) => (
          <div key={`row-${r}`} className="contents">
            <div
              className="flex items-center truncate pr-2 text-xs text-slate-400"
              title={rowLabels[r] ?? ""}
            >
              {rowLabels[r] ?? ""}
            </div>
            {Array.from({ length: cols }, (_, c) => {
              const v = row[c];
              const missing = v === undefined;
              return (
                <button
                  key={`cell-${r}-${c}`}
                  type="button"
                  disabled={missing || !onCellClick}
                  onClick={() => onCellClick?.(r, c)}
                  title={
                    missing
                      ? "no data"
                      : `${rowLabels[r] ?? ""} / ${colLabels[c] ?? ""}: ${v}`
                  }
                  className={cn(
                    "aspect-square w-full rounded",
                    onCellClick && !missing
                      ? "cursor-pointer hover:ring-2 hover:ring-slate-300"
                      : "cursor-default",
                    missing && "opacity-30"
                  )}
                  style={{
                    backgroundColor: missing
                      ? "#0f172a"
                      : cellColor(v, min, max, lowColor, highColor),
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
