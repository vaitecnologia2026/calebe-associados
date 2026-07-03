// Polling com pausa automática em document.hidden
// Portado da decisão W7 do monólito: chat polling 5s → 20s + skip se aba escondida

import { useEffect, useRef } from "react";

interface Options {
  intervalMs: number;
  immediate?: boolean;
  pauseWhenHidden?: boolean;
  enabled?: boolean;
}

export function usePolling(
  tick: () => void | Promise<void>,
  { intervalMs, immediate = true, pauseWhenHidden = true, enabled = true }: Options,
) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const run = () => {
      if (pauseWhenHidden && document.hidden) return;
      try { void tickRef.current(); } catch { /* ignore */ }
    };

    if (immediate) run();
    timer = setInterval(run, intervalMs);

    const onVis = () => {
      if (!document.hidden && pauseWhenHidden) run();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs, immediate, pauseWhenHidden, enabled]);
}
