import type { ReactNode } from "react";
import { cn } from "../cn";

interface CardProps {
  className?: string;
  children: ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800 bg-slate-900/60 p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: CardProps) {
  return <div className={cn("mb-3", className)}>{children}</div>;
}

export function CardTitle({ className, children }: CardProps) {
  return (
    <h3 className={cn("text-lg font-semibold text-slate-100", className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children }: CardProps) {
  return (
    <p className={cn("mt-1 text-sm text-slate-400", className)}>{children}</p>
  );
}

export function CardContent({ className, children }: CardProps) {
  return <div className={cn(className)}>{children}</div>;
}

export function CardFooter({ className, children }: CardProps) {
  return (
    <div className={cn("mt-4 flex items-center gap-2", className)}>
      {children}
    </div>
  );
}
