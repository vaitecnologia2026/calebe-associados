// Painel DEV · Escala do problema de envio de mensagens
// GET /api/dev/messages/delivery-stats
// "Tentativa frustrada" = outbound do corretor em conversation sem inbound prévio
//                         (janela WhatsApp fechada / sem binding).
import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

interface Row {
  period: string;
  total: number;
  corretores: number | null;
  leads: number | null;
}
interface Resp { rows: Row[]; meta?: { generatedAt: string } }

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}
function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

export function DevMensagens() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Resp>("/api/dev/messages/delivery-stats");
      setData(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    void load();
    // Polling 60s · pausa quando a aba não está visível pra não queimar query
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    const onVis = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const today = data?.rows.find((r) => r.period === "Hoje");
  const hist  = data?.rows.find((r) => r.period === "Total histórico");

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Escala do problema · envio de mensagens"
        description="Mensagens outbound dos corretores que entraram em conversation SEM inbound prévio (janela WhatsApp fechada · não chegaram ao lead) · atualiza automaticamente a cada 60s"
        actions={<Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar agora</Button>}
      />

      {/* Banner de alerta com totais críticos */}
      {hist && hist.total > 1000 && (
        <div className="card p-4 mb-5 border-red-400/40 bg-red-500/10">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-200">
                {fmtNum(hist.total)} mensagens nunca chegaram ao cliente
              </p>
              <p className="text-xs text-red-100/85 mt-1 leading-snug">
                Os corretores achavam que estavam trabalhando o lead — mas a mensagem foi pro /dev/null
                silenciosamente. Cada uma dessas representa um lead perdido sem o corretor saber.
                {today && today.total > 0 && (
                  <span className="block mt-1.5">
                    <strong>Hoje:</strong> {fmtNum(today.total)} novas tentativas frustradas afetando{" "}
                    {fmtNum(today.corretores)} corretores e {fmtNum(today.leads)} leads.
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabela principal */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-app-subtle/40 text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-4">Período</th>
              <th className="text-left p-4">Tentativas frustradas</th>
              <th className="text-left p-4">Corretores</th>
              <th className="text-left p-4">Leads</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr><td colSpan={4} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
            ) : !data ? (
              <tr><td colSpan={4} className="p-10 text-center text-sand-100/55">Sem dados.</td></tr>
            ) : data.rows.map((row) => (
              <tr key={row.period} className="border-t hairline">
                <td className="p-4 font-semibold">{row.period}</td>
                <td className="p-4 text-base font-bold text-sand-50 tabular-nums">{fmtNum(row.total)}</td>
                <td className="p-4 text-sand-100/85 tabular-nums">{fmtNum(row.corretores)}</td>
                <td className="p-4 text-sand-100/85 tabular-nums">{fmtNum(row.leads)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data?.meta?.generatedAt && (
        <p className="text-xs text-sand-100/45 mt-3 text-right">
          Atualizado em {fmtDateTime(data.meta.generatedAt)}
        </p>
      )}

      {/* Detalhe técnico do critério */}
      <details className="mt-6">
        <summary className="cursor-pointer text-xs text-sand-100/55 hover:text-sand-100/85">
          Como esse número é calculado
        </summary>
        <div className="mt-2 text-xs text-sand-100/65 leading-relaxed bg-app-subtle/40 border hairline rounded p-3">
          <p className="mb-2">
            <strong>Critério:</strong> outbound do corretor (<code>direction='outbound'</code> AND{" "}
            <code>fromRole='associate'</code>) em uma conversation que <strong>NÃO tinha inbound prévio</strong>{" "}
            do lead no momento do envio.
          </p>
          <p className="mb-2">
            Isso captura o padrão "janela WhatsApp fechada / sem binding" — quando o lead nunca respondeu
            via WhatsApp, a Cloud API rejeita mensagens normais silenciosamente. O backend já loga warning
            em <code>conversations.js:534</code>, mas até o React 1.0.0 não havia gate UX (já corrigido com
            banner amarelo + template Meta).
          </p>
          <p>
            Query: <code>NOT EXISTS (SELECT 1 FROM "Message" m2 WHERE m2."conversationId" = m."conversationId"
            AND m2.direction = 'inbound' AND m2."createdAt" {"<"} m."createdAt")</code>
          </p>
        </div>
      </details>
    </div>
  );
}
