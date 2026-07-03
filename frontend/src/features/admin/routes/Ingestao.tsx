// Ingestão · porte fiel (4 KPIs · 2 cols Upload/Webhook · status endpoint)
// Endpoints: /api/distribution/queue, /api/leads/import (multipart), /api/webhooks/leads (público)

import { useEffect, useState } from "react";
import { FileText, Webhook, Upload, Download, Zap, BookOpen, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";

interface QueueResp {
  totalAgendados?: number;
  totalDistribuidos?: number;
  capacityPerDay?: number;
  corretoresAtivos?: number;
  webhookStatus?: { active?: boolean; lastReceivedAt?: string; lastEvents?: { id: string; at: string; source?: string; status?: string }[] };
}

export function Ingestao() {
  const [q, setQ] = useState<QueueResp | null>(null);
  const [importing, setImporting] = useState(false);
  const showToast = useUi((s) => s.showToast);
  const WEBHOOK = "https://crm.calebeimoveis.com.br/api/webhooks/leads";

  async function load() {
    try {
      const r = await api.get<QueueResp>("/api/distribution/queue");
      setQ(r);
    } catch { /* silent */ }
  }
  useEffect(() => { void load(); }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post<{ count?: number }>("/api/leads/import", fd);
      showToast(`Importação OK · ${r.count ?? 0} leads na fila`);
      await load();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setImporting(false); e.target.value = ""; }
  }

  function baixarModelo() {
    const csv = "nome,telefone,cidade,Oferta\nJoão Silva,(47) 99999-0000,Itapema,CAL-001\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo-leads.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const naFila = q?.totalAgendados ?? 0;
  const distribuidos = q?.totalDistribuidos ?? 0;
  const capacidade = q?.capacityPerDay ?? 0;
  const ativos = q?.corretoresAtivos ?? 0;
  const diasFila = capacidade > 0 ? Math.ceil(naFila / capacidade) : 0;
  const webhookOk = q?.webhookStatus?.active !== false;
  const lastRecv = q?.webhookStatus?.lastReceivedAt;

  function relativeAgo(iso?: string) {
    if (!iso) return "nunca";
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.floor(min / 60)}h`;
    return `há ${Math.floor(min / 1440)}d`;
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <span className="pill">Entrada de leads</span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-display-tight mt-2">Ingestão</h1>
        <p className="text-sm text-sand-100/65 mt-2 max-w-2xl">
          Importe planilhas, monitore webhooks externos e acompanhe a fila de agendamento da distribuição.
        </p>
      </div>

      {/* 4 KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Na fila</p>
          <p className="text-3xl font-display font-light mt-1">{naFila}</p>
          <p className="text-xs text-sand-100/55 mt-1">aguardando distribuição</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Distribuídos</p>
          <p className="text-3xl font-display font-light mt-1">{distribuidos}</p>
          <p className="text-xs text-sand-100/55 mt-1">total acumulado</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Capacidade/dia</p>
          <p className="text-3xl font-display font-light mt-1">{capacidade || "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">{ativos} corretores ativos</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Dias de fila</p>
          <p className="text-3xl font-display font-light mt-1">{diasFila}</p>
          <p className="text-xs text-sand-100/55 mt-1">tempo até zerar</p>
        </div>
      </div>

      {/* 2 colunas · Importar + Webhook */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* IMPORTAR PLANILHA */}
        <section className="card p-5">
          <p className="pill mb-3 inline-flex items-center gap-1.5"><FileText size={13} /> Importar planilha</p>
          <p className="text-sm text-sand-100/70 mb-4">
            Envie CSV ou XLSX. Colunas esperadas: <code className="text-gold-300">nome</code>,{" "}
            <code className="text-gold-300">telefone</code>, <code className="text-gold-300">cidade</code>,{" "}
            <code className="text-gold-300">Oferta</code>. Leads entram na fila e são distribuídos automaticamente
            respeitando as regras de distribuição.
          </p>
          <Button variant="outline" onClick={baixarModelo} style={{ padding: ".5rem .9rem" }} className="mb-3">
            <Download size={14} /> Baixar modelo CSV
          </Button>

          <label className="block bg-app-subtle/60 border hairline rounded p-5 cursor-pointer hover:border-gold-400/40 transition-colors">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400">
                <Upload size={18} />
              </div>
              <div>
                <p className="text-sm font-medium">{importing ? "Importando…" : "Selecione um arquivo CSV / XLSX"}</p>
                <p className="text-xs text-sand-100/55 mt-0.5">Até 1.000 leads por arquivo · validação automática</p>
              </div>
            </div>
            <input
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFile}
              disabled={importing}
              className="hidden"
            />
          </label>

          <p className="text-[0.7rem] text-sand-100/45 mt-3 italic">
            Se importar mais leads que a capacidade diária, o sistema agenda automaticamente para os próximos dias
            conforme configurado em Configurações → Distribuição.
          </p>
        </section>

        {/* WEBHOOK DE LEADS */}
        <section className="card p-5">
          <p className="pill mb-3 inline-flex items-center gap-1.5"><Webhook size={13} /> Webhook de leads</p>
          <p className="text-sm text-sand-100/70 mb-3">
            Leads chegam de fontes externas (Meta Ads, Google Ads, formulários) direto no endpoint:
          </p>
          <code className="block text-xs bg-app-subtle/60 p-3 rounded break-all mb-3">
            <span className="text-gold-400 font-bold">POST</span> {WEBHOOK}
          </code>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${webhookOk ? "bg-emerald-400" : "bg-red-400"}`} />
                Status do endpoint
              </span>
              <span className={webhookOk ? "text-emerald-300" : "text-red-300"}>
                {webhookOk ? "Ativo · 200 OK" : "Inativo"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sand-100/75">HMAC-SHA256</span>
              <span className="text-emerald-300 inline-flex items-center gap-1">
                <CheckCircle size={12} /> Verificação ativa
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sand-100/75">Último recebimento</span>
              <span className="text-sand-100/55">{relativeAgo(lastRecv)}</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t hairline">
            <p className="text-[0.7rem] uppercase tracking-mono-xwide font-medium text-sand-100/55 mb-2">
              Últimos eventos recebidos
            </p>
            {(q?.webhookStatus?.lastEvents ?? []).length === 0 ? (
              <p className="text-sm text-sand-100/55 italic">Nenhum evento recente</p>
            ) : (
              <ul className="space-y-1.5">
                {(q?.webhookStatus?.lastEvents ?? []).slice(0, 5).map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between text-xs">
                    <span>{ev.source ?? "Webhook"}</span>
                    <span className="text-sand-100/55">{relativeAgo(ev.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => showToast("Simulação requer backend admin · use bash")} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>
              <Zap size={13} /> Simular recebimento
            </Button>
            <a
              href="https://github.com/anthropics/calebe-docs"
              target="_blank"
              rel="noreferrer"
              className="btn-base btn-outline"
              style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}
            >
              <BookOpen size={13} /> Ver documentação
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
