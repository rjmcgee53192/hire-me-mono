import type { ReactNode } from "react";
import { cn } from "../cn";

export type AlertTone = "info" | "warn" | "critical" | "success";

export interface AlertProps {
  tone: AlertTone;
  title?: string;
  children: ReactNode;
}

const toneClasses: Record<AlertTone, string> = {
  info: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  critical: "border-red-500/40 bg-red-500/10 text-red-200",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
};

export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div className={cn("rounded-lg border p-4", toneClasses[tone])}>
      {title && <div className="mb-1 font-semibold">{title}</div>}
      <div className="text-sm opacity-90">{children}</div>
    </div>
  );
}
