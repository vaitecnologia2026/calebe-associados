// Ajuda Comercial Calebe — módulo ADM (restrito a ADMIN c/ flag, ou DEV). 2026-06-16.
// Corretor pede apoio numa negociação; o time Calebe vê a conversa toda, fala com
// cliente e corretor no WhatsApp, assume e finaliza. Auto-refresh 15s.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/store/auth";
import { api } from "@/lib/api";
import {
  csList, csDetail, csInAnalysis, csAccept, csFinish, csCancel, csAddNote,
  type CsListItem, type CsDetail, type CsStatus, type CsListResp,
} from "@/lib/commercial-support-api";

const C = { navy: "#04101F", gold: "#DEB96D", red: "#dc2626", green: "#16a34a", muted: "#64748b", bg: "#eef2f6" };
const STATUS_META: Record<CsStatus, { label: string; bg: string; fg: string }> = {
  SOLICITADO: { label: "Solicitado", bg: "#fef9c3", fg: "#854d0e" },
  EM_ANALISE: { label: "Em análise", bg: "#dbeafe", fg: "#1e40af" },
  ATUANDO: { label: "Time Calebe atuando", bg: "#dcfce7", fg: "#166534" },
  FINALIZADO: { label: "Finalizado", bg: "#e2e8f0", fg: "#334155" },
  CANCELADO: { label: "Cancelado", bg: "#fee2e2", fg: "#991b1b" },
};
const LOG_LABELS: Record<string, string> = {
  COMMERCIAL_SUPPORT_REQUESTED: "Solicitado pelo corretor",
  COMMERCIAL_SUPPORT_IN_ANALYSIS: "Marcado em análise",
  COMMERCIAL_SUPPORT_ACCEPTED: "Time Calebe assumiu",
  COMMERCIAL_SUPPORT_FINISHED: "Finalizado",
  COMMERCIAL_SUPPORT_CANCELED: "Cancelado",
  COMMERCIAL_SUPPORT_NOTE_ADDED: "Nota interna adicionada",
  COMMERCIAL_SUPPORT_VIEWED: "Visualizado",
};
const ACTIVE: CsStatus[] = ["SOLICITADO", "EM_ANALISE", "ATUANDO"];
const onlyDigits = (p?: string) => String(p || "").replace(/\D/g, "");
const waLink = (p?: string) => "https://wa.me/" + onlyDigits(p);
const fmtWait = (min: number) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)}h${min % 60 ? " " + (min % 60) + "m" : ""}` : `${Math.floor(min / 1440)}d`);
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString("pt-BR") : "—");

function Chip({ st }: { st: CsStatus }) {
  const m = STATUS_META[st];
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: m.bg, color: m.fg, whiteSpace: "nowrap" }}>{m.label}</span>;
}

export function CommercialSupport() {
  const me = useAuth((s) => s.user);
  const allowed = me?.role === "DEV" || me?.role === "ADMIN"; // 2026-07-03 · liberado p/ todo admin
  const [resp, setResp] = useState<CsListResp | null>(null);
  const [filter, setFilter] = useState<"ATIVOS" | CsStatus | "TODOS">("ATIVOS");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState("");
  const timer = useRef<any>(null);

  async function load() {
    try { const j = await csList(); setResp(j); setErr(null); setUpdated(new Date().toLocaleTimeString("pt-BR")); }
    catch (e: any) { setErr(e?.message || "falha ao carregar"); }
  }
  useEffect(() => {
    if (!allowed) return;
    load();
    timer.current = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => clearInterval(timer.current);
  }, [allowed]);

  if (!allowed)
    return <div style={{ padding: 40, color: C.muted, maxWidth: 560 }}>
      <h1 style={{ fontSize: 22, color: C.navy, fontWeight: 800, marginBottom: 8 }}>Ajuda Comercial</h1>
      Você não tem permissão para este módulo. Peça a um administrador para habilitar seu acesso (flag <b>Ajuda Comercial</b>).
    </div>;

  const counts = resp?.counts;
  let rows = resp?.data || [];
  if (filter === "ATIVOS") rows = rows.filter((r) => ACTIVE.includes(r.status));
  else if (filter !== "TODOS") rows = rows.filter((r) => r.status === filter);
  if (q) {
    const s = q.toLowerCase(); const dq = onlyDigits(q);
    rows = rows.filter((r) => r.clientName.toLowerCase().includes(s) || r.brokerName.toLowerCase().includes(s) || (dq && onlyDigits(r.clientPhone + r.brokerPhone).includes(dq)));
  }
  const nAtivos = (resp?.data || []).filter((r) => ACTIVE.includes(r.status)).length;

  const tab = (key: typeof filter, label: string, n?: number) => (
    <button key={key} onClick={() => setFilter(key)} style={{
      border: "none", cursor: "pointer", padding: "7px 13px", borderRadius: 9, fontSize: 13, fontWeight: 700,
      background: filter === key ? C.navy : "#fff", color: filter === key ? "#fff" : C.navy, boxShadow: "0 2px 8px rgba(4,16,31,.06)",
    }}>{label}{typeof n === "number" ? ` · ${n}` : ""}</button>
  );

  return (
    <div style={{ padding: "22px 26px 60px", maxWidth: 1180, margin: "0 auto", color: "#1a2433", background: C.bg, minHeight: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <p style={{ color: C.gold, fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 700 }}>Time Calebe · apoio ao fechamento</p>
          <h1 style={{ fontSize: 25, color: C.navy, fontWeight: 800 }}>Ajuda Comercial</h1>
          <p style={{ color: C.muted, fontSize: 13 }}>Negociações onde o corretor pediu apoio do time Calebe</p>
        </div>
        <div style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, display: "inline-block" }} />
          {updated ? `atualizado ${updated} · auto 15s` : "carregando…"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {tab("ATIVOS", "Ativos", nAtivos)}
        {tab("SOLICITADO", "Solicitados", counts?.SOLICITADO)}
        {tab("EM_ANALISE", "Em análise", counts?.EM_ANALISE)}
        {tab("ATUANDO", "Atuando", counts?.ATUANDO)}
        {tab("FINALIZADO", "Finalizados", counts?.FINALIZADO)}
        {tab("CANCELADO", "Cancelados", counts?.CANCELADO)}
        {tab("TODOS", "Todos", resp?.total)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, corretor ou telefone…"
          style={{ flex: 1, minWidth: 200, border: "1px solid #d7dee8", borderRadius: 9, padding: "8px 12px", fontSize: 13, color: "#1a2433" }} />
      </div>

      {err && <div style={{ background: "#fef2f2", color: C.red, padding: "10px 14px", borderRadius: 9, marginBottom: 14, fontSize: 13 }}>Erro: {err}</div>}

      {rows.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", color: C.muted, boxShadow: "0 4px 18px rgba(4,16,31,.07)" }}>
          Nenhuma solicitação {filter === "ATIVOS" ? "ativa" : ""} no momento.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((r) => (
            <button key={r.id} onClick={() => setSelId(r.id)} style={{
              textAlign: "left", border: "none", cursor: "pointer", background: "#fff", borderRadius: 14, padding: "16px 18px",
              boxShadow: "0 4px 18px rgba(4,16,31,.07)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, borderLeft: `5px solid ${STATUS_META[r.status].fg}`,
            }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: C.navy, fontSize: 15 }}>{r.clientName}</div>
                <div style={{ color: C.muted, fontSize: 12.5, marginTop: 2 }}>Corretor: <b style={{ color: "#334155" }}>{r.brokerName}</b></div>
              </div>
              <div style={{ flex: "0 0 auto", textAlign: "center" }}>
                <Chip st={r.status} />
                {r.assignedCalebe && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>com {r.assignedCalebe}</div>}
              </div>
              <div style={{ flex: "0 0 auto", textAlign: "right", minWidth: 90 }}>
                <div style={{ fontSize: 12, color: ACTIVE.includes(r.status) && r.waitingMin > 30 ? C.red : C.muted, fontWeight: 700 }}>
                  {ACTIVE.includes(r.status) ? `há ${fmtWait(r.waitingMin)}` : fmtDate(r.requestedAt).split(" ")[0]}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>pediu: {r.requestedBy}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selId && <DetailPanel id={selId} onClose={() => setSelId(null)} onChanged={load} />}
    </div>
  );
}

// ---------------- Detail (drawer lateral) ----------------
function DetailPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<CsDetail | null>(null);
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"conversa" | "notas" | "historico">("conversa");

  async function loadDetail() {
    try { setD(await csDetail(id)); } catch { /* */ }
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const det = await csDetail(id); if (alive) setD(det); if (det?.conversationId) { const cj: any = await api.get(`/api/conversations/${det.conversationId}/messages`); if (alive) setMsgs(cj.messages || []); } }
      catch { /* */ }
    })();
    return () => { alive = false; };
  }, [id]);

  async function act(fn: () => Promise<any>, ok: string) {
    setBusy(true);
    try { await fn(); await loadDetail(); onChanged(); }
    catch (e: any) { alert(e?.message || "Falhou"); }
    finally { setBusy(false); }
  }
  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try { await csAddNote(id, note.trim()); setNote(""); await loadDetail(); }
    catch (e: any) { alert(e?.message || "Falhou ao salvar nota"); }
    finally { setBusy(false); }
  }

  const st = d?.status;
  const Btn = ({ onClick, bg, children }: any) => (
    <button disabled={busy} onClick={onClick} style={{ border: "none", cursor: busy ? "wait" : "pointer", background: bg, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 14px", borderRadius: 9, opacity: busy ? 0.6 : 1 }}>{children}</button>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(4,16,31,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", height: "100%", background: "#fff", boxShadow: "-8px 0 30px rgba(0,0,0,.2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* header */}
        <div style={{ background: C.navy, color: "#fff", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{d?.clientName || "…"}</div>
            <div style={{ fontSize: 12.5, color: "#c7d2e0", marginTop: 3 }}>Corretor: {d?.brokerName || "—"}</div>
            {st && <div style={{ marginTop: 8 }}><Chip st={st} />{d?.assignedCalebe && <span style={{ fontSize: 11, color: "#c7d2e0", marginLeft: 8 }}>com {d.assignedCalebe}</span>}</div>}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* contatos + ações */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #eef2f7" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {d?.clientPhone && <a href={waLink(d.clientPhone)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#25D366", color: "#04101F", fontWeight: 700, fontSize: 12.5, padding: "8px 12px", borderRadius: 9, textDecoration: "none" }}>💬 Cliente · {d.clientPhone}</a>}
            {d?.brokerPhone && <a href={waLink(d.brokerPhone)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#dbeafe", color: "#1e40af", fontWeight: 700, fontSize: 12.5, padding: "8px 12px", borderRadius: 9, textDecoration: "none" }}>💬 Corretor · {d.brokerPhone}</a>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {st === "SOLICITADO" && <Btn onClick={() => act(() => csInAnalysis(id), "ok")} bg="#2563eb">Em análise</Btn>}
            {(st === "SOLICITADO" || st === "EM_ANALISE") && <Btn onClick={() => act(() => csAccept(id), "ok")} bg={C.green}>Assumir (Time Calebe atuando)</Btn>}
            {st === "ATUANDO" && <Btn onClick={() => act(() => csFinish(id), "ok")} bg={C.green}>Finalizar</Btn>}
            {st && ACTIVE.includes(st) && <Btn onClick={() => { if (confirm("Cancelar esta solicitação de ajuda comercial?")) act(() => csCancel(id), "ok"); }} bg={C.red}>Cancelar</Btn>}
          </div>
          {d?.justification && <div style={{ marginTop: 12, background: "#f8fafc", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#334155" }}><b style={{ color: C.navy }}>Motivo:</b> {d.justification}</div>}
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: "1px solid #eef2f7" }}>
          {([["conversa", "Conversa"], ["notas", `Notas${d?.notes?.length ? " (" + d.notes.length + ")" : ""}`], ["historico", "Histórico"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: "8px 12px", fontSize: 13, fontWeight: 700, color: tab === k ? C.navy : C.muted, borderBottom: tab === k ? `3px solid ${C.gold}` : "3px solid transparent" }}>{l}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", background: tab === "conversa" ? "#f6f8fb" : "#fff" }}>
          {tab === "conversa" && (
            msgs === null ? <div style={{ color: C.muted, fontSize: 13 }}>Carregando conversa…</div>
              : msgs.length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>Sem mensagens nesta conversa.</div>
                : msgs.map((m: any, i: number) => {
                  const inb = m.direction === "inbound" || m.direction === "IN";
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: inb ? "flex-start" : "flex-end", marginBottom: 7 }}>
                      <div style={{ maxWidth: "82%", background: inb ? "#fff" : "#d9fdd3", border: inb ? "1px solid #e6ebf2" : "none", borderRadius: 10, padding: "7px 11px", fontSize: 13.5, color: "#1a2433", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
                        {m.text || (m.contentType && m.contentType !== "text" ? `[${m.contentType}]` : "")}
                        <div style={{ fontSize: 10.5, color: C.muted, textAlign: "right", marginTop: 3 }}>{new Date(m.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{!inb && m.messageStatus === "failed" ? " · ✗" : ""}</div>
                      </div>
                    </div>
                  );
                })
          )}

          {tab === "notas" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota interna (só o time Calebe vê)…" rows={2}
                  style={{ flex: 1, border: "1px solid #d7dee8", borderRadius: 9, padding: "8px 11px", fontSize: 13, resize: "vertical", color: "#1a2433" }} />
                <button disabled={busy || !note.trim()} onClick={addNote} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, borderRadius: 9, padding: "0 16px", cursor: "pointer", opacity: busy || !note.trim() ? 0.5 : 1 }}>Salvar</button>
              </div>
              {(d?.notes || []).length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>Nenhuma nota ainda.</div>
                : (d?.notes || []).map((n) => (
                  <div key={n.id} style={{ background: "#fffdf5", border: "1px solid #f0e6c8", borderRadius: 9, padding: "10px 12px", marginBottom: 9, fontSize: 13 }}>
                    <div style={{ color: "#1a2433" }}>{n.note}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>{n.author} · {fmtDate(n.createdAt)}</div>
                  </div>
                ))}
            </div>
          )}

          {tab === "historico" && (
            <div>
              {[["Solicitado", d?.requestedAt], ["Em análise", d?.inAnalysisAt], ["Assumido", d?.acceptedAt], ["Finalizado", d?.finishedAt]].filter(([, v]) => v).map(([l, v], i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.gold, marginTop: 5, flex: "0 0 auto" }} />
                  <div><b style={{ color: C.navy }}>{l as string}</b> <span style={{ color: C.muted }}>· {fmtDate(v as string)}</span></div>
                </div>
              ))}
              <div style={{ marginTop: 14, borderTop: "1px solid #eef2f7", paddingTop: 12 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: C.muted, fontWeight: 700, marginBottom: 8 }}>Log de auditoria</div>
                {(d?.logs || []).length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>—</div>
                  : (d?.logs || []).map((g, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: "#475569", marginBottom: 5 }}>
                      <b>{LOG_LABELS[g.action] || g.action}</b> · {fmtDate(g.createdAt)}{g.actorEmail ? ` · ${g.actorEmail}` : ""}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
