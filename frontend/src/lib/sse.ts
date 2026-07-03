// SSE bus · portado de startRealtimeStream do index.html (linha 10547+)
//   - 1 EventSource em /api/stream?access_token=<jwt>
//   - 17 eventos tipados → emite via callback pra quem se inscreve
//   - Auto-reconnect com backoff (2s → 4s → 8s · capped 30s)
//
// Uso:
//   const unsub = sseBus.on("message.inbound", (d) => { ... });
//   sseBus.start();   // após login
//   sseBus.stop();    // no logout
//   unsub();          // cancela inscrição específica

import { API_BASE, getAuth } from "./api";

export type SseEventName =
  | "ready"
  | "message.inbound"
  | "message.outbound"
  | "message.status"
  | "lead.assigned"
  | "lead.distributed"
  | "lead.new_inbound"
  | "lead.status_changed"
  | "lead.dispute.started"
  | "lead.dispute.claimed"
  | "phone_release.created"
  | "phone_release.approved"
  | "phone_release.denied"
  | "phone_release.resolved"
  | "sale.created"
  | "sale.status_changed";

type Handler<T = unknown> = (data: T) => void;

interface Subscription {
  event: SseEventName;
  handler: Handler;
}

class SseBus {
  private es: EventSource | null = null;
  private subs = new Set<Subscription>();
  private retryMs = 2000;
  private maxRetryMs = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalStop = false;

  start(): void {
    this.intentionalStop = false;
    this.stop();
    const token = getAuth()?.accessToken;
    if (!token) {
      console.warn("[sse] sem token · skip start");
      return;
    }
    // 2026-05-27 · token em query string (vulnerabilidade conhecida do monólito · backend valida assim mesmo)
    const url = `${API_BASE}/api/stream?access_token=${encodeURIComponent(token)}`;
    const es = new EventSource(url, { withCredentials: true });
    this.es = es;

    es.addEventListener("ready", () => {
      this.retryMs = 2000; // reset backoff
      this.emit("ready", null);
    });

    // Registra TODOS os tipos de evento conhecidos
    const events: SseEventName[] = [
      "message.inbound", "message.outbound", "message.status",
      "lead.assigned", "lead.distributed", "lead.new_inbound", "lead.status_changed",
      "lead.dispute.started", "lead.dispute.claimed",
      "phone_release.created", "phone_release.approved", "phone_release.denied", "phone_release.resolved",
      "sale.created", "sale.status_changed",
    ];
    for (const ev of events) {
      es.addEventListener(ev, (raw: MessageEvent) => {
        try {
          const data = raw.data ? JSON.parse(raw.data) : null;
          this.emit(ev, data);
        } catch (err) {
          console.warn(`[sse] parse fail · ${ev}`, err);
        }
      });
    }

    es.onerror = () => {
      // EventSource já tenta reconectar sozinho, mas só pra mesmo URL.
      // Se o token expirou, precisamos reabrir com novo token (após refresh).
      es.close();
      this.es = null;
      if (this.intentionalStop) return;
      this.scheduleReconnect();
    };
  }

  stop(): void {
    this.intentionalStop = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.es) {
      try { this.es.close(); } catch { /* ignore */ }
      this.es = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.info(`[sse] reconectando em ${this.retryMs}ms…`);
      this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
      this.start();
    }, this.retryMs);
  }

  on<T = unknown>(event: SseEventName, handler: Handler<T>): () => void {
    const sub: Subscription = { event, handler: handler as Handler };
    this.subs.add(sub);
    return () => { this.subs.delete(sub); };
  }

  private emit(event: SseEventName | "ready", data: unknown): void {
    for (const sub of this.subs) {
      if (sub.event === event) {
        try { sub.handler(data); }
        catch (err) { console.warn(`[sse] handler erro · ${event}`, err); }
      }
    }
  }

  get isConnected(): boolean {
    return this.es?.readyState === EventSource.OPEN;
  }
}

export const sseBus = new SseBus();
