// Card de anúncio compartilhável do imóvel — gera imagem (html2canvas) pra
// o corretor mandar no WhatsApp/Instagram. 2026-07-01.
import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { X, Download, BedDouble, Bath, Car, Ruler } from "lucide-react";
import { resolveBackendUrl } from "@/lib/media";

const LOGO_URL = "https://d78txhfo8gp8r.cloudfront.net/calebe/arquivos/logo.png";
const brl = (v: any) => (v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));

export function PropertyAdCard({ property, onClose }: { property: any; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const p = property || {};
  const cover = resolveBackendUrl(p.coverImageUrl ?? p.media?.[0]?.url ?? "") || null;
  const cheio = p.priceList ?? p.value;
  const avista = p.priceCash;
  const temDesconto = avista != null && cheio != null && Number(avista) < Number(cheio);
  const feats = [
    p.area && { icon: Ruler, txt: `${p.area}` },
    p.bedrooms != null && { icon: BedDouble, txt: `${p.bedrooms} quartos` },
    p.suites != null && { icon: Bath, txt: `${p.suites} suítes` },
    p.garages != null && { icon: Car, txt: `${p.garages} vagas` },
  ].filter(Boolean) as { icon: any; txt: string }[];

  async function baixar() {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const canvas = await html2canvas(cardRef.current, { useCORS: true, backgroundColor: "#0e1218", scale: 3 });
      const a = document.createElement("a");
      a.download = `anuncio-${p.code || "imovel"}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) {
      alert("Não consegui gerar a imagem (a foto pode estar bloqueando por segurança). O anúncio segue visível para print.");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 overflow-y-auto" onClick={onClose}>
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <div ref={cardRef} style={{ width: 420, background: "#0e1218", color: "#F5EFE0", fontFamily: "Inter, system-ui, sans-serif", borderRadius: 18, overflow: "hidden" }}>
          <div style={{ position: "relative", height: 260, background: "#1b212b" }}>
            {cover
              ? <img src={cover} crossOrigin="anonymous" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#8a8375" }}>sem foto</div>}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(14,18,24,0) 55%, rgba(14,18,24,0.95) 100%)" }} />
            <img src={LOGO_URL} crossOrigin="anonymous" alt="Calebe" style={{ position: "absolute", top: 16, left: 18, height: 26 }} />
            {temDesconto && <div style={{ position: "absolute", top: 16, right: 16, background: "#C9A24B", color: "#1a1206", fontWeight: 700, fontSize: 12, padding: "5px 12px", borderRadius: 999 }}>OPORTUNIDADE À VISTA</div>}
          </div>

          <div style={{ padding: "16px 20px 22px" }}>
            <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.25 }}>{p.title || "Imóvel Calebe"}</div>
            <div style={{ fontSize: 13, color: "#B9B09B", marginTop: 3 }}>{[p.neighborhood, p.city].filter(Boolean).join(" · ")}</div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(245,239,224,0.12)" }}>
              {temDesconto && <div style={{ fontSize: 13, color: "#8a8375", textDecoration: "line-through" }}>De {brl(cheio)}</div>}
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#C9A24B" }}>{temDesconto ? "À vista com desconto" : "Valor"}</span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, color: "#E7C874", lineHeight: 1.1 }}>{brl(temDesconto ? avista : cheio)}</div>
            </div>

            {feats.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16 }}>
                {feats.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#D9D2C0" }}>
                    <f.icon size={15} color="#C9A24B" /> {f.txt}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#8a8375" }}>
              <span>Cód. {p.code || "—"}</span>
              <span style={{ color: "#C9A24B", fontWeight: 600 }}>Fale com a Calebe Imóveis</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={baixar} disabled={saving} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">
            <Download size={16} /> {saving ? "Gerando…" : "Baixar anúncio"}
          </button>
          <button onClick={onClose} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-sand-100/20 text-sand-100/80 hover:bg-sand-100/10">
            <X size={16} /> Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
