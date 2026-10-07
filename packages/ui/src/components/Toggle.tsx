"use client";

import { cn } from "../cn";

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-1"
    >
      <span className="text-sm text-slate-300">{label}</span>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-blue-600" : "bg-slate-700"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </span>
    </button>
  );
}
