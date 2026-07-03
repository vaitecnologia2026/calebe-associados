// LP pública de afiliado · /c/:slug
// Sem auth · backend GET /api/associates/public-by-slug/:slug
// Slug = primeiro nome do corretor em lowercase (convenção do legado)
// Retorna: name, bio, photoUrl, creci, creciUf, whatsapp, phone
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BadgeCheck, MessageCircle, Phone, MapPin, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

const LOGO_URL = "https://d78txhfo8gp8r.cloudfront.net/calebe/arquivos/logo.png";

interface Afiliado {
  name: string;
  bio?: string;
  photoUrl?: string;
  creci?: string;
  creciUf?: string;
  whatsapp?: string;
  phone?: string;
}

function formatPhone(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}
function digitsOnly(raw?: string): string {
  return (raw || "").replace(/\D/g, "");
}
function resolvePhotoUrl(url?: string): string {
  if (!url) return "";
  if (/^https?:/i.test(url)) return url;
  // Backend retorna URL relativa tipo "/midias/perfil/perfil-xxxxx.jpg"
  return `https://app.calebe.tech${url}`;
}

export function LpAfiliado() {
  const { slug } = useParams<{ slug?: string }>();
  const [data, setData] = useState<Afiliado | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) { setError("slug_required"); setLoading(false); return; }
    (async () => {
      try {
        const r = await api.get<Afiliado>(`/api/associates/public-by-slug/${encodeURIComponent(slug)}`);
        setData(r);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally { setLoading(false); }
    })();
  }, [slug]);

  // Força dark theme nessa página (legado da landing pública)
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
  }, []);

  // 2026-07-01 · LP usa o NÚMERO OFICIAL da Meta (o lead entra no sistema), não o do corretor.
  // O código #CRECI credita o lead ao corretor do link (webhook lê no 1º inbound).
  const waNumber = digitsOnly(data?.whatsapp || data?.phone);
  const CALEBE_LP_NUMBER = "554792293685";
  const waHref = `https://wa.me/${CALEBE_LP_NUMBER}?text=${encodeURIComponent(`Olá! Vim pelo link do corretor ${data?.name ?? ""} (#CRECI${(data as any)?.creci ?? ""}) e gostaria de conversar sobre imóveis na Calebe.`)}`;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header simples */}
      <header className="bg-app-elevated/40 backdrop-blur border-b hairline">
        <div className="container-site flex items-center justify-between py-4 gap-3">
          <div className="inline-flex items-center gap-2 text-gold-400 font-bold tracking-tight">
            <span className="w-7 h-7 rounded-sm bg-gold-gradient text-app-canvas font-display text-base flex items-center justify-center">C</span>
            <span className="text-sm md:text-base">Calebe Investimentos</span>
          </div>
          <a
            href="/cadastro"
            className="text-xs md:text-sm uppercase tracking-mono-wide text-sand-100/65 hover:text-gold-400 transition-colors"
          >
            Quero ser corretor
          </a>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        {loading ? (
          <div className="text-sand-100/65 inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Carregando…
          </div>
        ) : error ? (
          <div className="card p-10 max-w-md text-center">
            <p className="text-sand-50 font-semibold mb-2">Corretor não encontrado</p>
            <p className="text-sm text-sand-100/65 mb-4">
              O link pode estar errado ou o corretor não está mais ativo.
            </p>
            <a href="/" className="text-gold-300 hover:text-gold-200 text-sm font-semibold inline-flex items-center gap-1">
              Voltar para Calebe
            </a>
          </div>
        ) : data ? (
          <article
            className="card max-w-md w-full overflow-hidden"
            style={{ padding: 0 }}
          >
            {/* Faixa dourada de topo */}
            <div className="h-2 bg-gold-gradient" />

            <div className="p-6 md:p-8">
              {/* Avatar + nome + verificado */}
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  {data.photoUrl ? (
                    <img
                      src={resolvePhotoUrl(data.photoUrl)}
                      alt={data.name}
                      className="w-28 h-28 rounded-full object-cover border-2 border-gold-400/40"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-28 h-28 rounded-full bg-gold-400/10 border-2 border-gold-400/40 flex items-center justify-center text-gold-400 text-3xl font-bold">
                      {data.name?.[0] ?? "?"}
                    </div>
                  )}
                  <span
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center border-2 border-app-elevated"
                    title="Corretor verificado Calebe"
                  >
                    <BadgeCheck size={16} />
                  </span>
                </div>

                <h1 className="text-2xl md:text-3xl font-bold text-sand-50 mt-4">{data.name}</h1>
                <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-300 mt-1">
                  Corretor Associado Calebe
                </p>

                {(data.creci || data.creciUf) && (
                  <p className="text-xs text-sand-100/65 mt-1 inline-flex items-center gap-1">
                    <MapPin size={11} /> CRECI {data.creci ?? "—"}{data.creciUf ? `/${data.creciUf}` : ""}
                  </p>
                )}
              </div>

              {/* Bio */}
              {data.bio && (
                <div className="mt-5 pt-5 border-t hairline">
                  <p className="text-sm text-sand-100/85 whitespace-pre-wrap leading-relaxed text-center">{data.bio}</p>
                </div>
              )}

              {/* CTAs */}
              <div className="mt-6 space-y-2">
                {waHref && (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 font-bold text-sm py-3 px-4 rounded-[6px]"
                    style={{
                      background: "linear-gradient(135deg,#25D366,#128C7E)",
                      color: "#fff",
                      boxShadow: "0 4px 14px rgba(37,211,102,.4)",
                    }}
                  >
                    <MessageCircle size={16} /> Falar no WhatsApp
                  </a>
                )}
                {/* 2026-07-01 · link "Ligar" removido — não expor número do corretor na LP */}
              </div>

              <p className="text-[0.65rem] text-sand-100/45 mt-6 text-center leading-relaxed">
                Atendimento personalizado · Estrutura premium Calebe · Mais de 400 corretores associados
              </p>
            </div>
          </article>
        ) : null}
      </main>

      <footer className="border-t hairline py-4">
        <div className="container-site text-center text-[0.7rem] text-sand-100/45 inline-flex items-center justify-center gap-2 w-full">
          <img src={LOGO_URL} alt="" className="h-3 opacity-40" />
          © {new Date().getFullYear()} Calebe Investimentos Imobiliários
        </div>
      </footer>
    </div>
  );
}
