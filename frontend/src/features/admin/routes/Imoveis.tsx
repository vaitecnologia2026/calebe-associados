// Imóveis admin · porte FIEL do monólito (renderDevelopmentsGrid · linha 19471+)
// 3 tabs: Empreendimentos · Todas as unidades · Imóveis enviados corretor
// Endpoints: /api/properties, /api/developments
// Ações no header: Novo empreendimento · Nova unidade · Imóvel especial
//
// Nota: Botão "Importar DWV" foi removido (backend retorna 503 dwv_disabled).
// Quando reativar a integração DWV no backend, restaurar o botão usando
// DownloadCloud + onClick → modal /api/dwv/preview + /sync.

import { useEffect, useMemo, useState } from "react";
import {
  Building, Plus, Sparkles, ChevronDown, Folder, Play, MapPin,
} from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { Modal } from "@/components/ui/Modal";
import { NewDevelopmentModal } from "../components/NewDevelopmentModal";
import { NewUnitModal } from "../components/NewUnitModal";
import type { Property, Development } from "@/types/property";
import { PropertyAdCard } from "@/features/admin/components/PropertyAdCard";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo", SOLD_OUT: "Esgotado", DELIVERED: "Entregue",
  SUSPENDED: "Suspenso", INACTIVE: "Inativo",
};
const STATUS_TONE: Record<string, "success" | "warning" | "info" | "danger" | "neutral"> = {
  ACTIVE: "success", SOLD_OUT: "warning", DELIVERED: "info",
  SUSPENDED: "danger", INACTIVE: "neutral",
};

function fmtBRL(v: any) {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR");
}

