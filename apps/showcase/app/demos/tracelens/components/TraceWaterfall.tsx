"use client";

import type { JSX } from "react";
import type { Span, Trace } from "@repo/tracelens-core";
import { Badge } from "@repo/ui";

const SERVICE_COLORS: Record<string, string> = {
  edge: "#38bdf8",
  auth: "#a78bfa",
  handler: "#34d399",
  redis: "#f87171",
  postgres: "#fbbf24",
};

function colorFor(service: string): string {
  return SERVICE_COLORS[service] ?? "#94a3b8";
}

function SpanRow({
  span,
  totalMs,
  depth,
}: {
  span: Span;
  totalMs: number;
  depth: number;
}): JSX.Element {
  const left = (span.startMs / totalMs) * 100;
  const width = Math.max(0.8, (span.durationMs / totalMs) * 100);
  return (
    <div>
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 18 }}>
        <div className="w-64 shrink-0 truncate font-mono text-xs text-slate-300">
          {span.name}
        </div>
        <div className="relative h-4 flex-1 rounded bg-slate-800/60">
          <div
            className="absolute top-0 h-4 rounded"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: colorFor(span.service),
              opacity: 0.85,
            }}
            title={`${span.name}: ${span.durationMs.toFixed(2)}ms`}
          />
        </div>
        <div className="w-24 shrink-0 text-right font-mono text-xs text-slate-400">
          {span.durationMs.toFixed(2)}ms
        </div>
      </div>
      {(span.children ?? []).map((child, i) => (
        <SpanRow key={`${child.name}-${i}`} span={child} totalMs={totalMs} depth={depth + 1} />
      ))}
    </div>
  );
}

export function TraceWaterfall({ trace }: { trace: Trace }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-400">trace</span>
        <span className="font-mono text-xs text-sky-300">{trace.traceId}</span>
        <Badge tone={trace.failed ? "critical" : "success"}>
          {trace.failed ? "failed" : "ok"}
        </Badge>
        <span className="font-mono text-xs text-slate-400">
          {trace.endpoint} · {trace.durationMs.toFixed(2)}ms total
        </span>
      </div>
      <div className="mb-2 flex items-center gap-4 text-[11px] text-slate-500">
        {Object.entries(SERVICE_COLORS).map(([svc, color]) => (
          <span key={svc} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {svc}
          </span>
        ))}
      </div>
      {trace.spans.map((span, i) => (
        <SpanRow key={i} span={span} totalMs={trace.durationMs} depth={0} />
      ))}
    </div>
  );
}
