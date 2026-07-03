import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: "default" | "success" | "warning" | "danger" | "info";
}

const accentClass = {
  default: "",
  success: "border-emerald-500/35",
  warning: "border-amber-500/35",
  danger: "border-red-500/35",
  info: "border-sky-500/35",
};

export function KpiCard({ label, value, hint, accent = "default" }: Props) {
  return (
    <div className={`card p-4 flex flex-col gap-1.5 ${accentClass[accent]}`}>
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
        {label}
      </p>
      <p className="text-3xl font-bold tracking-display-tight">{value}</p>
      {hint && <p className="text-xs text-sand-100/55">{hint}</p>}
    </div>
  );
}
