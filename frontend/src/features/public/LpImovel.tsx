// LP individual de imóvel · /imovel/CODIGO
// Backend público: GET /api/properties/by-code/:code
// Tracking: fbq + GA4 via lib/tracking.ts
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { MapPin, BedDouble, Bath, Car, Maximize2, FileText, ExternalLink, MessageCircle, Loader2, Instagram, Facebook } from "lucide-react";
import { api } from "@/lib/api";
import { track } from "@/lib/tracking";
import type { Property, PropertyMedia } from "@/types/property";

const LOGO_URL = "https://d78txhfo8gp8r.cloudfront.net/calebe/arquivos/logo.png";
const WA_FALLBACK = "5547992069573"; // contato Calebe geral

interface PropertyWithDocs extends Property {
  documents?: Array<{ filename: string; url: string; size?: number; createdAt?: string }>;
}

function fmtBRL(v: unknown): string {
  if (v == null || v === "") return "Sob consulta";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return "Sob consulta";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function resolveMediaUrl(url?: string): string {
  if (!url) return "";
  if (/^https?:/i.test(url)) return url;
  return `https://app.calebe.tech${url.startsWith("/") ? "" : "/"}${url}`;
}

export function LpImovel() {
  const { codigo } = useParams<{ codigo: string }>();
  const [data, setData] = useState<PropertyWithDocs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeImg, setActiveImg] = useState<string>("");

  useEffect(() => {
    if (!codigo) return;
    (async () => {
      try {
        const r = await api.get<PropertyWithDocs>(
          `/api/properties/by-code/${encodeURIComponent(codigo)}`,
          { skipAuth: true }
        );
        setData(r);
        const cover = r.coverImageUrl ?? r.media?.[0]?.url ?? "";
        setActiveImg(resolveMediaUrl(cover));
        track("lp_imovel_view", { codigo });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro ao carregar imóvel");
      }
    })();
  }, [codigo]);

  function ctaWhatsApp() {
    const msg = encodeURIComponent(
      `Olá! Tenho interesse no imóvel ${data?.code ?? codigo} (${data?.title ?? ""}). Pode me passar mais detalhes?`
    );
    track("lp_imovel_cta_whatsapp", { codigo });
    window.open(`https://wa.me/${WA_FALLBACK}?text=${msg}`, "_blank", "noopener");
  }

  if (err) {
    return (
      <div className="min-h-screen bg-app-bg text-sand-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <img src={LOGO_URL} alt="Calebe Associados" className="h-10 w-auto mx-auto mb-6 opacity-80" />
          <p className="text-2xl font-bold mb-2">404 · Imóvel não encontrado</p>
          <p className="text-sand-100/55 text-sm">O código <code className="text-gold-300">{codigo}</code> não consta no nosso portfólio ou foi removido.</p>
          <a href="/" className="inline-block mt-6 text-sm underline text-gold-300 hover:text-gold-300">Voltar pra página inicial</a>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-app-bg text-sand-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={36} className="animate-spin text-gold-300 mx-auto mb-3" />
          <p className="text-sand-100/55 text-sm">Carregando imóvel…</p>
        </div>
      </div>
    );
  }

  const cidade = [data.neighborhood, data.city, data.state].filter(Boolean).join(", ");
  const mediaImages: PropertyMedia[] = (data.media ?? []).filter((m) => !m.type || m.type === "image");
  const valorBR = fmtBRL(data.value);

  return (
    <div className="min-h-screen bg-app-bg text-sand-50">
      {/* Header */}
      <header className="border-b border hairline bg-app-bg/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2">
            <img src={LOGO_URL} alt="Calebe Associados" className="h-8 w-auto" />
            <span className="text-sm font-semibold hidden sm:inline">Calebe Associados</span>
          </a>
          <button
            onClick={ctaWhatsApp}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg px-3 py-2 text-sm"
          >
            <MessageCircle size={14} /> Falar agora
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
        {/* Hero */}
        <section className="grid lg:grid-cols-[1.6fr_1fr] gap-6 mb-8">
          <div>
            {activeImg ? (
              <div className="aspect-[16/10] rounded-xl overflow-hidden border hairline bg-app-elevated">
                <img src={activeImg} alt={data.title ?? "Imóvel"} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="aspect-[16/10] rounded-xl bg-app-elevated border hairline flex items-center justify-center">
                <span className="text-6xl text-gold-300/40 font-light">{(data.title ?? "—")[0]}</span>
              </div>
            )}
            {/* Thumbnails */}
            {mediaImages.length > 1 && (
              <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {mediaImages.slice(0, 16).map((m, i) => {
                  const url = resolveMediaUrl(m.url);
                  const isActive = url === activeImg;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveImg(url)}
                      className={`aspect-square rounded overflow-hidden border-2 transition-all ${isActive ? "border-gold-400" : "border hairline hover:border-gold-400/40"}`}
                      aria-label={`Foto ${i + 1}`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold-300 font-semibold">{data.code}</p>
              <h1 className="text-2xl md:text-3xl font-bold mt-1 leading-tight">{data.title}</h1>
              {cidade && (
                <p className="text-sand-100/75 mt-2 inline-flex items-center gap-1.5 text-sm">
                  <MapPin size={14} className="text-gold-300" /> {cidade}
                </p>
              )}
            </div>

            <div className="bg-app-elevated/80 border hairline rounded-lg p-4">
              <p className="text-xs uppercase text-sand-100/55 tracking-wide">Valor</p>
              <p className="text-3xl font-bold text-gold-300 mt-1 tabular-nums">{valorBR}</p>
            </div>

            {/* Tipologia */}
            <div className="grid grid-cols-2 gap-2">
              {data.bedrooms != null && (
                <Spec icon={<BedDouble size={16} />} label="Quartos" value={String(data.bedrooms)} />
              )}
              {data.suites != null && (
                <Spec icon={<Bath size={16} />} label="Suítes" value={String(data.suites)} />
              )}
              {data.garages != null && (
                <Spec icon={<Car size={16} />} label="Garagens" value={String(data.garages)} />
              )}
              {data.area != null && (
                <Spec icon={<Maximize2 size={16} />} label="Área" value={`${data.area} m²`} />
              )}
            </div>

            <button
              onClick={ctaWhatsApp}
              className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg px-4 py-3 text-base"
            >
              <MessageCircle size={18} /> Quero saber mais
            </button>
          </aside>
        </section>

        {/* Descrição */}
        {data.description && (
          <section className="mb-8">
            <h2 className="text-lg font-bold mb-3">Sobre o imóvel</h2>
            <div className="bg-app-elevated/40 border hairline rounded-lg p-5">
              <p className="text-sand-100/85 leading-relaxed whitespace-pre-wrap text-sm md:text-base">{data.description}</p>
            </div>
          </section>
        )}

        {/* Diferenciais */}
        {data.features && data.features.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold mb-3">Diferenciais</h2>
            <div className="flex flex-wrap gap-2">
              {data.features.map((f) => (
                <span
                  key={f}
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-full bg-gold-400/10 border border-gold-400/40 text-gold-300"
                >
                  {f}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Documentos */}
        {data.documents && data.documents.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold mb-3">Documentos</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {data.documents.map((d, i) => (
                <a
                  key={i}
                  href={resolveMediaUrl(d.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 bg-app-elevated/60 border hairline hover:border-gold-400/40 rounded-lg p-3 transition-colors"
                >
                  <FileText size={20} className="text-gold-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.filename}</p>
                    {d.size != null && (
                      <p className="text-[11px] text-sand-100/55">{(d.size / 1024).toFixed(0)} KB</p>
                    )}
                  </div>
                  <ExternalLink size={14} className="text-sand-100/40 shrink-0" />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* CTA final */}
        <section className="bg-gradient-to-br from-gold-400/15 to-gold-400/5 border border-gold-400/40 rounded-xl p-6 md:p-8 text-center">
          <h2 className="text-xl md:text-2xl font-bold mb-2">Gostou? Fale com a gente</h2>
          <p className="text-sand-100/75 text-sm md:text-base mb-5">
            Nossa equipe responde direto pelo WhatsApp e pode agendar uma visita.
          </p>
          <button
            onClick={ctaWhatsApp}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg px-6 py-3 text-base"
          >
            <MessageCircle size={18} /> Conversar no WhatsApp
          </button>
        </section>
      </main>

      <footer className="border-t hairline mt-10 pt-10 pb-9 text-center">
        {/* Selo de Qualidade · Calebe Garantidor */}
        <div className="flex flex-col items-center gap-3 mb-7">
          <img
            src="/img/selo-calebe.png"
            alt="Selo de Qualidade Calebe Garantidor"
            className="w-[124px] h-[124px] object-contain"
            style={{ filter: "drop-shadow(0 6px 22px rgba(222,185,109,.30))" }}
            loading="lazy"
          />
          <div>
            <p className="text-gold-300 font-semibold text-sm tracking-wide">Selo de Qualidade · Calebe Garantidor</p>
            <p className="text-sand-100/55 text-xs mt-1 max-w-md mx-auto px-4 leading-snug">
              Imóvel com curadoria e garantia Calebe — segurança e suporte do primeiro contato ao fechamento.
            </p>
          </div>
        </div>

        {/* Redes sociais da Calebe */}
        <div className="flex items-center justify-center gap-3 mb-5">
          <a href="https://www.instagram.com/calebe_imoveis/" target="_blank" rel="noreferrer" aria-label="Instagram da Calebe"
            className="w-11 h-11 inline-flex items-center justify-center rounded-full border hairline text-sand-100/75 hover:text-gold-300 transition-colors">
            <Instagram size={18} />
          </a>
          <a href="https://www.facebook.com/calebeimoveis" target="_blank" rel="noreferrer" aria-label="Facebook da Calebe"
            className="w-11 h-11 inline-flex items-center justify-center rounded-full border hairline text-sand-100/75 hover:text-gold-300 transition-colors">
            <Facebook size={18} />
          </a>
        </div>

        <p className="text-xs text-sand-100/40">
          © {new Date().getFullYear()} Calebe Investimentos Imobiliários · CRECI 6131J
        </p>
      </footer>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-app-elevated/40 border hairline rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-sand-100/55 text-[11px] uppercase tracking-wide">
        <span className="text-gold-300">{icon}</span> {label}
      </div>
      <p className="font-semibold text-base mt-0.5">{value}</p>
    </div>
  );
}
