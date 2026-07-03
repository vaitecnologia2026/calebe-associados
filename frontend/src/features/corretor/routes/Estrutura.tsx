// Estrutura Premium (corretor) — solicita avião/veículo/apartamento/visita
// GET  /api/structure          (backend filtra pelo associate logado automaticamente)
// POST /api/structure          body { structureType, requestedDate (ISO), urgency,
//                                     linkedLeadName?, linkedValue?, city?, motive (min 10) }
// Subtipos visita-imobiliaria/reuniao/folder ficam como [SUBTIPO:xxx] no início do motive.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plane, Car, Building2, Users, MapPin, Handshake, Package, Sparkles, Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";

type EstruturaTipo = "aviao" | "veiculo" | "apartamento" | "visita" | "imobiliaria" | "reuniao" | "folder";
type StructureType = "PLANE" | "VEHICLE" | "APARTMENT" | "GUIDED_VISIT";
type StructureStatus = "PENDING" | "APPROVED" | "DENIED" | "RESCHEDULED" | "REVIEWING";
type Subtipo = "imobiliaria" | "reuniao" | "folder";

const TIPO_TO_ENUM: Record<EstruturaTipo, StructureType> = {
  aviao:        "PLANE",
  veiculo:      "VEHICLE",
  apartamento:  "APARTMENT",
  visita:       "GUIDED_VISIT",
  imobiliaria:  "GUIDED_VISIT",
  reuniao:      "GUIDED_VISIT",
  folder:       "GUIDED_VISIT",
};
const TYPE_LABEL: Record<StructureType, string> = {
  PLANE: "Avião",
  VEHICLE: "Veículo",
  APARTMENT: "Apartamento",
  GUIDED_VISIT: "Visita Acompanhada",
};
const SUBTIPO_LABEL: Record<Subtipo, string> = {
  imobiliaria: "Visita à Imobiliária",
  reuniao:     "Reunião com Calebe",
  folder:      "Material Físico (Folder)",
};
const URGENCIA_TO_ENUM = { "Baixa": "low", "Média": "medium", "Alta": "high" } as const;

const CARDS: { tipo: EstruturaTipo; icon: typeof Plane; title: string; subtitle: string }[] = [
  { tipo: "aviao",       icon: Plane,     title: "Avião",                subtitle: "Traslado aéreo" },
  { tipo: "veiculo",     icon: Car,       title: "Veículo",              subtitle: "Motorista / carro" },
  { tipo: "apartamento", icon: Building2, title: "Apartamento",          subtitle: "Apoio / hospedagem" },
  { tipo: "visita",      icon: Users,     title: "Visita Acompanhada",   subtitle: "Com assessor" },
  { tipo: "imobiliaria", icon: MapPin,    title: "Visita Imobiliária",   subtitle: "Visita presencial à sede Calebe" },
  { tipo: "reuniao",     icon: Handshake, title: "Reunião com Calebe",   subtitle: "Mentoria / alinhamento estratégico" },
  { tipo: "folder",      icon: Package,   title: "Material Físico",      subtitle: "Folder / book impresso" },
];

interface RawStructureRequest {
  id: string;
  structureType: StructureType;
  status: StructureStatus;
  motive?: string;
  requestedDate?: string;
  urgency?: "low" | "medium" | "high";
  linkedLeadName?: string;
  linkedValue?: number | string;
  city?: string;
  responseNotes?: string;
  createdAt?: string;
}

interface RowVM {
  id: string;
  raw: RawStructureRequest;
  tipoLabel: string;
  motivo: string;
  requestedDate?: string;
  urgenciaLabel: string;
  status: StructureStatus;
}

