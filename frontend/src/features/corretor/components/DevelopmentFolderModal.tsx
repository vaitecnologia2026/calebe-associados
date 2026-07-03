// Pasta do empreendimento (corretor) · porte FIEL ao monólito (linhas 19390-19465)
// Mostra cover, vídeo, descrição, bairro/entrega/comissão, mapa e unidades agrupadas por suítes
// Cada unidade tem botões Simular + Link

import { useEffect, useMemo, useState } from "react";
import { X, Play, Map as MapIcon, Calculator, Link as LinkIcon } from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import type { Development, Property } from "@/types/property";
import { SimuladorModal } from "./SimuladorModal";
import { LpLinkModal } from "./LpLinkModal";

interface Props {
  open: boolean;
  onClose: () => void;
  development: Development | null;
}

function stripDwv(s?: string): string {
  return (s ?? "").replace(/\s*\[DWV[^\]]*\]\s*/gi, "").trim();
}

function hideDwvCode(s?: string): string {
  const v = (s ?? "").trim();
  if (/^DWV[-_]/i.test(v) || /^[a-f0-9]{8,}$/i.test(v)) return "";
  return v;
}

function fmtBRLValue(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function DevelopmentFolderModal({ open, onClose, development }: Props) {
  const d = development;
  const [units, setUnits] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [simUnit, setSimUnit] = useState<Property | null>(null);
  const [linkUnit, setLinkUnit] = useState<Property | null>(null);

  // ESC fecha
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  // Carrega unidades do empreendimento
  useEffect(() => {
    if (!open || !d?.id) { setUnits([]); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await api.get<{ data: Property[] }>(
          `/api/properties?developmentId=${encodeURIComponent(d.id)}&limit=500`
        );
        if (!alive) return;
        const list = (r.data ?? []).filter((u) => u.status === "AVAILABLE" || u.status === "RESERVED");
        setUnits(list);
      } catch { if (alive) setUnits([]); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open, d?.id]);

  // Agrupa por suítes (decrescente) · monólito 19396
  const grupos = useMemo(() => {
    const map = new Map<number, Property[]>();
    for (const u of units) {
      const k = u.suites ?? 0;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(u);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [units]);

  if (!open || !d) return null;

  const name = stripDwv(d.name);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/90 backdrop-blur-md p-0 md:p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="w-full max-w-3xl bg-app-elevated border hairline rounded-none md:rounded-[6px] my-0 md:my-6 relative flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="px-5 md:px-7 py-5 border-b hairline flex items-center justify-between sticky top-0 bg-app-elevated z-10">
            <h2 className="text-xl font-bold tracking-display-tight">{name}</h2>
            <button
              onClick={onClose}
              className="h-10 w-10 inline-flex items-center justify-center text-sand-100/60 hover:text-sand-50 hover:bg-white/5 rounded-[4px]"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </header>

          <div className="flex-1 p-5 md:p-7 space-y-4">
            {d.coverImageUrl && (
              <img src={resolveBackendUrl(d.coverImageUrl)} alt={name} className="w-full h-48 object-cover rounded-[4px]" />
            )}
            {d.videoUrl && (
              <a
                href={resolveBackendUrl(d.videoUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 btn-base text-xs no-underline"
                style={{ padding: ".45rem .9rem", background: "rgba(220,38,38,.85)", color: "#fff", border: 0 }}
              >
                <Play size={13} /> Assistir vídeo do empreendimento
              </a>
            )}
            {d.description && (
              <p className="text-sm text-sand-100/80 leading-relaxed">{d.description}</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 bg-app-subtle/30 rounded-[4px]">
              <Cell label="Bairro" value={d.neighborhood ?? "—"} />
              <div className="text-center border-x hairline">
                <p className="text-[0.6rem] uppercase tracking-mono-wide text-sand-100/55">Entrega</p>
                <p className="text-sm font-semibold mt-1">{fmtDate(d.deliveryDate)}</p>
              </div>
              <div className="text-center">
                <p className="text-[0.6rem] uppercase tracking-mono-wide text-gold-400/80">Comissão</p>
                <p className="text-base font-bold text-gold-300 mt-0.5">{d.commissionDefault || "—"}</p>
              </div>
            </div>

            {d.latitude != null && d.longitude != null && (
              <a
                className="btn-base btn-outline inline-flex items-center gap-1.5 text-xs"
                style={{ padding: ".45rem .9rem" }}
                href={`https://maps.google.com/?q=${d.latitude},${d.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MapIcon size={13} /> Ver no mapa
              </a>
            )}

            <div className="space-y-4 pt-3 border-t hairline">
              {loading ? (
                <p className="text-sm italic text-sand-100/55">Carregando unidades…</p>
              ) : grupos.length === 0 ? (
                <p className="text-sm italic text-sand-100/55">Nenhuma unidade disponível agora.</p>
              ) : (
                grupos.map(([suites, lista]) => (
                  <div key={suites}>
                    <p className="text-[0.7rem] uppercase tracking-mono-xwide font-bold text-sand-100/65 mb-2 flex items-center gap-2">
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gold-400/15 text-gold-300 text-xs font-bold">
                        {suites || "?"}
                      </span>
                      {suites > 0 ? `${suites} suíte${suites === 1 ? "" : "s"}` : "Outras unidades"} ·{" "}
                      {lista.length} disponíve{lista.length === 1 ? "l" : "is"}
                    </p>
                    <div className="space-y-2">
                      {lista.map((u) => {
                        const codigoLimpo = hideDwvCode(u.code);
                        const titulo = stripDwv(u.title);
                        return (
                          <div key={u.id} className="card p-3 flex flex-wrap items-center gap-3">
                            <div className="flex-1 min-w-0">
                              {codigoLimpo && (
                                <p className="text-xs text-sand-100/55 font-mono">{codigoLimpo}</p>
                              )}
                              <p className="font-semibold text-sand-50 truncate">{titulo}</p>
                              <p className="text-sm text-sand-100/75 mt-0.5">{fmtBRLValue(u.value)}</p>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                className="btn-base btn-gold text-xs inline-flex items-center gap-1.5"
                                style={{ padding: ".45rem .9rem" }}
                                onClick={() => setSimUnit(u)}
                              >
                                <Calculator size={13} /> Simular
                              </button>
                              <button
                                className="btn-base btn-outline text-xs inline-flex items-center gap-1.5"
                                style={{ padding: ".45rem .9rem" }}
                                onClick={() => setLinkUnit(u)}
                              >
                                <LinkIcon size={13} /> Link
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modais empilhados */}
      <SimuladorModal
        open={!!simUnit}
        onClose={() => setSimUnit(null)}
        propertyName={simUnit ? stripDwv(simUnit.title) : ""}
        devName={d.name}
        valorInicial={simUnit ? Number(String(simUnit.value).replace(/[^\d.,-]/g, "").replace(",", ".")) : null}
      />
      <LpLinkModal
        open={!!linkUnit}
        onClose={() => setLinkUnit(null)}
        imovelCodigo={linkUnit?.code ?? ""}
        imovelTitulo={linkUnit ? stripDwv(linkUnit.title) : undefined}
      />
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[0.6rem] uppercase tracking-mono-wide text-sand-100/55">{label}</p>
      <p className="text-sm font-semibold mt-1">{value}</p>
    </div>
  );
}
