// Imóveis do corretor · porte FIEL ao monólito (cors-imoveis · linhas 3133-3173)
//
// Estrutura:
//  - Card "Corretor Calebe · WhatsApp" (atendimento direto)
//  - Section "Exclusivos Calebe" + "Outros empreendimentos do mercado"
//    Cards de empreendimento com cover + tipologias + permuta/parcelado + disponíveis + comissão
//  - Section "Unidades disponíveis" (catálogo de propriedades)

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown, BookOpen, FileCheck2, Link as LinkIcon, Target as TargetIcon,
  MapPin, Building2, Play, Building, SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import { useUi } from "@/store/ui";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import type { Property, Development, Tipologia } from "@/types/property";
import { DevelopmentFolderModal } from "../components/DevelopmentFolderModal";
import { SimuladorModal } from "../components/SimuladorModal";
import { LpLinkModal } from "../components/LpLinkModal";
import { NovaVendaModal } from "../components/NovaVendaModal";
import { Modal } from "@/components/ui/Modal";

function fmtBRL(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtBRLValue(v?: string | number | null) { return fmtBRL(v); }

function stripDwv(name?: string): string {
  return (name ?? "").replace(/\s*\[DWV[^\]]*\]\s*/gi, "").trim();
}

function tipoLabel(t: Tipologia): string {
  if ((t as any).label) return (t as any).label;
  if ((t as any).suites != null) {
    const s = (t as any).suites;
    return `${s} suíte${s === 1 ? "" : "s"}`;
  }
  return "Tipologia";
}

