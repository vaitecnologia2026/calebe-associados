// Disputas pendentes · race mode da distribuição
// Backend:
//   GET /api/leads/my-disputes → { data: [{id,name,segment,city,disputeStartedAt,disputeExpiresAt,disputeCandidates,campaignName,source}] }
//   POST /api/leads/:id/claim → 200 lead atribuído · 409 not_in_dispute · 410 dispute_expired · 403 not_invited
// SSE refresh: lead.dispute.started/invited/claimed → reload
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trophy, AlertCircle, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

interface Dispute {
  id: string;
  name?: string;
  segment?: string | null;
  city?: string | null;
  disputeStartedAt?: string | null;
  disputeExpiresAt?: string | null;
  disputeCandidates?: string[] | null;
  campaignName?: string | null;
  source?: string | null;
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function fmtCountdown(expiresAt?: string | null, now?: number): string {
  if (!expiresAt) return "—";
  const t = new Date(expiresAt).getTime() - (now ?? Date.now());
  if (t <= 0) return "expirou";
  const s = Math.floor(t / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function CorretorDisputas() {
  const [list, setList] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);
  const nav = useNavigate();
  const now = useNow();

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Dispute[] }>("/api/leads/my-disputes");
      setList((r.data ?? []).filter((d) => {
        if (!d.disputeExpiresAt) return false;
        return new Date(d.disputeExpiresAt).getTime() > Date.now();
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    void load();
    // Auto-refresh 10s (timer rápido por causa do race)
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  async function claim(d: Dispute) {
    setClaiming(d.id);
    try {
      await api.post(`/api/leads/${d.id}/claim`, {});
      showToast(`Você pegou o lead ${d.name}`);
      // Vai pro chat do lead
      nav(`/corretor/chat`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("dispute_expired") || msg.includes("not_in_dispute")) {
        showToast("Outro corretor pegou primeiro");
      } else if (msg.includes("not_eligible") || msg.includes("not_invited")) {
        showToast("Você não está na lista de candidatos desta disputa");
      } else {
        showToast(`Erro: ${msg}`);
      }
      // Refresh pra remover da lista
      await load();
    } finally { setClaiming(null); }
  }

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Disputas pendentes"
        description="Leads em modo race · primeiro a pegar leva · countdown em tempo real"
        actions={<Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>}
      />

      {loading && list.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55 text-sm">Procurando disputas…</div>
      ) : list.length === 0 ? (
        <div className="card p-8 text-center">
          <Trophy size={40} className="text-sand-100/30 mx-auto mb-3" />
          <p className="text-sand-100/65">Sem disputas no momento.</p>
          <p className="text-xs text-sand-100/40 mt-1">Quando o admin lançar leads em race, você verá aqui pra pegar.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((d) => {
            const expired = d.disputeExpiresAt ? new Date(d.disputeExpiresAt).getTime() - now <= 0 : true;
            const totalSec = d.disputeExpiresAt && d.disputeStartedAt
              ? (new Date(d.disputeExpiresAt).getTime() - new Date(d.disputeStartedAt).getTime()) / 1000
              : 1;
            const remainingSec = d.disputeExpiresAt
              ? Math.max(0, (new Date(d.disputeExpiresAt).getTime() - now) / 1000)
              : 0;
            const pct = Math.max(0, Math.min(100, (remainingSec / totalSec) * 100));
            const urgentTone = remainingSec < 60 ? "text-red-300" : remainingSec < 180 ? "text-amber-300" : "text-emerald-300";
            const barColor = remainingSec < 60 ? "bg-red-400" : remainingSec < 180 ? "bg-amber-400" : "bg-emerald-400";
            return (
              <article key={d.id} className="card overflow-hidden">
                <header className="p-4 border-b hairline">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <AlertCircle size={16} className="text-amber-300" />
                    <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${urgentTone}`}>
                      <Clock size={12} /> {fmtCountdown(d.disputeExpiresAt, now)}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold leading-tight">{d.name ?? "—"}</h3>
                  <p className="text-xs text-sand-100/65 mt-0.5">
                    {[d.segment, d.city, d.source].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {d.campaignName && (
                    <p className="text-[10px] uppercase tracking-mono-wide text-gold-300/85 mt-1">{d.campaignName}</p>
                  )}
                </header>

                {/* Barra de progresso countdown */}
                <div className="h-1 bg-app-subtle/40">
                  <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                </div>

                <div className="p-4">
                  <Button
                    variant="gold"
                    onClick={() => void claim(d)}
                    disabled={claiming === d.id || expired}
                    className="w-full"
                  >
                    {claiming === d.id ? (
                      <><Loader2 size={14} className="animate-spin" /> Pegando…</>
                    ) : expired ? (
                      "Expirou"
                    ) : (
                      <><Trophy size={14} /> Pegar lead</>
                    )}
                  </Button>
                  <p className="text-[10px] text-sand-100/45 mt-2 text-center">
                    {d.disputeCandidates?.length ?? "?"} candidatos · 1º a clicar leva
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {list.length > 0 && (
        <p className="text-xs text-sand-100/45 text-center mt-4">
          Auto-refresh a cada 10s · pode aparecer/sumir a qualquer momento
        </p>
      )}
    </div>
  );
}
