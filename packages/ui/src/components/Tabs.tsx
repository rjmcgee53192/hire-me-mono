"use client";

import { cn } from "../cn";

export interface TabDef {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
