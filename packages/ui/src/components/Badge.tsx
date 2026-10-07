import type { ReactNode } from "react";
import { cn } from "../cn";

export type BadgeTone = "info" | "success" | "warn" | "critical" | "neutral";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

const toneClasses: Record<BadgeTone, string> = {
  info: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  critical: "bg-red-500/15 text-red-300 border-red-500/30",
  neutral: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function Badge({ tone = "neutral", children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone]
      )}
    >
      {children}
    </span>
  );
}