function adapt(s: RawStructureRequest): RowVM {
  let motivo = s.motive ?? "";
  let tipoLabel = TYPE_LABEL[s.structureType] ?? s.structureType;

  const ms = motivo.match(/^\[SUBTIPO:(imobiliaria|reuniao|folder)\]\s*/);
  if (ms) {
    const sub = ms[1] as Subtipo;
    if (SUBTIPO_LABEL[sub]) tipoLabel = SUBTIPO_LABEL[sub];
    motivo = motivo.slice(ms[0].length);
  }
  const mi = motivo.match(/^\[IMOVEL:[A-Za-z0-9_-]+\]\s*/);
  if (mi) motivo = motivo.slice(mi[0].length);

  const urgMap: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
  return {
    id: s.id,
    raw: s,
    tipoLabel,
    motivo: motivo.trim(),
    requestedDate: s.requestedDate,
    urgenciaLabel: urgMap[s.urgency ?? ""] ?? "—",
    status: s.status,
  };
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
      " · " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function CorretorEstrutura() {
  const [rows, setRows] = useState<RowVM[]>([]);
  const [openModal, setOpenModal] = useState<null | EstruturaTipo>(null);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    try {
      const r = await api.get<{ data: RawStructureRequest[] }>("/api/structure");
      setRows((r.data ?? []).map(adapt));
    } catch { /* silent */ }
  }
  useEffect(() => { void load(); }, []);

  // Pre-seleciona via query string ?tipo=aviao
  useEffect(() => {
    const tipo = new URLSearchParams(window.location.search).get("tipo");
    if (tipo && ["aviao","veiculo","apartamento","visita","imobiliaria","reuniao","folder"].includes(tipo)) {
      setOpenModal(tipo as EstruturaTipo);
    }
  }, []);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <header className="mb-8">
        <p className="meta-gold inline-flex items-center gap-1.5"><Sparkles size={13} /> Diferencial Calebe</p>
        <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight mt-1">
          Estrutura <span className="text-gold-400">Premium</span>
        </h1>
        <p className="text-sand-100/65 mt-2 max-w-xl text-sm">
          Agende recursos exclusivos da Calebe para alavancar visitas e fechamentos de alto valor.
        </p>
      </header>

      {/* 7 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {CARDS.map(({ tipo, icon: Icon, title, subtitle }) => (
          <button
            key={tipo}
            onClick={() => setOpenModal(tipo)}
            className="card p-5 text-left hover:border-gold-400/50 transition-colors"
          >
            <div className="text-gold-400 mb-3">
              <Icon size={28} />
            </div>
            <p className="font-bold text-lg">{title}</p>
            <p className="text-xs text-sand-100/60 mt-1">{subtitle}</p>
          </button>
        ))}
      </div>

      {/* Suas solicitações */}
      <div>
        <span className="pill mb-3 inline-block">Suas solicitações</span>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
              <tr>
                <th className="text-left p-3">Tipo</th>
                <th className="text-left p-3">Quando</th>
                <th className="text-left p-3">Urgência</th>
                <th className="text-left p-3">Motivo</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-sand-100/55">Nenhuma solicitação ainda.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t hairline">
                  <td className="p-3 font-semibold">{r.tipoLabel}</td>
                  <td className="p-3 text-xs">{fmtDate(r.requestedDate)}</td>
                  <td className="p-3">
                    <StatusPill tone={r.urgenciaLabel === "Alta" ? "danger" : r.urgenciaLabel === "Média" ? "warning" : "neutral"}>
                      {r.urgenciaLabel}
                    </StatusPill>
                  </td>
                  <td className="p-3 text-xs max-w-md">
                    <p className="text-sand-100/85 leading-snug" title={r.motivo}>
                      {r.motivo.length > 100 ? r.motivo.slice(0, 100) + "…" : (r.motivo || "—")}
                    </p>
                    {r.status === "DENIED" && r.raw.responseNotes && (
                      <p className="text-[10px] mt-1 text-red-300/90" title={r.raw.responseNotes}>
                        <span className="font-semibold">Negado:</span> {r.raw.responseNotes.length > 80 ? r.raw.responseNotes.slice(0, 80) + "…" : r.raw.responseNotes}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <StatusPill tone={
                      r.status === "APPROVED" ? "success" :
                      r.status === "DENIED" ? "danger" :
                      r.status === "RESCHEDULED" || r.status === "REVIEWING" ? "warning" :
                      "warning"
                    }>
                      {r.status === "APPROVED" ? "Aprovado" :
                       r.status === "DENIED"   ? "Negado"   :
                       r.status === "RESCHEDULED" ? "Remarcado" :
                       r.status === "REVIEWING" ? "Em análise" :
                       "Pendente"}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <EstruturaModal
        open={!!openModal}
        tipo={openModal}
        onClose={() => setOpenModal(null)}
        onSaved={() => { setOpenModal(null); void load(); showToast("Solicitação enviada"); }}
      />
    </div>
  );
}

// =========================================================================
// Modal de solicitação · monta payload no shape do zod backend
// =========================================================================

interface MFProps {
  open: boolean;
  tipo: EstruturaTipo | null;
  onClose: () => void;
  onSaved: () => void;
}

function EstruturaModal({ open, tipo, onClose, onSaved }: MFProps) {
  const [leadStatus, setLeadStatus] = useState("Proposta em andamento");
  const [valorNeg, setValorNeg] = useState("");
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [cidade, setCidade] = useState("Itapema");
  const [urgencia, setUrgencia] = useState<"Baixa" | "Média" | "Alta">("Média");
  const [motivo, setMotivo] = useState("");
  const [leadName, setLeadName] = useState("");
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  const tipoLabel = useMemo(() => tipo ? (CARDS.find((c) => c.tipo === tipo)?.title ?? tipo) : "", [tipo]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!tipo) return;
    if (!data) { showToast("Selecione a data"); return; }
    if (motivo.trim().length < 10) { showToast("Motivo precisa de pelo menos 10 caracteres"); return; }

    // monta ISO datetime
    const horaSafe = hora || "12:00";
    const requestedDate = new Date(`${data}T${horaSafe}:00`).toISOString();

    // monta motive: prefixa [SUBTIPO:xxx] quando o tipo do front for subtipo de GUIDED_VISIT
    const subtipo: Subtipo | null =
      tipo === "imobiliaria" ? "imobiliaria" :
      tipo === "reuniao"     ? "reuniao"     :
      tipo === "folder"      ? "folder"      : null;
    const motivePrefixado = subtipo
      ? `[SUBTIPO:${subtipo}] ${motivo.trim()}`
      : motivo.trim();

    // Inclui contexto do form que o backend não modela (leadStatus) no motivo
    const motiveFinal = `${motivePrefixado}\n\nEstágio do lead: ${leadStatus}`;

    const payload: Record<string, unknown> = {
      structureType: TIPO_TO_ENUM[tipo],
      requestedDate,
      urgency: URGENCIA_TO_ENUM[urgencia],
      motive: motiveFinal,
    };
    if (leadName.trim())  payload.linkedLeadName = leadName.trim();
    if (valorNeg.trim())  payload.linkedValue    = valorNeg.trim();
    if (cidade.trim())    payload.city           = cidade.trim();

    setSaving(true);
    try {
      await api.post("/api/structure", payload);
      onSaved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Solicitar ${tipoLabel}`} size="md">
      <p className="text-sm text-sand-100/65 mb-4">Preencha os dados da solicitação · o analista do Calebe analisa em até 24h úteis.</p>

      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Nome do lead (opcional)"
          value={leadName}
          onChange={(e) => setLeadName(e.target.value)}
          placeholder="Ex: João da Silva"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Estágio do lead</label>
            <select className="field-input" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}>
              <option>Primeiro contato</option>
              <option>Qualificado</option>
              <option>Proposta em andamento</option>
              <option>Fechamento iminente</option>
            </select>
          </div>
          <Field label="Valor estimado da negociação" value={valorNeg} onChange={(e) => setValorNeg(e.target.value)} placeholder="R$ 0,00" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          <Field label="Horário" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Cidade / trecho" value={cidade} onChange={(e) => setCidade(e.target.value)} />
          <div>
            <label className="field-label">Urgência</label>
            <select className="field-input" value={urgencia} onChange={(e) => setUrgencia(e.target.value as "Baixa" | "Média" | "Alta")}>
              <option value="Baixa">Baixa</option>
              <option value="Média">Média</option>
              <option value="Alta">Alta</option>
            </select>
          </div>
        </div>

        <div className="card p-4 bg-gold-400/5 border-gold-400/20">
          <label className="field-label text-gold-300 mb-2 inline-flex items-center gap-1.5">
            Motivo da reserva — justifique a negociação e o investimento *
          </label>
          <p className="text-[0.72rem] text-sand-100/60 mb-3 leading-relaxed">
            Explique claramente: <strong>por que</strong> essa estrutura é necessária, o <strong>valor</strong> da oportunidade,
            o <strong>risco</strong> de não usar o recurso, e a <strong>relação ROI × custo</strong>. Mínimo 10 caracteres.
          </p>
          <textarea
            className="field-input"
            rows={6}
            required
            minLength={10}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex: Cliente vindo de SP na sexta, proposta de R$ 4.9M. Concorrente já agendou visita. Sem avião, perco janela. Comissão estimada R$ 173K vs. custo R$ 8K do avião."
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="gold" loading={saving}>
            <Plus size={14} /> Enviar solicitação
          </Button>
        </div>
      </form>
    </Modal>
  );
}
