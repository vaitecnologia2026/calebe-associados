import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "gold";
  size?: "xs" | "sm";
}

const tones = {
  neutral: { bg: "rgba(245,239,228,.08)", color: "rgba(245,239,228,.75)", border: "rgba(245,239,228,.15)" },
  success: { bg: "rgba(95,209,168,.14)", color: "#5FD1A8", border: "rgba(95,209,168,.3)" },
  warning: { bg: "rgba(245,165,36,.16)", color: "#F5A524", border: "rgba(245,165,36,.3)" },
  danger:  { bg: "rgba(239,68,68,.14)",  color: "#EF4444", border: "rgba(239,68,68,.3)" },
  info:    { bg: "rgba(159,214,255,.14)", color: "#9FD6FF", border: "rgba(159,214,255,.3)" },
  gold:    { bg: "rgba(201,169,97,.14)", color: "#DEB96D", border: "rgba(201,169,97,.3)" },
};

export function StatusPill({ children, tone = "neutral", size = "xs" }: Props) {
  const t = tones[tone];
  const padding = size === "xs" ? "px-2 py-0.5" : "px-2.5 py-1";
  const fs = size === "xs" ? "text-[0.6rem]" : "text-[0.65rem]";
  return (
    <span
      className={`inline-flex items-center gap-1 ${padding} rounded uppercase tracking-mono-wide font-bold ${fs} border`}
      style={{ background: t.bg, color: t.color, borderColor: t.border }}
    >
      {children}
    </span>
  );
}
