// Visitas (corretor) — backend filtra /api/visits pelo associate logado automaticamente.
// Visit shape: { id, associateId, leadName, propertyId, scheduledAt, status, notes,
//                property: { code, title }, associate: { user: { name } } }
// Status enum: PENDING | CONFIRMED | DONE | CANCELLED | RESCHEDULED
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Check, X as XIcon, Calendar, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import type { Property } from "@/types/property";

type VisitStatus = "PENDING" | "CONFIRMED" | "DONE" | "CANCELLED" | "RESCHEDULED";

interface Visit {
  id: string;
  leadName: string;
  propertyId: string;
  scheduledAt: string;
  status: VisitStatus;
  notes?: string | null;
  property?: { code?: string; title?: string };
  createdAt?: string;
}

const STATUS_LABEL: Record<VisitStatus, string> = {
  PENDING:     "Agendada",
  CONFIRMED:   "Confirmada",
  DONE:        "Realizada",
  CANCELLED:   "Cancelada",
  RESCHEDULED: "Remarcada",
};
const STATUS_TONE: Record<VisitStatus, "info" | "success" | "warning" | "danger" | "neutral"> = {
  PENDING:     "info",
  CONFIRMED:   "warning",
  DONE:        "success",
  CANCELLED:   "danger",
  RESCHEDULED: "warning",
};

function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function CorretorVisitas() {
  const [list, setList] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Visit[] }>("/api/visits");
      setList(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function changeStatus(id: string, status: VisitStatus) {
    try {
      await api.patch(`/api/visits/${id}/status`, { status });
      showToast(`Visita marcada como ${STATUS_LABEL[status].toLowerCase()}`);
      void load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  const stats = useMemo(() => {
    const proximas = list.filter((v) => v.status === "PENDING" || v.status === "CONFIRMED").length;
    const realizadas = list.filter((v) => v.status === "DONE").length;
    const futuras = list.filter((v) => {
      const t = new Date(v.scheduledAt).getTime();
      return Number.isFinite(t) && t > Date.now() && (v.status === "PENDING" || v.status === "CONFIRMED");
    }).length;
    return { proximas, realizadas, futuras };
  }, [list]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap justify-between items-end gap-3">
        <div>
          <p className="meta-gold">Agenda</p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight mt-1">Minhas visitas</h1>
        </div>
        <Button variant="gold" style={{ padding: ".55rem 1.25rem" }} onClick={() => setModalOpen(true)}>
          <Plus size={14} /> Agendar visita
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 lg:gap-4 mb-5">
        <Kpi label="Próximas" value={stats.proximas} />
        <Kpi label="Realizadas" value={stats.realizadas} />
        <Kpi label="No futuro" value={stats.futuras} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Quando</th>
              <th className="text-left p-3">Lead</th>
              <th className="text-left p-3">Imóvel</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Observações</th>
              <th className="text-right p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-sand-100/55">Nenhuma visita agendada.</td></tr>
            ) : list.map((v) => (
              <tr key={v.id} className="border-t hairline">
                <td className="p-3 text-xs whitespace-nowrap">{fmtDateTime(v.scheduledAt)}</td>
                <td className="p-3 font-semibold">{v.leadName}</td>
                <td className="p-3">
                  {v.property?.code ? (
                    <div className="leading-tight">
                      <p className="font-mono text-xs">{v.property.code}</p>
                      {v.property.title && <p className="text-xs text-sand-100/55">{v.property.title}</p>}
                    </div>
                  ) : "—"}
                </td>
                <td className="p-3">
                  <StatusPill tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</StatusPill>
                </td>
                <td className="p-3 text-xs text-sand-100/75 max-w-[280px]">
                  {v.notes ? (v.notes.length > 80 ? v.notes.slice(0, 80) + "…" : v.notes) : <span className="text-sand-100/40">—</span>}
                </td>
                <td className="p-3 text-right">
                  {(v.status === "PENDING" || v.status === "CONFIRMED") && (
                    <div className="inline-flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void changeStatus(v.id, "DONE")}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1"
                        title="Marcar como realizada"
                      >
                        <Check size={12} /> Realizada
                      </button>
                      <button
                        type="button"
                        onClick={() => void changeStatus(v.id, "CANCELLED")}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1"
                        title="Cancelar"
                      >
                        <XIcon size={12} /> Cancelar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NovaVisitaModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); void load(); }} />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-4">
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">{label}</p>
      <p className="text-2xl md:text-[2rem] font-display font-light tracking-[-0.03em] mt-1 leading-tight">{value}</p>
    </div>
  );
}

// =========================================================================
// Modal Nova Visita — backend POST /api/visits zod schema:
//   { leadName: min 2, propertyId: cuid, scheduledAt: ISO datetime, notes? }
// =========================================================================
function NovaVisitaModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const showToast = useUi((s) => s.showToast);
  const [leadName, setLeadName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [properties, setProperties] = useState<Property[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingProps(true);
    (async () => {
      try {
        const r = await api.get<{ data: Property[] }>("/api/properties?limit=500");
        const all = r.data ?? [];
        const dispo = all.filter((p) => p.status === "AVAILABLE" || p.status === "RESERVED");
        setProperties(dispo.length ? dispo : all);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Erro ao carregar imóveis: ${msg}`);
      } finally { setLoadingProps(false); }
    })();
  }, [open, showToast]);

  function reset() {
    setLeadName(""); setPropertyId(""); setData(""); setHora(""); setNotes("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!leadName.trim()) { showToast("Informe o nome do lead"); return; }
    if (leadName.trim().length < 2) { showToast("Nome do lead muito curto"); return; }
    if (!propertyId) { showToast("Selecione o imóvel"); return; }
    if (!data) { showToast("Informe a data"); return; }
    const horaSafe = hora || "10:00";
    const scheduledAt = new Date(`${data}T${horaSafe}:00`).toISOString();

    setSaving(true);
    try {
      await api.post("/api/visits", {
        leadName: leadName.trim(),
        propertyId,
        scheduledAt,
        notes: notes.trim() || undefined,
      });
      showToast(`Visita agendada para ${new Date(scheduledAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
      reset();
      onSaved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={() => { if (!saving) { reset(); onClose(); } }} title="Agendar nova visita" size="md">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome do lead *" value={leadName} onChange={(e) => setLeadName(e.target.value)} required minLength={2} placeholder="João da Silva" disabled={saving} />

        <div>
          <label className="field-label">Imóvel *</label>
          {loadingProps ? (
            <div className="field-input flex items-center gap-2 text-sand-100/55 text-sm">
              <Loader2 size={14} className="animate-spin" /> Carregando imóveis…
            </div>
          ) : (
            <select className="field-input text-sm" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required disabled={saving}>
              <option value="">— escolha um imóvel —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.title}{p.city ? ` (${p.city})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} required disabled={saving} />
          <Field label="Horário" type="time" value={hora} onChange={(e) => setHora(e.target.value)} disabled={saving} />
        </div>

        <div>
          <label className="field-label">Observações</label>
          <textarea
            className="field-input text-sm"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Detalhes da visita, ponto de encontro, expectativas do cliente…"
            disabled={saving}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t hairline">
          <Button type="button" variant="outline" onClick={() => { if (!saving) { reset(); onClose(); } }} disabled={saving}>Cancelar</Button>
          <Button type="submit" variant="gold" loading={saving}>
            <Calendar size={14} /> Agendar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