export function Imoveis() {
  const tab = useUi((s) => s.admImovTab);
  const setTab = useUi((s) => s.setAdmImovTab);
  const rendered = useUi((s) => s.admImovRenderedCount);
  const loadMore = useUi((s) => s.admImovLoadMore);
  const showToast = useUi((s) => s.showToast);

  const [props, setProps] = useState<Property[]>([]);
  const [devs, setDevs] = useState<Development[]>([]);
  const [loading, setLoading] = useState(false);
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [unitModal, setUnitModal] = useState<{ open: boolean; especial: boolean }>({ open: false, especial: false });
  const [detailUnit, setDetailUnit] = useState<Property | null>(null);
  const [editUnit, setEditUnit] = useState<Property | null>(null);
  const [adCardUnit, setAdCardUnit] = useState<Property | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [p, d] = await Promise.all([
        api.get<{ data: Property[] }>("/api/properties?limit=200"),
        api.get<{ data: Development[] }>("/api/developments?limit=5000").catch(() => ({ data: [] })),
      ]);
      setProps(p.data ?? []);
      setDevs(d.data ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const lista = useMemo(() => {
    const subStatus = (p: Property) => p._meta?.submission?.status ?? "APPROVED_PUBLIC";
    if (tab === "enviados") {
      return props
        .filter((i) => subStatus(i) === "PENDING" || subStatus(i) === "DENIED")
        .sort((a, b) => {
          const order: any = { PENDING: 0, DENIED: 1 };
          return (order[subStatus(a)] ?? 9) - (order[subStatus(b)] ?? 9);
        });
    }
    if (tab === "todos") {
      return props.filter((i) => {
        const s = subStatus(i);
        return s !== "PENDING" && s !== "DENIED";
      });
    }
    return [];
  }, [props, tab]);

  const visible = lista.slice(0, rendered);
  const remaining = lista.length - visible.length;
  const pendentes = props.filter((p) => p._meta?.submission?.status === "PENDING").length;

  async function aprovar(id: string, mode: "public" | "private") {
    try {
      const action = mode === "public" ? "approve_public" : "approve_private";
      await api.post(`/api/properties/${id}/approval`, { action });
      showToast(mode === "public" ? "Aprovado pra todos" : "Aprovado pro corretor");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  async function negar(id: string) {
    const reason = prompt("Motivo da reprovação?");
    if (!reason || !reason.trim()) return;
    try {
      await api.post(`/api/properties/${id}/approval`, { action: "deny", reason: reason.trim() });
      showToast("Imóvel negado");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <span className="pill">Portfólio</span>
          <h1 className="text-3xl md:text-4xl font-bold tracking-display-tight mt-2">Imóveis</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" style={{ padding: ".5rem 1rem" }} onClick={() => setDevModalOpen(true)}>
            <Building size={14} /> Novo empreendimento
          </Button>
          <Button variant="outline" style={{ padding: ".5rem 1rem" }} onClick={() => setUnitModal({ open: true, especial: false })}>
            <Plus size={14} /> Nova unidade
          </Button>
          <Button variant="gold" style={{ padding: ".5rem 1rem" }} onClick={() => setUnitModal({ open: true, especial: true })}>
            <Sparkles size={14} /> Imóvel especial
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b hairline overflow-x-auto">
        <TabBtn active={tab === "empreendimentos"} onClick={() => setTab("empreendimentos")}>Empreendimentos</TabBtn>
        <TabBtn active={tab === "todos"}           onClick={() => setTab("todos")}>Todas as unidades</TabBtn>
        <TabBtn active={tab === "enviados"}        onClick={() => setTab("enviados")}>
          Imóveis enviados corretor
          {pendentes > 0 && (
            <span className="ml-2 text-[0.58rem] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/40 font-bold">{pendentes}</span>
          )}
        </TabBtn>
      </div>

      {/* Conteúdo */}
      {loading && devs.length === 0 && props.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
      ) : tab === "empreendimentos" ? (
        <DevsGrid devs={devs} units={props} />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4">
            {visible.map((i) => (
              <UnitCard
                key={i.id} p={i}
                onClick={() => setDetailUnit(i)}
                onApprovePublic={() => aprovar(i.id, "public")}
                onApprovePrivate={() => aprovar(i.id, "private")}
                onDeny={() => negar(i.id)}
              />
            ))}
            {visible.length === 0 && (
              <div className="col-span-full p-8 text-center text-sand-100/55">
                {tab === "enviados" ? "Nenhum envio pendente." : "Nenhuma unidade cadastrada."}
              </div>
            )}
          </div>
          {remaining > 0 && (
            <div className="mt-4 text-center">
              <button className="btn-base btn-outline text-xs" style={{ padding: ".6rem 1.2rem" }} onClick={loadMore}>
                <ChevronDown size={14} /> Carregar mais 60 ({remaining} restantes)
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal Novo Empreendimento */}
      <NewDevelopmentModal
        open={devModalOpen}
        onClose={() => setDevModalOpen(false)}
        onSaved={() => void load()}
      />

      {/* Modal Nova Unidade / Imóvel Especial (mesmo modal, flag isEspecial) */}
      <NewUnitModal
        open={unitModal.open}
        isEspecial={unitModal.especial}
        onClose={() => setUnitModal({ open: false, especial: false })}
        onSaved={() => void load()}
      />

      {/* Modal Editar Unidade · NewUnitModal busca via GET /properties/:id quando editId presente */}
      {editUnit && (
        <NewUnitModal
          open={true}
          isEspecial={!!editUnit.isSpecial}
          editId={editUnit.id}
          onClose={() => setEditUnit(null)}
          onSaved={() => { setEditUnit(null); void load(); }}
        />
      )}

      {/* Modal Detalhe da Unidade · ficha completa */}
      <Modal
        open={!!detailUnit}
        onClose={() => setDetailUnit(null)}
        title={detailUnit ? `${detailUnit.code} · ${detailUnit.title}` : ""}
        size="lg"
      >
        {detailUnit && (
          <UnitDetailContent
            unit={detailUnit}
            onEdit={() => { const u = detailUnit; setDetailUnit(null); setEditUnit(u); }}
            onAdCard={() => setAdCardUnit(detailUnit)}
            onApprovePublic={() => { aprovar(detailUnit.id, "public"); setDetailUnit(null); }}
            onApprovePrivate={() => { aprovar(detailUnit.id, "private"); setDetailUnit(null); }}
            onDeny={() => { negar(detailUnit.id); setDetailUnit(null); }}
          />
        )}
      </Modal>

      {adCardUnit && <PropertyAdCard property={adCardUnit} onClose={() => setAdCardUnit(null)} />}
    </div>
  );
}

// Conteúdo do modal · ficha técnica + ações admin (editar/aprovar/negar/cascata)
function UnitDetailContent({ unit, onEdit, onAdCard, onApprovePublic, onApprovePrivate, onDeny }: {
  unit: Property;
  onEdit: () => void;
  onAdCard: () => void;
  onApprovePublic: () => void;
  onApprovePrivate: () => void;
  onDeny: () => void;
}) {
  const sub = unit._meta?.submission;
  const st = sub?.status;
  const cover = resolveBackendUrl(unit.coverImageUrl ?? unit.media?.[0]?.url ?? "") || null;
  const cidade = [unit.neighborhood, unit.city, unit.state].filter(Boolean).join(", ");
  const extra = unit.media && unit.media.length > 1 ? unit.media.slice(0, 7) : [];
  return (
    <div className="space-y-4">
      {cover && (
        <div className="aspect-[16/10] bg-app-subtle/60 rounded overflow-hidden border hairline">
          <img src={cover} alt={unit.title} className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}

      <button onClick={onAdCard} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-gold-400/15 border border-gold-400/40 text-gold-300 hover:bg-gold-400/25 text-sm font-medium">
        Gerar anúncio (imagem)
      </button>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <InfoTile label="Valor" value={fmtBRL(unit.value)} />
        {unit.priceCash != null && <InfoTile label="À vista (com desconto)" value={fmtBRL(unit.priceCash)} highlight />}
        <InfoTile label="Comissão" value={unit.commission ?? "—"} highlight />
        <InfoTile label="Tipo" value={unit.propertyType ?? "—"} />
        <InfoTile label="Status" value={STATUS_LABEL[unit.status ?? ""] ?? (unit.status ?? "—")} />
        {unit.bedrooms != null && <InfoTile label="Quartos" value={String(unit.bedrooms)} />}
        {unit.suites != null && <InfoTile label="Suítes" value={String(unit.suites)} />}
        {unit.garages != null && <InfoTile label="Garagens" value={String(unit.garages)} />}
        {unit.area != null && <InfoTile label="Área" value={`${unit.area} m²`} />}
      </div>

      {cidade && (
        <div>
          <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50 mb-1">Localização</p>
          <p className="text-sand-50 inline-flex items-center gap-1.5"><MapPin size={14} className="text-gold-400" /> {cidade}</p>
        </div>
      )}

      {unit.description && (
        <div>
          <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50 mb-1">Descrição</p>
          <p className="text-sm text-sand-100/85 whitespace-pre-wrap leading-relaxed">{unit.description}</p>
        </div>
      )}

      {unit.features && unit.features.length > 0 && (
        <div>
          <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50 mb-2">Diferenciais</p>
          <div className="flex flex-wrap gap-1.5">
            {unit.features.map((f) => (
              <span key={f} className="text-xs px-2 py-1 rounded-full bg-gold-400/10 border border-gold-400/25 text-gold-300">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {extra.length > 0 && (
        <div>
          <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50 mb-2">Galeria ({unit.media?.length ?? 0} mídias)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {extra.map((m, i) => (
              <a key={i} href={resolveBackendUrl(m.url)} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded bg-app-subtle/60 border hairline">
                <img src={resolveBackendUrl(m.url)} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      )}

      {(unit.unitNumber || unit.createdAt) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-sand-100/55">
          {unit.unitNumber && <span>Unidade: <strong className="text-gold-300 font-mono">{unit.unitNumber}</strong></span>}
          {unit.createdAt && <span>Cadastrado: {fmtDate(unit.createdAt)}</span>}
        </div>
      )}

      {sub?.denialReason && (
        <div className="text-xs bg-red-500/10 border border-red-500/30 text-red-200 rounded p-2">
          <strong>Motivo de negação:</strong> {sub.denialReason}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-3 border-t hairline">
        <Button variant="outline" onClick={onEdit}>Editar imóvel</Button>
        {(st === "PENDING" || st === "DENIED") && (
          <>
            <Button variant="gold" onClick={onApprovePublic}>Aprovar pra todos</Button>
            {sub?.submittedByName && (
              <Button variant="outline" onClick={onApprovePrivate}>
                Aprovar só pra {sub.submittedByName}
              </Button>
            )}
            <Button variant="danger" onClick={onDeny}>Negar</Button>
          </>
        )}
      </div>
    </div>
  );
}

function InfoTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50">{label}</p>
      <p className={`font-semibold ${highlight ? "text-gold-400" : "text-sand-50"}`}>{value}</p>
    </div>
  );
}

function TabBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-xs uppercase tracking-mono-xwide font-semibold border-b-2 transition-colors inline-flex items-center whitespace-nowrap ${
        active ? "text-sand-50 border-gold-400" : "text-sand-100/55 hover:text-sand-50 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

// =====================================================================
// Card de Empreendimento (porte fiel de renderDevelopmentsGrid)
// =====================================================================

function DevsGrid({ devs, units }: { devs: Development[]; units: Property[] }) {
  if (!devs.length) {
    return (
      <div className="card p-8 text-center">
        <div className="inline-flex h-14 w-14 rounded-full bg-gold-400/10 text-gold-400 items-center justify-center mb-3">
          <Building size={26} />
        </div>
        <p className="text-sand-50 font-semibold text-lg mb-1">Nenhum empreendimento cadastrado</p>
        <p className="text-sand-100/60 text-sm mb-4">Cadastre o primeiro empreendimento para agrupar várias unidades embaixo dele.</p>
      </div>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4">
      {devs.map((d) => (
        <DevCard key={d.id} dev={d} units={units.filter((u) => u.developmentId === d.id)} />
      ))}
    </div>
  );
}

function DevCard({ dev: d, units }: { dev: Development; units: Property[] }) {
  const tips = (d.tipologias ?? []).filter((t) => t && (t.valorAvista != null || t.suites != null || t.label));
  const vPermParc = d.valorPermutaParcelado != null
    ? fmtBRL(d.valorPermutaParcelado)
    : (d.acceptsPermuta || d.acceptsParcelado ? "Aceita" : "—");
  const agg = d.agg ?? { available: 0, sold: 0 };
  const unidadesCount = d._count?.units ?? units.length ?? 0;
  const lazer = (d.leisureFeatures ?? []).slice(0, 3).join(" · ");
  const cidade = [d.neighborhood, d.city ? `${d.city}/${d.state ?? ""}` : null].filter(Boolean).join(" · ");

  // Agrupa unidades por nº de suítes (mais suítes primeiro)
  const bySuites = new Map<number, Property[]>();
  for (const u of units) {
    const k = u.suites ?? 0;
    if (!bySuites.has(k)) bySuites.set(k, []);
    bySuites.get(k)!.push(u);
  }
  const grupos = [...bySuites.entries()].sort((a, b) => b[0] - a[0]);

  return (
    <article className="card overflow-hidden flex flex-col hover:border-gold-400/50 transition-all p-0">
      {/* CAPA · imagem com overlays */}
      <div className="relative w-full h-44 bg-gradient-to-br from-app-subtle to-app-bg overflow-hidden">
        {d.coverImageUrl ? (
          <img
            src={resolveBackendUrl(d.coverImageUrl)}
            alt={d.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sand-100/30">
            <Building size={48} />
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.3) 50%, transparent 100%)" }} />

        {/* Top row · code (esq) + status (dir) */}
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
          <p
            className="text-[0.6rem] uppercase tracking-mono-label font-bold text-gold-300/95 px-2 py-1 rounded"
            style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(4px)" }}
          >
            {d.code}
          </p>
          <StatusPill tone={STATUS_TONE[d.status ?? "ACTIVE"] ?? "neutral"} size="sm">
            {STATUS_LABEL[d.status ?? "ACTIVE"] ?? d.status}
          </StatusPill>
        </div>

        {/* Vídeo badge */}
        {d.videoUrl && (
          <a
            href={d.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute top-12 right-3 inline-flex items-center gap-1 text-[0.6rem] uppercase font-bold tracking-mono-wide px-2 py-1 rounded text-white"
            style={{ background: "rgba(220,38,38,.85)", backdropFilter: "blur(4px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <Play size={11} /> Vídeo
          </a>
        )}

        {/* Bottom · título + localização sobre a imagem · cor SEMPRE clara (mesmo em
            modo light) porque o fundo é a foto escurecida do imóvel. */}
        <div className="absolute bottom-3 left-3 right-3">
          <h3
            className="font-extrabold text-xl tracking-[-0.02em] leading-tight truncate"
            style={{ color: "#FBF7EE", textShadow: "0 1px 3px rgba(0,0,0,.45)" }}
          >{d.name}</h3>
          {cidade && (
            <p
              className="text-xs mt-1 truncate inline-flex items-center gap-1"
              style={{ color: "rgba(251,247,238,.85)", textShadow: "0 1px 2px rgba(0,0,0,.4)" }}
            >
              <MapPin size={11} /> {cidade}
            </p>
          )}
        </div>
      </div>

      {/* Bloco · tipologias / permuta / disponíveis · comissão */}
      <div className="bg-app-subtle/30 border-b hairline">
        {tips.length > 0 ? (
          <div className={`px-4 py-3 grid gap-2 ${tips.length === 1 ? "grid-cols-1" : tips.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {tips.map((t, i) => (
              <div key={i} className="text-center">
                <p className="text-[0.58rem] uppercase tracking-mono-label font-semibold text-gold-300/85 mb-1">
                  {t.label ?? (t.suites != null ? `${t.suites} suíte${t.suites === 1 ? "" : "s"}` : "Tipologia")}
                </p>
                <p className="text-[0.55rem] uppercase tracking-mono-wide text-sand-100/55">À vista</p>
                <p className="text-sm font-bold text-sand-50 tabular-nums leading-tight">
                  {t.valorAvista != null ? fmtBRL(t.valorAvista) : "—"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-3 text-center">
            <p className="text-[0.6rem] uppercase tracking-mono-label text-sand-100/45 italic">Tipologias não cadastradas</p>
          </div>
        )}

        <div className="px-4 py-2 border-t hairline text-center">
          <p className="text-[0.55rem] uppercase tracking-mono-label font-semibold text-sand-100/55 mb-0.5">Permuta / Parcelado</p>
          <p className="text-base font-bold text-sand-50 tabular-nums leading-none">{vPermParc}</p>
        </div>

        <div className="grid grid-cols-2 gap-1 px-3 pb-3 pt-2 border-t hairline">
          <div className="text-center">
            <p className="text-[0.55rem] uppercase tracking-mono-label font-semibold text-sand-100/55 mb-1">Disponíveis</p>
            <p className="text-lg font-extrabold text-emerald-300 tabular-nums leading-none">
              {agg.available ?? 0}
              {agg.sold && agg.sold > 0 ? (
                <span className="text-[0.6rem] text-sand-100/45 font-medium ml-1">· {agg.sold} vendidas</span>
              ) : null}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[0.55rem] uppercase tracking-mono-label font-semibold text-gold-400/80 mb-1">Comissão</p>
            <p className="text-lg font-extrabold text-gold-300 tabular-nums leading-none">{d.commissionDefault ?? "—"}</p>
          </div>
        </div>
      </div>

      {/* Metadata · entrega + total + features */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-sand-100/45 uppercase tracking-mono-wide text-[0.58rem] mb-0.5">Entrega</p>
            <p className="text-sand-50 font-semibold">{fmtDate(d.deliveryDate)}</p>
          </div>
          <div>
            <p className="text-sand-100/45 uppercase tracking-mono-wide text-[0.58rem] mb-0.5">Total</p>
            <p className="text-sand-50 font-semibold">
              {unidadesCount}{d.totalUnits ? ` / ${d.totalUnits}` : ""} unid.
            </p>
          </div>
        </div>

        {lazer && (
          <p className="text-[0.7rem] text-sand-100/65 leading-relaxed inline-flex items-start gap-1.5">
            <Sparkles size={12} className="text-gold-400 mt-0.5 shrink-0" />
            <span>{lazer}</span>
          </p>
        )}

        {/* Pasta de unidades */}
        <details className="border-t hairline pt-3 mt-auto group">
          <summary className="cursor-pointer list-none text-[0.72rem] uppercase tracking-mono-wide font-bold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1.5 select-none">
            <Folder size={13} className="transition-transform group-open:rotate-12" />
            Abrir pasta · {unidadesCount} {unidadesCount === 1 ? "unidade" : "unidades"}
          </summary>
          <div className="mt-3 space-y-3">
            {grupos.length === 0 ? (
              <p className="text-xs text-sand-100/55 italic">Nenhuma unidade.</p>
            ) : grupos.map(([suites, list]) => (
              <div key={suites}>
                <p className="text-[0.62rem] uppercase tracking-mono-xwide font-bold text-sand-100/60 mb-1.5 flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-gold-400/15 text-gold-300 text-[0.6rem] font-bold">
                    {suites || "?"}
                  </span>
                  {suites > 0 ? `${suites} suíte${suites === 1 ? "" : "s"}` : "Sem indicação de suítes"} · {list.length} {list.length === 1 ? "unidade" : "unidades"}
                </p>
                <div className="flex flex-col gap-1">
                  {list.map((u) => {
                    const isSold = String(u.status || "").toUpperCase().includes("SOLD") || u.status === "SOLD";
                    return (
                      <div key={u.id} className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded bg-app-subtle/40 hover:bg-app-subtle/70 transition-colors relative ${isSold ? "opacity-60" : ""}`}>
                        <span className="text-gold-400 font-mono text-[0.62rem] tabular-nums shrink-0">{u.code ?? "—"}</span>
                        <span className={`flex-1 truncate text-sand-50 ${isSold ? "line-through" : ""}`}>{u.title ?? "—"}</span>
                        <StatusPill tone={isSold ? "danger" : u.status === "RESERVED" ? "warning" : "success"}>
                          {u.status === "AVAILABLE" ? "Disp" : u.status === "RESERVED" ? "Res" : u.status === "SOLD" ? "Vend" : u.status}
                        </StatusPill>
                        <span className="text-sand-100/70 tabular-nums shrink-0 text-[0.7rem]">{fmtBRL(u.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* Footer · editar capa | + unidade */}
      <div className="grid grid-cols-2 gap-0 border-t hairline">
        <button
          className="py-3 text-[0.72rem] uppercase tracking-mono-wide font-bold text-gold-300 hover:bg-gold-400/10 transition-colors inline-flex items-center justify-center gap-1.5"
          onClick={() => alert(`Editar capa · em construção · dev ${d.code}`)}
        >
          Editar capa
        </button>
        <button
          className="py-3 text-[0.72rem] uppercase tracking-mono-wide font-bold text-gold-300 hover:bg-gold-400/10 transition-colors border-l hairline inline-flex items-center justify-center gap-1.5"
          onClick={() => alert(`Adicionar unidade · em construção · dev ${d.code}`)}
        >
          + Unidade
        </button>
      </div>
    </article>
  );
}

// =====================================================================
// Card de Unidade (tab "Todas" e "Enviados")
// =====================================================================

function UnitCard({ p, onClick, onApprovePublic, onApprovePrivate, onDeny }: {
  p: Property;
  onClick?: () => void;
  onApprovePublic: () => void;
  onApprovePrivate: () => void;
  onDeny: () => void;
}) {
  const sub = p._meta?.submission;
  const st = sub?.status;
  const isPending = st === "PENDING";
  const isDenied = st === "DENIED";
  const cover = resolveBackendUrl(p.coverImageUrl ?? p.media?.[0]?.url ?? "") || null;
  const cidade = [p.neighborhood, p.city, p.state].filter(Boolean).join(", ");
  return (
    <article
      className={`card overflow-hidden flex flex-col ${onClick ? "cursor-pointer hover:border-gold-400/50 transition-colors" : ""}`}
      onClick={onClick}
    >
      <div className="aspect-[16/10] bg-app-subtle/60 relative overflow-hidden">
        {cover ? (
          <img
            src={cover} alt={p.title}
            loading="lazy" decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gold-400/35">
            <span className="text-5xl font-display">{p.title?.[0] ?? "—"}</span>
          </div>
        )}
        <span className="absolute top-2 left-2 text-[0.6rem] uppercase tracking-mono-xwide font-bold px-1.5 py-0.5 rounded bg-app-elevated/85 backdrop-blur text-gold-300">
          {p.code}
        </span>
        <div className="absolute top-2 right-2 flex items-center gap-1.5 flex-wrap">
          {st === "PENDING" && <StatusPill tone="warning">Pendente</StatusPill>}
          {st === "DENIED" && <StatusPill tone="danger">Negado</StatusPill>}
          {st === "APPROVED_PRIVATE" && <StatusPill tone="info">Exclusivo</StatusPill>}
          {p.isSpecial && <StatusPill tone="gold">Especial</StatusPill>}
          {p.status === "RESERVED" && <StatusPill tone="warning">Reservado</StatusPill>}
          {p.status === "SOLD" && <StatusPill tone="danger">Vendido</StatusPill>}
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col">
        <h3 className="text-lg font-bold tracking-[-0.015em] leading-tight">{p.title}</h3>
        <p className="text-xs text-sand-100/70 mt-1">{cidade || "—"}</p>
        {sub?.submittedByName && (
          <p className="text-[0.68rem] text-sand-100/55 mt-2">
            Enviado por: <strong className="text-sand-100/85">{sub.submittedByName}</strong>
          </p>
        )}
        <div className="divider-gold my-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-sand-100/55">Valor</p>
            <p className="font-medium">{fmtBRL(p.value)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-sand-100/55">Comissão</p>
            <p className="text-gold-400 font-medium">{p.commission ?? "—"}</p>
          </div>
        </div>
        {(p.bedrooms || p.area) && (
          <p className="mt-2 text-[0.7rem] text-sand-100/55">
            {p.propertyType ?? ""}
            {p.bedrooms ? ` · ${p.bedrooms} qto${p.bedrooms === 1 ? "" : "s"}` : ""}
            {p.area ? ` · ${p.area}m²` : ""}
          </p>
        )}
        {isDenied && sub?.denialReason && (
          <div className="mt-3 text-[0.68rem] bg-red-500/10 border border-red-500/30 text-red-200 rounded p-2">
            <strong>Motivo:</strong> {sub.denialReason}
          </div>
        )}
        {(isPending || isDenied) && (
          <div className="grid gap-2 mt-3 pt-3 border-t hairline" onClick={(e) => e.stopPropagation()}>
            <Button variant="gold" onClick={onApprovePublic} style={{ padding: ".5rem .6rem", fontSize: ".7rem" }}>Aprovar pra todos</Button>
            {sub?.submittedByName && (
              <Button variant="outline" onClick={onApprovePrivate} style={{ padding: ".5rem .6rem", fontSize: ".7rem" }}>
                Aprovar só pra {sub.submittedByName}
              </Button>
            )}
            <Button variant="danger" onClick={onDeny} style={{ padding: ".5rem .6rem", fontSize: ".7rem" }}>Negar</Button>
          </div>
        )}
      </div>
    </article>
  );
}