export function CorretorImoveis() {
  const [list, setList] = useState<Property[]>([]);
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [q, setQ] = useState("");
  const [fCidade, setFCidade] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fDorm, setFDorm] = useState<number | null>(null);
  const [fSuite, setFSuite] = useState<number | null>(null);
  const [fPreco, setFPreco] = useState("");
  const [rendered, setRendered] = useState(60);
  const [folderDev, setFolderDev] = useState<Development | null>(null);
  const [simUnit, setSimUnit] = useState<Property | null>(null);
  const [linkUnit, setLinkUnit] = useState<Property | null>(null);
  const [detailUnit, setDetailUnit] = useState<Property | null>(null);
  const [vendaUnit, setVendaUnit] = useState<Property | null>(null);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    (async () => {
      try {
        const [propsRes, devsRes] = await Promise.all([
          api.get<{ data: Property[] }>("/api/properties?limit=200"),
          api.get<{ data: Development[] }>("/api/developments?limit=5000"),
        ]);
        setList(propsRes.data ?? []);
        setDevelopments(devsRes.data ?? []);
      } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    })();
  }, [showToast]);

  const base = useMemo(() => list.filter((i) => i.status === "AVAILABLE" || i.status === "RESERVED"), [list]);
  const cidades = useMemo(() => Array.from(new Set(base.map((i) => i.city).filter(Boolean))).sort() as string[], [base]);
  const tipos = useMemo(() => Array.from(new Set(base.map((i) => i.propertyType).filter(Boolean))).sort() as string[], [base]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const priceNum = (v: any) => { const n = Number(String(v ?? "").replace(/[^\d.,-]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
    return base.filter((i) => {
      if (t && !`${i.code} ${i.title} ${i.city ?? ""} ${i.neighborhood ?? ""}`.toLowerCase().includes(t)) return false;
      if (fCidade && i.city !== fCidade) return false;
      if (fTipo && i.propertyType !== fTipo) return false;
      if (fDorm != null) { const b = i.bedrooms ?? 0; if (fDorm === 4 ? b < 4 : b !== fDorm) return false; }
      if (fSuite != null) { const s = i.suites ?? 0; if (fSuite === 3 ? s < 3 : s !== fSuite) return false; }
      if (fPreco) { const p = priceNum(i.value); const [lo, hi] = fPreco.split("-").map(Number); if (hi ? (p < lo || p >= hi) : p < lo) return false; }
      return true;
    });
  }, [base, q, fCidade, fTipo, fDorm, fSuite, fPreco]);

  const hasFilters = !!(q || fCidade || fTipo || fDorm != null || fSuite != null || fPreco);
  function clearFilters() { setQ(""); setFCidade(""); setFTipo(""); setFDorm(null); setFSuite(null); setFPreco(""); setRendered(60); }

  const visible = filtered.slice(0, rendered);
  const remaining = filtered.length - visible.length;

  // Separa empreendimentos · Calebe (sem dwvId) vs Mercado (DWV)
  const { exclusivos, mercado } = useMemo(() => {
    const ok = developments.filter((d) => d.status !== "SUSPENDED");
    const exc = ok.filter((d) => !d.dwvId).sort((a, b) => a.name.localeCompare(b.name));
    const mer = ok.filter((d) => !!d.dwvId).sort((a, b) => a.name.localeCompare(b.name));
    return { exclusivos: exc, mercado: mer };
  }, [developments]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header · monólito linha 3134 */}
      <header className="mb-5">
        <p className="meta-gold mb-1">Portfólio</p>
        <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight">Imóveis disponíveis</h1>
        <p className="text-sm text-sand-100/65 mt-1.5">
          Filtre por perfil, gere a LP e compartilhe · cada acesso é auditado por imóvel, corretor e campanha.
        </p>
      </header>

      {/* 2026-06-03 · bloco "Atendimento · Corretor Calebe · WhatsApp" removido a pedido */}

      {/* ===== Filtros por perfil · DESTAQUE dourado, no topo ===== */}
      <div
        className="p-4 md:p-5 mb-7 rounded-xl"
        style={{
          background: "linear-gradient(180deg, rgba(212,168,83,.12), rgba(212,168,83,.03))",
          border: "1px solid rgba(212,168,83,.34)",
          boxShadow: "0 8px 28px rgba(0,0,0,.22)",
        }}
      >
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-bold inline-flex items-center gap-1.5" style={{ color: "#E8CE96" }}>
            <SlidersHorizontal size={14} /> Filtrar por perfil
          </p>
          <span className="text-xs font-bold tabular-nums" style={{ color: "#E8CE96" }}>
            {filtered.length} {filtered.length === 1 ? "imóvel" : "imóveis"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2.5 items-center">
          <input
            type="text"
            placeholder="Buscar por código, título, bairro…"
            className="field-input text-sm py-2"
            style={{ flex: "1 1 220px", minWidth: 160 }}
            value={q}
            onChange={(e) => { setQ(e.target.value); setRendered(60); }}
          />
          <select className="field-input text-sm py-2" style={{ minWidth: 138 }} value={fCidade} onChange={(e) => { setFCidade(e.target.value); setRendered(60); }}>
            <option value="">Cidade · todas</option>
            {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="field-input text-sm py-2" style={{ minWidth: 128 }} value={fTipo} onChange={(e) => { setFTipo(e.target.value); setRendered(60); }}>
            <option value="">Tipo · todos</option>
            {tipos.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
          </select>
          <select className="field-input text-sm py-2" style={{ minWidth: 160 }} value={fPreco} onChange={(e) => { setFPreco(e.target.value); setRendered(60); }}>
            <option value="">Preço · qualquer</option>
            <option value="0-500000">Até R$ 500 mil</option>
            <option value="500000-1000000">R$ 500 mil a 1 mi</option>
            <option value="1000000-2000000">R$ 1 mi a 2 mi</option>
            <option value="2000000">Acima de R$ 2 mi</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center mt-3">
          <span className="text-[0.7rem] uppercase tracking-mono-wide text-sand-100/55">Dormitórios</span>
          {[1, 2, 3, 4].map((n) => (
            <FilterChip key={"d" + n} active={fDorm === n} onClick={() => { setFDorm(fDorm === n ? null : n); setRendered(60); }}>
              {n === 4 ? "4+" : String(n)}
            </FilterChip>
          ))}
          <span className="text-[0.7rem] uppercase tracking-mono-wide text-sand-100/55 ml-3">Suítes</span>
          {[1, 2, 3].map((n) => (
            <FilterChip key={"s" + n} active={fSuite === n} onClick={() => { setFSuite(fSuite === n ? null : n); setRendered(60); }}>
              {n === 3 ? "3+" : String(n)}
            </FilterChip>
          ))}
          {hasFilters && (
            <button onClick={clearFilters} className="text-[0.72rem] font-semibold text-gold-300 hover:text-gold-200 ml-1">
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* ===== Unidades disponíveis (resultados do filtro) ===== */}
      <section>
        <p className="text-[0.66rem] uppercase tracking-mono-xwide font-bold text-gold-400/80 mb-3 inline-flex items-center gap-1.5">
          <Building size={12} /> Unidades disponíveis
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((i) => {
            const sub = i._meta?.submission;
            const isPending = sub?.status === "PENDING";
            const isDenied = sub?.status === "DENIED";
            const cover = resolveBackendUrl(i.coverImageUrl ?? i.media?.[0]?.url ?? "") || null;
            const cidade = [i.neighborhood, i.city].filter(Boolean).join(", ");
            return (
              <article key={i.id} className={`card overflow-hidden flex flex-col ${isPending || isDenied ? "opacity-80" : ""}`}>
                <div className="aspect-[16/10] bg-app-subtle/60 relative overflow-hidden">
                  {cover ? (
                    <img
                      src={cover}
                      alt={i.title}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-5xl font-display text-gold-400/35">{i.title?.[0] ?? "—"}</span>
                    </div>
                  )}
                  <span className="absolute top-2 left-2 text-[0.6rem] uppercase tracking-mono-xwide font-bold px-1.5 py-0.5 rounded bg-app-elevated/85 backdrop-blur text-gold-300">
                    {i.code}
                  </span>
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 flex-wrap">
                    {isPending && <StatusPill tone="warning">Pendente</StatusPill>}
                    {isDenied && <StatusPill tone="danger">Negado</StatusPill>}
                    {sub?.status === "APPROVED_PRIVATE" && <StatusPill tone="info">Exclusivo</StatusPill>}
                    {i.status === "RESERVED" && <StatusPill tone="warning">Reservado</StatusPill>}
                    {i.isSpecial && <StatusPill tone="gold">Especial</StatusPill>}
                  </div>
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-base font-bold leading-snug">{i.title}</h3>
                  <p className="text-xs text-sand-100/60 mt-1">{cidade || "—"}</p>
                  {(i.bedrooms || i.suites || i.garages || i.area || i.propertyType) && (
                    <p className="text-[0.7rem] text-sand-100/55 mt-1">
                      {[
                        i.propertyType || null,
                        i.bedrooms ? `${i.bedrooms} qto${i.bedrooms === 1 ? "" : "s"}` : null,
                        i.suites ? `${i.suites} suíte${i.suites === 1 ? "" : "s"}` : null,
                        i.garages ? `${i.garages} vaga${i.garages === 1 ? "" : "s"}` : null,
                        i.area ? (/m/i.test(String(i.area)) ? String(i.area) : `${i.area} m²`) : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <div className="flex justify-between items-center mt-3 pt-3 border-t hairline text-sm">
                    <div>
                      <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50">Valor</p>
                      <p className="font-semibold">{fmtBRLValue(i.value)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50">Comissão</p>
                      <p className="text-gold-400 font-semibold">{i.commission ?? "—"}</p>
                    </div>
                  </div>

                  {isDenied && sub?.denialReason && (
                    <div className="mt-3 text-[0.68rem] bg-red-500/10 border border-red-500/30 text-red-200 rounded p-2">
                      <strong>Negado:</strong> {sub.denialReason}
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      style={{ padding: ".5rem .6rem", fontSize: ".7rem", flex: 1 }}
                      onClick={() => setSimUnit(i)}
                    >
                      <TargetIcon size={13} /> Simular
                    </Button>
                    {!isPending && !isDenied && (
                      <Button
                        variant="gold"
                        style={{ padding: ".5rem .6rem", fontSize: ".7rem", flex: 1 }}
                        onClick={() => setLinkUnit(i)}
                      >
                        <LinkIcon size={13} /> Link
                      </Button>
                    )}
                  </div>
                  {!isPending && !isDenied && (
                    <div className="flex gap-2 mt-2 pt-2 border-t border-gold-400/10">
                      <Button
                        variant="ghost"
                        style={{ padding: ".5rem .6rem", fontSize: ".68rem", flex: 1 }}
                        onClick={() => setDetailUnit(i)}
                      >
                        <BookOpen size={12} /> Detalhes
                      </Button>
                      <Button
                        variant="ghost"
                        style={{ padding: ".5rem .6rem", fontSize: ".68rem", flex: 1 }}
                        onClick={() => setVendaUnit(i)}
                      >
                        <FileCheck2 size={12} /> Venda
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
          {visible.length === 0 && (
            <div className="col-span-full p-8 text-center text-sand-100/55">
              Nenhum imóvel com esse perfil.{" "}
              {hasFilters && (
                <button onClick={clearFilters} className="text-gold-300 font-semibold hover:text-gold-200">Limpar filtros</button>
              )}
            </div>
          )}
        </div>

        {remaining > 0 && (
          <div className="mt-4 text-center">
            <button className="btn-base btn-outline text-xs" style={{ padding: ".6rem 1.2rem" }} onClick={() => setRendered(rendered + 60)}>
              <ChevronDown size={14} /> Carregar mais 60 ({remaining} restantes)
            </button>
          </div>
        )}
      </section>

      {/* ===== Empreendimentos · seção curada, abaixo do catálogo ===== */}
      {(exclusivos.length > 0 || mercado.length > 0) && (
        <section className="mt-10">
          <p className="text-[0.66rem] uppercase tracking-mono-xwide font-bold text-gold-400/80 mb-3 inline-flex items-center gap-1.5">
            <Building2 size={12} /> Empreendimentos
          </p>

          {exclusivos.length > 0 && (
            <>
              <SectionHeader label="Exclusivos Calebe" colorClass="text-gold-300" count={exclusivos.length} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {exclusivos.map((d) => <DevelopmentCard key={d.id} d={d} onOpen={() => setFolderDev(d)} />)}
              </div>
            </>
          )}

          {mercado.length > 0 && (
            <>
              <SectionHeader label="Outros empreendimentos do mercado" colorClass="text-sand-100/70" count={mercado.length} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {mercado.map((d) => <DevelopmentCard key={d.id} d={d} onOpen={() => setFolderDev(d)} />)}
              </div>
            </>
          )}
        </section>
      )}

      {/* Modal pasta do empreendimento */}
      <DevelopmentFolderModal
        open={!!folderDev}
        onClose={() => setFolderDev(null)}
        development={folderDev}
      />

      {/* Simulador para unidade do catálogo */}
      <SimuladorModal
        open={!!simUnit}
        onClose={() => setSimUnit(null)}
        propertyName={simUnit?.title ?? ""}
        valorInicial={simUnit ? Number(String(simUnit.value).replace(/[^\d.,-]/g, "").replace(",", ".")) : null}
      />

      {/* Link rastreado para unidade do catálogo */}
      <LpLinkModal
        open={!!linkUnit}
        onClose={() => setLinkUnit(null)}
        imovelCodigo={linkUnit?.code ?? ""}
        imovelTitulo={linkUnit?.title}
      />

      {/* Detalhes do imóvel — modal com ficha completa */}
      <Modal open={!!detailUnit} onClose={() => setDetailUnit(null)} title={detailUnit ? `${detailUnit.code} · ${detailUnit.title}` : ""} size="lg">
        {detailUnit && <UnitDetailContent unit={detailUnit} />}
      </Modal>

      {/* Registrar venda · prefill com o imóvel selecionado */}
      <NovaVendaModal
        open={!!vendaUnit}
        onClose={() => setVendaUnit(null)}
        onSaved={() => { setVendaUnit(null); showToast("Venda registrada — confira em /corretor/vendas"); }}
        prefillPropertyId={vendaUnit?.id ?? null}
      />
    </div>
  );
}

// =========================================================================
// Modal de detalhes da unidade · ficha técnica + cover + metadata
// =========================================================================
function UnitDetailContent({ unit }: { unit: Property }) {
  const cover = resolveBackendUrl(unit.coverImageUrl ?? unit.media?.[0]?.url ?? "") || null;
  const cidade = [unit.neighborhood, unit.city, unit.state].filter(Boolean).join(", ");
  return (
    <div className="space-y-4">
      {cover && (
        <div className="aspect-[16/10] bg-app-subtle/60 rounded overflow-hidden border hairline">
          <img src={cover} alt={unit.title} className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Info label="Valor" value={fmtBRLValue(unit.value)} />
        <Info label="Comissão" value={unit.commission ?? "—"} highlight />
        <Info label="Tipo" value={unit.propertyType ?? "—"} />
        <Info label="Status" value={statusLabel(unit.status)} />
        {unit.bedrooms != null && <Info label="Quartos" value={String(unit.bedrooms)} />}
        {unit.suites != null && <Info label="Suítes" value={String(unit.suites)} />}
        {unit.garages != null && <Info label="Garagens" value={String(unit.garages)} />}
        {unit.area != null && <Info label="Área" value={/m/i.test(String(unit.area)) ? String(unit.area) : `${unit.area} m²`} />}
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

      {unit.unitNumber && (
        <p className="text-xs text-sand-100/55">Unidade: <span className="font-mono text-gold-300">{unit.unitNumber}</span></p>
      )}
    </div>
  );
}

function Info({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[0.62rem] uppercase tracking-mono-xwide text-sand-100/50">{label}</p>
      <p className={`font-semibold ${highlight ? "text-gold-400" : "text-sand-50"}`}>{value}</p>
    </div>
  );
}

// Chip de filtro (toggle) · inline-styles porque a build não roda Tailwind JIT
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-bold rounded transition-colors tabular-nums"
      style={{
        padding: ".34rem .72rem",
        border: active ? "1px solid rgba(212,168,83,.65)" : "1px solid rgba(255,255,255,.12)",
        background: active ? "rgba(212,168,83,.16)" : "transparent",
        color: active ? "#E8CE96" : "rgba(245,240,230,.66)",
      }}
    >
      {children}
    </button>
  );
}

function statusLabel(s?: string): string {
  switch (s) {
    case "AVAILABLE": return "Disponível";
    case "RESERVED":  return "Reservado";
    case "SOLD":      return "Vendido";
    default:          return s ?? "—";
  }
}

// =========================================================================
// Section header · monólito linha 19370
// =========================================================================
interface SHProps { label: string; colorClass: string; count: number }
function SectionHeader({ label, colorClass, count }: SHProps) {
  return (
    <div className="mt-2 mb-3 flex items-center gap-3">
      <span className={`text-[0.7rem] uppercase tracking-mono-xwide font-bold ${colorClass}`}>{label}</span>
      <span className="text-[0.65rem] text-sand-100/55">
        {count} {count === 1 ? "empreendimento" : "empreendimentos"}
      </span>
      <div className="flex-1 border-t hairline" />
    </div>
  );
}

// =========================================================================
// Development card · porte FIEL monólito linha 19326
// =========================================================================
function DevelopmentCard({ d, onOpen }: { d: Development; onOpen?: () => void }) {
  const agg = d.agg ?? { available: 0, sold: 0 };
  const tips = Array.isArray(d.tipologias)
    ? d.tipologias.filter((t) => t && ((t as any).valorAvista != null || (t as any).suites != null || (t as any).label))
    : [];
  const vPermParc = d.valorPermutaParcelado != null
    ? fmtBRL(d.valorPermutaParcelado)
    : (d.acceptsPermuta || d.acceptsParcelado ? "Aceita" : "—");
  const comissao = d.commissionDefault || "—";
  const name = stripDwv(d.name);

  return (
    <button
      className="card overflow-hidden flex flex-col text-left hover:border-gold-400/50 transition-all"
      style={{ padding: 0 }}
      onClick={onOpen}
    >
      <div className="relative w-full h-40 sm:h-36 bg-gradient-to-br from-app-subtle to-app-canvas overflow-hidden">
        {d.coverImageUrl ? (
          <img
            src={resolveBackendUrl(d.coverImageUrl)}
            alt={name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sand-100/30">
            <Building size={42} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-2 left-3 right-3">
          {/* Texto sobre a foto · fica claro nos dois temas (fundo é a imagem escurecida) */}
          <h3
            className="font-extrabold text-base tracking-display-tight leading-tight truncate"
            style={{ color: "#FBF7EE", textShadow: "0 1px 3px rgba(0,0,0,.45)" }}
          >{name}</h3>
          <p
            className="text-[0.65rem] inline-flex items-center gap-1"
            style={{ color: "rgba(251,247,238,.85)", textShadow: "0 1px 2px rgba(0,0,0,.4)" }}
          >
            <MapPin size={10} /> {d.city ?? "—"}/{d.state ?? "—"}
          </p>
        </div>
        {d.videoUrl && (
          <span
            className="absolute top-2 right-2 inline-flex items-center gap-1 text-[0.55rem] uppercase font-bold tracking-mono-wide px-1.5 py-0.5 rounded-sm text-white"
            style={{ background: "rgba(220,38,38,.85)" }}
          >
            <Play size={10} /> Vídeo
          </span>
        )}
      </div>

      <div>
        {tips.length > 0 ? (
          <div className={`px-3 pt-3 pb-2 grid gap-2 ${tips.length === 1 ? "grid-cols-1" : tips.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {tips.map((t, i) => (
              <div key={i} className="text-center">
                <p className="text-[0.55rem] uppercase tracking-mono-wide font-semibold text-gold-300/85">{tipoLabel(t)}</p>
                <p className="text-[0.5rem] uppercase tracking-mono-wide text-sand-100/55 mt-0.5">À vista</p>
                <p className="text-xs font-semibold text-sand-50 leading-tight tabular-nums">
                  {(t as any).valorAvista != null ? fmtBRL((t as any).valorAvista) : "—"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 pt-3 pb-2 text-center">
            <p className="text-[0.55rem] uppercase tracking-mono-wide text-sand-100/45 italic">
              Tipologias não cadastradas
            </p>
          </div>
        )}

        <div className="px-3 py-1.5 border-t hairline text-center">
          <p className="text-[0.5rem] uppercase tracking-mono-wide text-sand-100/55">Permuta / Parcelado</p>
          <p className="text-xs font-semibold text-sand-50 tabular-nums leading-tight">{vPermParc}</p>
        </div>

        <div className="grid grid-cols-2 gap-1 px-3 pb-3 pt-1 border-t hairline text-center">
          <div>
            <p className="text-[0.55rem] uppercase tracking-mono-wide text-sand-100/55">Disponíveis</p>
            <p className="text-lg font-bold text-emerald-300 tabular-nums leading-tight">{agg.available ?? 0}</p>
          </div>
          <div>
            <p className="text-[0.55rem] uppercase tracking-mono-wide text-gold-400/80">Comissão</p>
            <p className="text-lg font-bold text-gold-300 tabular-nums leading-tight">{comissao}</p>
          </div>
        </div>
      </div>
    </button>
  );
}
