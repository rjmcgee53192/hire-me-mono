import type { ReactNode } from "react";
import { cn } from "../cn";

export interface SectionTitleProps {
  title: string;
  sub?: string;
}

export function SectionTitle({ title, sub }: SectionTitleProps) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
      {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  sub?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, sub, actions }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-4",
        "border-b border-slate-800 pb-5"
      )}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">
          {title}
        </h1>
        {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
