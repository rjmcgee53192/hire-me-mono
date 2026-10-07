"use client";

import { useEffect, useRef } from "react";
import { cn } from "../cn";

export interface StatDelta {
  value: string;
  direction: "up" | "down" | "flat";
}

export interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  delta?: StatDelta;
  sparkData?: number[];
  sparkColor?: string;
}

const deltaColor: Record<StatDelta["direction"], string> = {
  up: "text-emerald-400",
  down: "text-red-400",
  flat: "text-slate-400",
};

const deltaArrow: Record<StatDelta["direction"], string> = {
  up: "\u25B2",
  down: "\u25BC",
  flat: "\u25CF",
};

const SPARK_W = 120;
const SPARK_H = 36;

export function StatTile({
  label,
  value,
  sub,
  delta,
  sparkData,
  sparkColor = "#60a5fa",
}: StatTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasSpark = sparkData !== undefined && sparkData.length >= 2;

  useEffect(() => {
    if (!hasSpark || !sparkData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = SPARK_W * dpr;
    canvas.height = SPARK_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);

    const min = Math.min(...sparkData);
    const max = Math.max(...sparkData);
    const span = max - min || 1;

    ctx.strokeStyle = sparkColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    sparkData.forEach((v, i) => {
      const x = (i / (sparkData.length - 1)) * (SPARK_W - 4) + 2;
      const y = SPARK_H - 4 - ((v - min) / span) * (SPARK_H - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [sparkData, sparkColor, hasSpark]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-100">{value}</span>
        {delta && (
          <span
            className={cn("text-xs font-medium", deltaColor[delta.direction])}
          >
            {deltaArrow[delta.direction]} {delta.value}
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      {hasSpark && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width: SPARK_W, height: SPARK_H }}
          className="mt-2 block"
        />
      )}
    </div>
  );
}
