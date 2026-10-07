"use client";

import type { ReactNode } from "react";
import { cn } from "../cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white hover:bg-blue-500 focus-visible:ring-blue-400",
  secondary:
    "bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700 focus-visible:ring-slate-400",
  danger:
    "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-400",
  ghost:
    "bg-transparent text-slate-300 hover:bg-slate-800 hover:text-slate-100 focus-visible:ring-slate-500",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  onClick,
  type = "button",
  className,
  children,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </button>
  );
}
