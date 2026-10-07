"use client";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}

export function Select({ label, value, onChange, options }: SelectProps) {
  return (
    <div className="w-full">
      <label className="mb-1 block text-sm text-slate-300">{label}</label>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
