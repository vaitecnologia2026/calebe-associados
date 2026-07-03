// Visitas (admin) — vê todas, filtra por status/corretor, pode mudar status
// Backend: GET /api/visits (admin vê tudo) · PATCH /api/visits/:id/status
// Shape: { id, leadName, propertyId, scheduledAt, status, notes, property: {code,title}, associate: {user: {name}} }
import { useEffect, useMemo, useState } from "react";
import { Check, X as XIcon, RefreshCw, Plus, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { KpiCard } from "../components/KpiCard";

interface AssociateBrief { id: string; user?: { name?: string } }
interface PropertyBrief { id: string; code?: string; title?: string }

type VisitStatus = "PENDING" | "CONFIRMED" | "DONE" | "CANCELLED" | "RESCHEDULED";

interface Visit {
  id: string;
  leadName: string;
  propertyId: string;
  scheduledAt: string;
  status: VisitStatus;
  notes?: string | null;
  property?: { code?: string; title?: string };
  associate?: { user?: { name?: string } };
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

export function Visitas() {
  const [list, setList] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"" | VisitStatus>("");
  const [corretorFilter, setCorretorFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Visit[] }>("/api/visits?limit=500");
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

  const corretores = useMemo(
    () => [...new Set(list.map((v) => v.associate?.user?.name).filter(Boolean) as string[])].sort(),
    [list],
  );

  const filtered = useMemo(() => {
    return list.filter((v) => {
      if (statusFilter && v.status !== statusFilter) return false;
      if (corretorFilter && v.associate?.user?.name !== corretorFilter) return false;
      return true;
    });
  }, [list, statusFilter, corretorFilter]);

  const counts = useMemo(() => ({
    total:      list.length,
    proximas:   list.filter((v) => v.status === "PENDING" || v.status === "CONFIRMED").length,
    realizadas: list.filter((v) => v.status === "DONE").length,
    canceladas: list.filter((v) => v.status === "CANCELLED").length,
  }), [list]);

  const cols: Column<Visit>[] = [
    {
      key: "ag", header: "Agendamento",
      render: (v) => <span className="text-xs whitespace-nowrap">{fmtDateTime(v.scheduledAt)}</span>,
    },
    { key: "lead", header: "Lead", render: (v) => <span className="font-semibold">{v.leadName}</span> },
    {
      key: "imov", header: "Imóvel",
      render: (v) => v.property?.code ? (
        <div className="leading-tight">
          <p className="font-mono text-xs">{v.property.code}</p>
          {v.property.title && <p className="text-xs text-sand-100/55">{v.property.title}</p>}
        </div>
      ) : "—",
    },
    { key: "cor", header: "Corretor", render: (v) => v.associate?.user?.name ?? "—" },
    {
      key: "notes", header: "Observações",
      render: (v) => v.notes
        ? <span className="text-xs text-sand-100/75 whitespace-pre-wrap break-words max-w-[260px] block">{v.notes}</span>
        : <span className="text-sand-100/40 text-xs">—</span>,
    },
    {
      key: "st", header: "Status",
      render: (v) => <StatusPill tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</StatusPill>,
    },
    {
      key: "act", header: "", align: "right",
      render: (v) => (v.status === "PENDING" || v.status === "CONFIRMED") ? (
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
      ) : null,
    },
  ];

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Visitas"
        description={`${counts.total} visitas registradas pelos corretores`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="gold" onClick={() => setCreateOpen(true)}><Plus size={14} /> Nova visita</Button>
            <Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>
          </div>
        }
      />

      {createOpen && (
        <NovaVisitaModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(); }}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Total" value={counts.total} />
        <KpiCard label="Próximas" value={counts.proximas} accent="info" />
        <KpiCard label="Realizadas" value={counts.realizadas} accent="success" />
        <KpiCard label="Canceladas" value={counts.canceladas} accent="warning" />
      </div>

      <div className="grid sm:grid-cols-[auto_auto] gap-2 mb-4">
        <select className="field-input text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | VisitStatus)}>
          <option value="">Todos status</option>
          {(Object.keys(STATUS_LABEL) as VisitStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className="field-input text-sm" value={corretorFilter} onChange={(e) => setCorretorFilter(e.target.value)}>
          <option value="">Todos corretores</option>
          {corretores.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <DataTable rows={filtered} columns={cols} rowKey={(v) => v.id} empty="Nenhuma visita encontrada." />
    </div>
  );
}

// Modal admin agendar visita · POST /api/visits
// Backend body: { leadName, propertyId (cuid), scheduledAt (ISO), notes?, associateId? }
function NovaVisitaModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const showToast = useUi((s) => s.showToast);
  const [leadName, setLeadName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [associateId, setAssociateId] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0);
    return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [associates, setAssociates] = useState<AssociateBrief[]>([]);
  const [properties, setProperties] = useState<PropertyBrief[]>([]);
  const [propSearch, setPropSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [a, p] = await Promise.all([
          api.get<{ data: AssociateBrief[] }>("/api/associates?limit=1000").catch(() => ({ data: [] })),
          api.get<{ data: PropertyBrief[] }>("/api/properties?limit=2000").catch(() => ({ data: [] })),
        ]);
        setAssociates(a.data ?? []);
        setProperties(p.data ?? []);
      } catch { /* silent */ }
    })();
  }, []);

  const filteredProps = useMemo(() => {
    const q = propSearch.trim().toLowerCase();
    if (!q) return properties.slice(0, 50);
    return properties.filter((p) =>
      (p.code ?? "").toLowerCase().includes(q) || (p.title ?? "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [properties, propSearch]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!leadName.trim() || leadName.trim().length < 2) { showToast("Nome do lead obrigatório (min 2 chars)"); return; }
    if (!propertyId) { showToast("Selecione o imóvel"); return; }
    if (!scheduledAt) { showToast("Selecione data e hora"); return; }
    setSaving(true);
    try {
      const isoAt = new Date(scheduledAt).toISOString();
      const payload: Record<string, string> = {
        leadName: leadName.trim(),
        propertyId,
        scheduledAt: isoAt,
      };
      if (notes.trim()) payload.notes = notes.trim();
      if (associateId) payload.associateId = associateId;
      await api.post("/api/visits", payload);
      showToast("Visita agendada");
      onCreated();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] calebe-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-canvas border hairline rounded-lg w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b hairline">
          <div>
            <p className="text-xs uppercase tracking-mono-wide font-semibold text-sand-100/55">Nova visita</p>
            <h2 className="font-bold text-lg">Agendar manualmente</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sand-100/55 hover:text-sand-50" aria-label="Fechar">
            <XIcon size={18} />
          </button>
        </header>

        <form onSubmit={submit} className="p-5 space-y-3 max-h-[80vh] overflow-y-auto">
          <Field
            label="Nome do lead *"
            value={leadName}
            onChange={(e) => setLeadName(e.target.value)}
            placeholder="ex: Maria Silva"
            required
            minLength={2}
          />

          <div>
            <label className="field-label">Imóvel *</label>
            <input
              type="text"
              className="field-input text-sm mb-1"
              placeholder="Buscar por código ou título…"
              value={propSearch}
              onChange={(e) => setPropSearch(e.target.value)}
            />
            <select
              className="field-input text-sm"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              required
              size={filteredProps.length > 1 ? Math.min(filteredProps.length, 5) : 1}
            >
              {filteredProps.length === 0 ? (
                <option value="">— sem resultado —</option>
              ) : (
                <>
                  <option value="">Selecione…</option>
                  {filteredProps.map((p) => (
                    <option key={p.id} value={p.id}>{(p.code ?? p.id)} · {p.title ?? ""}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Data e hora *</label>
              <input
                type="datetime-local"
                className="field-input text-sm"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="field-label">Corretor responsável</label>
              <select
                className="field-input text-sm"
                value={associateId}
                onChange={(e) => setAssociateId(e.target.value)}
              >
                <option value="">— escolher depois —</option>
                {associates.map((a) => (
                  <option key={a.id} value={a.id}>{a.user?.name ?? a.id}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="field-label">Observações</label>
            <textarea
              className="field-input text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="opcional"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t hairline">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" variant="gold" disabled={saving || !leadName.trim() || !propertyId}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {saving ? "Agendando…" : "Agendar visita"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
