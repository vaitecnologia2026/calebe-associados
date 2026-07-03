// LP link modal · porte FIEL ao monólito (linhas 6873-6894 + 14806-14844 + 8923-8943)
// Gera URL de divulgação rastreada por corretor (associate.id) + UTMs

import { useEffect, useMemo } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import { useUi } from "@/store/ui";
import { useAuth } from "@/store/auth";

interface Props {
  open: boolean;
  onClose: () => void;
  imovelCodigo: string;
  imovelTitulo?: string;
  // UTMs opcionais (override do imóvel ou corretor)
  campanha?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  fonteRastreamento?: "imovel" | "corretor" | "sistema" | "vazio";
}

const FONTE_LABELS = {
  imovel: "override do imóvel",
  corretor: "padrão do corretor",
  sistema: "padrão do sistema (admin)",
  vazio: "sem rastreamento (só tracking interno)",
} as const;

// LP base · monólito 8941. Em produção aponta para domínio canônico calebe.com.br/lp/{codigo}
const LP_BASE = "https://app.calebe.tech";

export function LpLinkModal({
  open, onClose, imovelCodigo, imovelTitulo,
  campanha, utmSource, utmMedium, utmCampaign, utmContent,
  fonteRastreamento = "vazio",
}: Props) {
  const showToast = useUi((s) => s.showToast);
  const user = useAuth((s) => s.user);
  const associate = (user?.associate as any) ?? {};

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    // Prefere associateId (CUID) sobre slug do primeiro nome · monólito 8928-8934
    const slug = associate.id ?? (user?.name ?? "").split(" ")[0]?.toLowerCase() ?? "calebe";
    params.set("c", slug);
    if (campanha) params.set("cmp", campanha.toLowerCase().replace(/\s+/g, "-").slice(0, 40));
    if (utmSource) params.set("utm_source", utmSource);
    if (utmMedium) params.set("utm_medium", utmMedium);
    if (utmCampaign) params.set("utm_campaign", utmCampaign);
    if (utmContent) params.set("utm_content", utmContent);
    // Rota REAL da LP no React é /imovel/:codigo (path), não hash do monólito antigo.
    return `${LP_BASE}/imovel/${encodeURIComponent(imovelCodigo)}?${params.toString()}`;
  }, [associate.id, user?.name, imovelCodigo, campanha, utmSource, utmMedium, utmCampaign, utmContent]);

  const utmPills = useMemo(() => {
    const arr: { key: string; value: string }[] = [];
    if (utmSource) arr.push({ key: "utm_source", value: utmSource });
    if (utmMedium) arr.push({ key: "utm_medium", value: utmMedium });
    if (utmCampaign) arr.push({ key: "utm_campaign", value: utmCampaign });
    if (utmContent) arr.push({ key: "utm_content", value: utmContent });
    return arr;
  }, [utmSource, utmMedium, utmCampaign, utmContent]);

  function copiar() {
    navigator.clipboard?.writeText(url).then(
      () => showToast("Link copiado para a área de transferência"),
      () => showToast("Falha ao copiar")
    );
  }
  function abrirLp() {
    window.open(url, "_blank", "noopener");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-navy-950/90 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-app-elevated border hairline rounded-[6px] p-6 md:p-8 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-10 w-10 inline-flex items-center justify-center text-sand-100/60 hover:text-sand-50 hover:bg-white/5 rounded-[4px]"
          aria-label="Fechar"
        >
          <X size={20} />
        </button>

        <div className="mb-5">
          <p className="meta-gold mb-1">Link de divulgação</p>
          <h2 className="text-2xl font-bold tracking-display-tight">
            LP pronta · <span className="text-gold-400">{imovelTitulo ?? imovelCodigo}</span>
          </h2>
          <p className="text-sm text-sand-100/65 mt-2">
            Rastreamento aplicado:{" "}
            <strong className="text-gold-400">{campanha ?? "—"}</strong>
            {" · fonte: "}
            <strong>{FONTE_LABELS[fonteRastreamento]}</strong>
          </p>
        </div>

        <div className="card p-4 bg-app-subtle/40 mb-4">
          <p className="text-[0.68rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80 mb-2">URL gerada</p>
          <textarea
            readOnly
            rows={3}
            value={url}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            className="field-input text-xs font-mono"
            style={{ wordBreak: "break-all" }}
          />
        </div>

        <div className="card p-3 bg-app-subtle/30 mb-5 text-xs text-sand-100/70">
          <p className="font-semibold text-sand-50 mb-1">UTMs aplicadas:</p>
          <div className="flex flex-wrap gap-2">
            {utmPills.length === 0 ? (
              <span className="text-sand-100/50">Sem UTMs configuradas.</span>
            ) : utmPills.map((u) => (
              <span
                key={u.key}
                className="inline-flex items-center text-[0.7rem] px-2 py-1 rounded-sm bg-gold-400/10 text-gold-300 border border-gold-400/25 font-mono"
              >
                {u.key}=<strong>{u.value}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end flex-wrap">
          <button className="btn-base btn-outline inline-flex items-center gap-1.5" style={{ padding: ".65rem 1.1rem" }} onClick={abrirLp}>
            <ExternalLink size={13} /> Abrir LP
          </button>
          <button className="btn-base btn-gold inline-flex items-center gap-1.5" style={{ padding: ".65rem 1.25rem" }} onClick={copiar}>
            <Copy size={13} /> Copiar link
          </button>
        </div>
      </div>
    </div>
  );
}
