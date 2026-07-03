// Analítico da Base — relatório ao vivo (admin). 2026-06-15.
// Puxa /api/dashboards/analitico (cache 20s no backend) e atualiza a cada 30s.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";

type Row = Record<string, any>;
interface Data {
  overview: Row; msgStatus: Row[]; inbound: number; daily: Row[];
  callsHist: Row[]; callsStats: Row; failReasons: Row[]; online: Row;
  bySource: Row[]; responderam: number; generatedAt: string;
  numbers?: any[]; numbersUpdatedAt?: number;
  metaOficial?: { sent: number; delivered: number; billable: number; costUsd: number; fetchedAt: string } | null;
}

const fmt = (n: number) => (n ?? 0).toLocaleString("pt-BR");
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const FAIL_LABELS: Record<string, string> = {
  "131049": "Limite de marketing da Meta — o cliente já recebeu mensagens demais",
  "131026": "Número sem WhatsApp ou inválido",
  "131047": "Janela de 24h fechada — precisa enviar um template",
  "130472": "Número em teste/experimento da Meta",
  "131050": "Mensagem não entregável",
  "131053": "Erro no envio de mídia",
  "131000": "Erro genérico da Meta",
};

export function Analitico() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string>("");
  const timer = useRef<any>(null);

  async function load() {
    try {
      const j = await api.get<Data>("/api/dashboards/analitico");
      setD(j); setErr(null);
      setUpdated(new Date().toLocaleTimeString("pt-BR"));
    } catch (e: any) { setErr(e?.message || "falha ao carregar"); }
  }
  useEffect(() => {
    load();
    timer.current = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(timer.current);
  }, []);

  if (!d) return <div style={{ padding: 40, color: "#64748b" }}>{err ? "Erro: " + err : "Carregando analítico…"}</div>;

  const ov = d.overview;
  const ms: Record<string, number> = {};
  d.msgStatus.forEach((r) => (ms[r.status] = r.n));
  const outTotal = d.msgStatus.reduce((s, r) => s + r.n, 0);
  const entregues = (ms["delivered"] || 0) + (ms["read"] || 0);
  const failed = ms["failed"] || 0;
  const contactados = d.callsStats.leads_contactados || 0;
  const leads = ov.leads_total;
  const avancaram = (ov.qualifying || 0) + (ov.negotiating || 0) + (ov.closed || 0);
  const frTot = d.failReasons.reduce((s, r) => s + r.n, 0);
  const maxDaily = Math.max(1, ...d.daily.map((x) => x.enviadas));
  const maxHist = Math.max(1, ...d.callsHist.map((r) => r.leads));
  const cron6 = d.callsHist.filter((r) => r.faixa === "6-10" || r.faixa === "10+").reduce((s, r) => s + r.leads, 0);

  const C = { navy: "#04101F", gold: "#DEB96D", red: "#dc2626", green: "#16a34a", muted: "#64748b" };
  const card: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: "22px 24px", marginBottom: 20, boxShadow: "0 4px 18px rgba(4,16,31,.07)" };
  const h2: React.CSSProperties = { fontSize: 18, color: C.navy, fontWeight: 800, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 };
  const sub: React.CSSProperties = { color: C.muted, fontSize: 13, marginBottom: 16 };
  const th: React.CSSProperties = { textAlign: "left", color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", padding: "8px 10px", borderBottom: "2px solid #eef2f7" };
  const td: React.CSSProperties = { padding: "9px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 14, color: "#1a2433" };
  const numTd: React.CSSProperties = { ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" };

  const KPI = ({ v, l, d2, color }: any) => (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 4px 18px rgba(4,16,31,.09)", flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.navy, lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 5 }}>{l}</div>
      {d2 && <div style={{ fontSize: 11, marginTop: 5, fontWeight: 700, color: color || C.muted }}>{d2}</div>}
    </div>
  );

  return (
    <div style={{ padding: "24px 28px 70px", maxWidth: 1080, margin: "0 auto", color: "#1a2433", background: "#eef2f6", minHeight: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
        <div>
          <p style={{ color: C.gold, fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 700 }}>Análise de Impacto · ao vivo</p>
          <h1 style={{ fontSize: 25, color: C.navy, fontWeight: 800 }}>Analítico da Base</h1>
          <p style={{ color: C.muted, fontSize: 13 }}>Período {ov.inicio} → {ov.fim} · CRM oficial (dados de produção)</p>
        </div>
        <div style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, display: "inline-block", animation: "pulse 2s infinite" }} />
          atualizado {updated} · auto a cada 30s
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <KPI v={fmt(d.callsStats.total_envios)} l="Mensagens enviadas (CRM)" d2={`${fmt(d.inbound)} respostas recebidas`} />
        <KPI v={pct(entregues, outTotal) + "%"} l="Entrega real" d2={`${fmt(failed)} falharam`} color={C.red} />
        <KPI v={fmt(d.responderam)} l="Leads que responderam" d2={`${pct(d.responderam, contactados)}% dos contactados`} color={C.gold} />
        <KPI v={fmt(ov.closed)} l="Vendas (CLOSED)" d2={`de ${fmt(leads)} leads`} color={C.green} />
      </div>

      {/* Funil */}
      <div style={card}>
        <div style={h2}>▢ Funil de conversão</div>
        <div style={sub}>Do lead até a venda — em tempo real</div>
        {[
          { l: `${fmt(leads)} leads na base`, w: 100, bg: C.navy, meta: "" },
          { l: `${fmt(contactados)} contactados`, w: 92, bg: "#16314f", meta: pct(contactados, leads) + "%" },
          { l: `${fmt(entregues)} receberam`, w: 24, bg: "linear-gradient(90deg,#a37e1f,#DEB96D)", meta: pct(entregues, outTotal) + "% dos envios" },
          { l: `${fmt(d.responderam)} responderam`, w: 12, bg: "#16314f", meta: pct(d.responderam, contactados) + "%" },
          { l: `${fmt(avancaram)} avançaram`, w: 8, bg: "#16314f", meta: pct(avancaram, leads) + "%" },
          { l: `${fmt(ov.closed)} vendas`, w: 5, bg: C.green, meta: pct(ov.closed, leads) + "%" },
        ].map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ height: 34, minWidth: 130, width: `${s.w}%`, background: s.bg, borderRadius: 7, display: "flex", alignItems: "center", padding: "0 13px", color: "#fff", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>{s.l}</div>
            <span style={{ fontSize: 12, color: C.muted }}>{s.meta}</span>
          </div>
        ))}
      </div>

      {/* Entrega dia a dia */}
      <div style={card}>
        <div style={h2}>📈 Analítico de entrega — dia a dia</div>
        <div style={sub}>Altura = enviado no dia · verde entregue · vermelho falhou</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, borderBottom: "1px solid #eef2f7", paddingBottom: 4 }}>
          {d.daily.map((x, i) => {
            const h = Math.max(2, Math.round((64 * x.enviadas) / maxDaily));
            const eh = x.enviadas ? Math.round((h * x.entregues) / x.enviadas) : 0;
            return (
              <div key={i} title={`${x.dia}: ${x.enviadas} env · ${x.entregues} entregues · ${x.falhas} falhas`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", minWidth: 0 }}>
                <div style={{ height: h - eh, background: "#e5a3a3" }} />
                <div style={{ height: eh, background: C.green }} />
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
          <span style={{ display: "inline-block", width: 11, height: 11, background: C.green, borderRadius: 2, marginRight: 5 }} />Entregue
          <span style={{ display: "inline-block", width: 11, height: 11, background: "#e5a3a3", borderRadius: 2, margin: "0 5px 0 16px" }} />Falhou
        </div>
      </div>

      {/* Meta (oficial) — números do lado da Meta/Facebook */}
      {d.metaOficial && (() => {
        const mo = d.metaOficial;
        const entregaMeta = pct(mo.delivered, mo.sent);
        const brl = Math.round(mo.costUsd * 5.4);
        return (
          <div style={card}>
            <div style={h2}>◆ Meta / Facebook (números oficiais)</div>
            <div style={sub}>Direto da API da Meta · WhatsApp Business · atualiza a cada 30 min{mo.fetchedAt ? " · " + new Date(mo.fetchedAt).toLocaleTimeString("pt-BR") : ""}</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <KPI v={fmt(mo.sent)} l="Enviadas (visão Meta)" d2="o que efetivamente saiu" />
              <KPI v={fmt(mo.delivered)} l="Entregues (visão Meta)" d2={entregaMeta + "% de entrega"} color={C.green} />
              <KPI v={"US$ " + fmt(Math.round(mo.costUsd))} l="Custo WhatsApp (Meta)" d2={"\u2248 R$ " + fmt(brl)} color={C.navy} />
              <KPI v={fmt(mo.billable)} l="Conversas billáveis" d2="cobradas pela Meta" />
            </div>
            <div style={{ marginTop: 14, background: "#eff6ff", borderLeft: "4px solid #2563eb", padding: "12px 14px", borderRadius: 8, fontSize: 13 }}>
              <b>Por que a Meta mostra {entregaMeta}% e o nosso CRM mostra 23%?</b> A Meta conta só o que <b>conseguiu sair</b> — e disso, quase tudo entrega. O nosso 23% conta as <b>tentativas</b>, e a maioria é <b>barrada antes de sair</b> (erro 131049, limite de marketing). Ou seja: o problema não é entrega ruim — é a Meta <b>bloqueando o envio</b> de marketing pra base fria. Os dois números estão certos, medem coisas diferentes.
            </div>
          </div>
        );
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Chamadas por lead */}
        <div style={card}>
          <div style={h2}>☎ Chamadas por lead</div>
          <div style={sub}>{fmt(contactados)} contactados · média {d.callsStats.media} · máx {d.callsStats.maximo}</div>
          {d.callsHist.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, margin: "7px 0" }}>
              <span style={{ width: 60, fontSize: 13, fontWeight: 600, color: "#475569" }}>{r.faixa}</span>
              <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 5 }}>
                <div style={{ width: `${pct(r.leads, maxHist)}%`, height: 20, background: "linear-gradient(90deg,#DEB96D,#c9a961)", borderRadius: 5 }} />
              </div>
              <span style={{ width: 56, textAlign: "right", fontWeight: 700, fontSize: 13 }}>{fmt(r.leads)}</span>
            </div>
          ))}
          <p style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>⚠ {fmt(cron6)} leads chamados 6+ vezes</p>
        </div>

        {/* Falhas */}
        <div style={card}>
          <div style={h2}>⊘ Por que falham</div>
          <div style={sub}>{fmt(failed)} falhas no período</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Código</th><th style={{ ...th, textAlign: "right" }}>Qtd</th><th style={{ ...th, textAlign: "right" }}>%</th></tr></thead>
            <tbody>{d.failReasons.map((r, i) => {
              const code = String(r.motivo).split(":")[0].trim();
              return <tr key={i}><td style={td}><b>{code}</b><br /><span style={{ color: C.muted, fontSize: 12 }}>{FAIL_LABELS[code] || ""}</span></td><td style={numTd}>{fmt(r.n)}</td><td style={numTd}>{pct(r.n, frTot)}%</td></tr>;
            })}</tbody>
          </table>
        </div>
      </div>

      {/* Online */}
      <div style={card}>
        <div style={h2}>◴ Corretores online</div>
        <div style={sub}>{fmt(d.online.total)} aprovados</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <KPI v={d.online.agora} l="Online agora (5 min)" />
          <KPI v={d.online.hoje} l="Ativos hoje" />
          <KPI v={d.online.semana} l="Ativos na semana" />
          <KPI v={d.online.nunca} l="Nunca logaram" color={C.red} />
        </div>
        <div style={{ marginTop: 14, background: "#fef2f2", borderLeft: `4px solid ${C.red}`, padding: "12px 14px", borderRadius: 8, fontSize: 13 }}>
          <b>{pct(d.online.semana, d.online.total)}% de ativação semanal.</b> {d.online.nunca} corretores nunca entraram; só {d.online.hoje} usaram hoje.
        </div>
      </div>

      {/* Números WhatsApp */}
      <div style={card}>
        <div style={h2}>☏ Números WhatsApp em uso</div>
        <div style={sub}>Qualidade na Meta · função (corretores x suporte){d.numbersUpdatedAt ? " · atualizado " + new Date(d.numbersUpdatedAt).toLocaleString("pt-BR") : ""}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Número</th><th style={{ ...th, textAlign: "left" }}>Função</th><th style={{ ...th, textAlign: "left" }}>Qualidade</th><th style={{ ...th, textAlign: "left" }}>No rodízio</th></tr></thead>
          <tbody>{(d.numbers || []).map((n: any, i: number) => {
            const qc = n.quality === "GREEN" ? "#16a34a" : n.quality === "RED" ? "#dc2626" : "#d97706";
            return (
              <tr key={i}>
                <td style={td}><b>{n.number}</b></td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: n.role === "suporte" ? "#fde68a" : "#dbeafe", color: n.role === "suporte" ? "#92400e" : "#1e40af" }}>{n.role === "suporte" ? "SUPORTE" : "CORRETORES"}</span></td>
                <td style={td}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: qc, display: "inline-block" }} />{n.quality}</span></td>
                <td style={td}>{n.role === "suporte" ? <span style={{ color: C.muted }}>—</span> : n.inPool ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ enviando</span> : <span style={{ color: C.muted }}>fora (não-GREEN)</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
        <div style={{ marginTop: 12, background: "#fdfaf2", borderLeft: "4px solid #DEB96D", padding: "10px 13px", borderRadius: 8, fontSize: 13 }}>
          Só números <b>GREEN de corretores</b> entram no rodízio de novos leads. Os 2 de <b>suporte</b> nunca enviam pra cliente. Qualidade <b>YELLOW</b> reduz o limite da Meta e aumenta o throttle (131049).
        </div>
      </div>

      {/* Base de leads — atalho pro filtro completo */}
      <div style={card}>
        <div style={h2}>▦ Base de leads (CRM)</div>
        <div style={sub}>Composição da base · filtro completo na página de Leads</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {[["NEW","Novos",ov.new],["QUALIFYING","Qualificando",ov.qualifying],["NEGOTIATING","Negociando",ov.negotiating],["CLOSED","Ganhos",ov.closed],["LOST","Perdidos",ov.lost],["—","Sem WhatsApp",ov.leads_sem_wpp]].map((x: any, i) => (
            <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 14px", minWidth: 110 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>{fmt(x[2])}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{x[1]}</div>
            </div>
          ))}
        </div>
        <Link to="/admin/leads" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.navy, color: "#fff", padding: "11px 18px", borderRadius: 9, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
          Abrir base completa com filtros ({fmt(leads)} leads) →
        </Link>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>Filtra por origem, corretor, segmento, campanha, período e busca. O SDR tem ~5 mil contatos adicionais em base separada.</p>
      </div>

      {/* Por fonte */}
      <div style={card}>
        <div style={h2}>⌦ Entrega × origem do lead</div>
        <div style={sub}>Taxa de resposta por fonte — a prova da lista fria</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Origem</th><th style={{ ...th, textAlign: "right" }}>Conversas</th><th style={{ ...th, textAlign: "right" }}>Resp.</th><th style={{ ...th, textAlign: "right" }}>Taxa</th></tr></thead>
          <tbody>{d.bySource.map((r, i) => (
            <tr key={i}><td style={td}>{r.source}</td><td style={numTd}>{fmt(r.conversas)}</td><td style={numTd}>{r.responderam}</td><td style={numTd}>{pct(r.responderam, r.conversas)}%</td></tr>
          ))}</tbody>
        </table>
      </div>

      <p style={{ textAlign: "center", color: C.muted, fontSize: 12 }}>Dados ao vivo do CRM (Postgres) · o canal SDR é medido separadamente · atualiza sozinho a cada 30s</p>
    </div>
  );
}
