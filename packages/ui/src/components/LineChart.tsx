"use client";

import { useEffect, useRef } from "react";
import { cn } from "../cn";

export interface LineChartSeries {
  label: string;
  color: string;
  data: number[];
}

export interface LineChartProps {
  series: LineChartSeries[];
  height?: number;
  yUnit?: string;
  title?: string;
}

const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;

export function LineChart({
  series,
  height = 240,
  yUnit = "",
  title,
}: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = height;
      if (w === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const all = series.flatMap((s) => s.data);
      if (all.length === 0) return;
      let min = Math.min(...all);
      let max = Math.max(...all);
      if (min === max) {
        min -= 1;
        max += 1;
      }
      const pad = (max - min) * 0.1;
      min -= pad;
      max += pad;

      const plotW = w - PAD_L - PAD_R;
      const plotH = h - PAD_T - PAD_B;
      const n = Math.max(1, ...series.map((s) => s.data.length));
      const x = (i: number) =>
        PAD_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      const y = (v: number) =>
        PAD_T + (1 - (v - min) / (max - min)) * plotH;

      // Gridlines + y-axis labels
      ctx.strokeStyle = "rgba(148,163,184,0.15)";
      ctx.fillStyle = "rgba(148,163,184,0.75)";
      ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
      ctx.lineWidth = 1;
      const ticks = 4;
      for (let t = 0; t <= ticks; t++) {
        const v = min + ((max - min) / ticks) * t;
        const yy = Math.round(y(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD_L, yy);
        ctx.lineTo(w - PAD_R, yy);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText(`${v.toFixed(1)}${yUnit}`, PAD_L - 6, yy + 3);
      }

      // Series lines
      for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        s.data.forEach((v, i) => {
          const px = x(i);
          const py = y(v);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [series, height, yUnit]);

  return (
    <div className={cn("w-full")}>
      {title && (
        <div className="mb-2 text-sm font-medium text-slate-200">{title}</div>
      )}
      <div ref={wrapRef} className="w-full" style={{ height }}>
        <canvas ref={canvasRef} className="block" />
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s) => (
          <span
            key={s.label}
            className="flex items-center gap-1.5 text-xs text-slate-400"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
