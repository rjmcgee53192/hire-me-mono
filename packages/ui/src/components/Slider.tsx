"use client";

export interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  unit = "",
}: SliderProps) {
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <label className="text-sm text-slate-300">{label}</label>
        <span className="text-sm font-medium tabular-nums text-slate-100">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  );
}
