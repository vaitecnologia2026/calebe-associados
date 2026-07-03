// trackRoute.ts · 2026-07-02 · Instrumentação de uso de telas (Fase B)
// Registra qual rota o usuário abre, pra decidir com PROVA quais telas legadas
// aposentar. Fire-and-forget, nunca bloqueia, dedupe de 60s por rota.
import { api } from "./api";

const _sent: Record<string, number> = {};

export function trackRoute(pathname: string | undefined | null): void {
  if (!pathname) return;
  // normaliza ids dinâmicos (conversa/lead) pra não explodir em rotas distintas
  const path = pathname.replace(/\/[A-Za-z0-9_-]{18,}/g, "/:id").slice(0, 120);
  const now = Date.now();
  if (_sent[path] && now - _sent[path] < 60_000) return;
  _sent[path] = now;
  api.post("/api/_metrics/route-view", { path }).catch(() => { /* silencioso */ });
}
