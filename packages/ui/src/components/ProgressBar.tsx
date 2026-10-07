"use client";

export interface ProgressBarProps {
  value: number;
  color?: string;
}

export function ProgressBar({ value, color = "#3b82f6" }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}
