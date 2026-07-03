// Estrutura Premium · solicitações de avião/veículo/apartamento/visita guiada
// GET /api/structure  ·  PATCH /api/structure/:id/respond  { status, notes }
// Backend retorna: structureType, motive, linkedLeadName, associate.user.name, requestedDate, responseNotes.
// Marcadores [SUBTIPO:xxx] e [IMOVEL:xxx] vivem no início do `motive` (convenção do monólito).
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { Check, X, Plane, Car, MapPin, Home } from "lucide-react";

type StructureType = "PLANE" | "VEHICLE" | "APARTMENT" | "GUIDED_VISIT";
type StructureStatus = "PENDING" | "APPROVED" | "DENIED" | "RESCHEDULED" | "REVIEWING";

interface RawStructureRequest {
  id: string;
  structureType: StructureType;
  status: StructureStatus;
  motive?: string;
  linkedLeadName?: string;
  linkedValue?: number | string;
  city?: string;
  urgency?: "low" | "medium" | "high";
  requestedDate?: string;
  responseNotes?: string;
  createdAt?: string;
  associate?: { user?: { name?: string } };
}

interface RowVM {
  id: string;
  raw: RawStructureRequest;
  tipoLabel: string;
  tipoEnum: StructureType;
  subtipo?: "imobiliaria" | "reuniao" | "folder";
  imovelCodigo?: string;
  motivo: string;
  lead: string;
  corretor: string;
  status: StructureStatus;
  requestedDate?: string;
}

const TYPE_LABEL: Record<StructureType, string> = {
  PLANE: "Avião",
  VEHICLE: "Veículo",
  APARTMENT: "Apartamento",
  GUIDED_VISIT: "Visita Acompanhada",
};

const SUBTIPO_LABEL: Record<string, string> = {
  imobiliaria: "Visita à Imobiliária",
  reuniao:     "Reunião com Calebe",
  folder:      "Material Físico (Folder)",
};

function adapt(s: RawStructureRequest): RowVM {
  let motivo = s.motive ?? "";
  let tipoLabel = TYPE_LABEL[s.structureType] ?? s.structureType;
  let subtipo: RowVM["subtipo"];
  let imovelCodigo: string | undefined;

  const ms = motivo.match(/^\[SUBTIPO:(imobiliaria|reuniao|folder)\]\s*/);
  if (ms) {
    subtipo = ms[1] as RowVM["subtipo"];
    if (subtipo && SUBTIPO_LABEL[subtipo]) tipoLabel = SUBTIPO_LABEL[subtipo];
    motivo = motivo.slice(ms[0].length);
  }
  const mi = motivo.match(/^\[IMOVEL:([A-Za-z0-9_-]+)\]\s*/);
  if (mi) {
    imovelCodigo = mi[1];
    motivo = motivo.slice(mi[0].length);
  }

  return {
    id: s.id,
    raw: s,
    tipoLabel,
    tipoEnum: s.structureType,
    subtipo,
    imovelCodigo,
    motivo: motivo.trim(),
    lead: s.linkedLeadName?.trim() || "—",
    corretor: s.associate?.user?.name?.trim() || "—",
    status: s.status,
    requestedDate: s.requestedDate,
  };
}

function typeIcon(t: StructureType, subtipo?: RowVM["subtipo"]) {
  if (subtipo === "imobiliaria") return <Home size={14} />;
  switch (t) {
    case "PLANE":     return <Plane size={14} />;
    case "VEHICLE":   return <Car size={14} />;
    case "APARTMENT": return <Home size={14} />;
    case "GUIDED_VISIT": return <MapPin size={14} />;
  }
}

function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
      " · " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function Estrutura() {
  const [rows, setRows] = useState<RowVM[]>([]);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    try {
      const r = await api.get<{ data: RawStructureRequest[] }>("/api/structure?limit=200");
      setRows((r.data ?? []).map(adapt));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  useEffect(() => { void load(); }, []);

  async function approve(id: string) {
    try {
      await api.patch(`/api/structure/${id}/respond`, { status: "APPROVED" });
      showToast("Solicitação aprovada");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  async function deny(id: string) {
    const notes = prompt("Motivo da negação?");
    if (!notes || !notes.trim()) return;
    try {
      await api.patch(`/api/structure/${id}/respond`, { status: "DENIED", notes: notes.trim() });
      showToast("Solicitação negada");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  const cols: Column<RowVM>[] = useMemo(() => [
    {
      key: "tipo", header: "Tipo",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {typeIcon(r.tipoEnum, r.subtipo)} {r.tipoLabel}
          {r.imovelCodigo && (
            <span className="ml-1 text-[10px] font-bold text-gold-300 bg-gold-400/15 px-1.5 py-0.5 rounded">
              {r.imovelCodigo}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "lead", header: "Lead/Corretor",
      render: (r) => (
        <div className="leading-tight">
          <p className="font-semibold text-sand-50">{r.lead}</p>
          <p className="text-xs text-sand-100/55">{r.corretor}</p>
        </div>
      ),
    },
    {
      key: "just", header: "Justificativa",
      render: (r) => {
        const txt = r.motivo || "—";
        const denyNote = r.status === "DENIED" ? r.raw.responseNotes?.trim() : "";
        return (
          <div className="max-w-md">
            <p className="text-xs text-sand-100/85 leading-snug" title={txt}>
              {txt.length > 120 ? txt.slice(0, 120) + "…" : txt}
            </p>
            {denyNote && (
              <p className="text-[11px] mt-1 text-red-300/90 leading-snug" title={denyNote}>
                <span className="font-semibold">Negado:</span> {denyNote.length > 90 ? denyNote.slice(0, 90) + "…" : denyNote}
              </p>
            )}
          </div>
        );
      },
    },
    { key: "ag", header: "Agendado", render: (r) => fmtDateTime(r.requestedDate) },
    {
      key: "st", header: "Status",
      render: (r) =>
        r.status === "PENDING"     ? <StatusPill tone="warning">Pendente</StatusPill> :
        r.status === "APPROVED"    ? <StatusPill tone="success">Aprovado</StatusPill> :
        r.status === "DENIED"      ? <StatusPill tone="danger">Negado</StatusPill>   :
        r.status === "RESCHEDULED" ? <StatusPill tone="warning">Remarcado</StatusPill> :
        r.status === "REVIEWING"   ? <StatusPill tone="warning">Em análise</StatusPill> :
        <StatusPill tone="warning">{r.status}</StatusPill>,
    },
    {
      key: "act", header: "", align: "right",
      render: (r) => r.status !== "PENDING" ? null : (
        <div className="flex gap-1.5 justify-end">
          <Button variant="gold" onClick={() => approve(r.id)} style={{ padding: ".4rem .7rem", fontSize: ".72rem" }}>
            <Check size={13} />
          </Button>
          <Button variant="danger" onClick={() => deny(r.id)} style={{ padding: ".4rem .7rem", fontSize: ".72rem" }}>
            <X size={13} />
          </Button>
        </div>
      ),
    },
  ], []);

  return (
    <div className="p-6 md:p-8">
      <PageHeader title="Estrutura Premium" description="Solicitações de avião, veículo, apartamento e visita guiada" />
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} empty="Nenhuma solicitação." />
    </div>
  );
}
