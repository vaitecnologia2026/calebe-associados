// Avisos do corretor — MURAL estilo Instagram (grade de posts + lightbox)
// Backend GET /api/announcements?limit=200 retorna data[] com:
//   { id, title, body, target, imageUrl?, documentUrl?, videoUrl?, createdAt, createdBy, read }
// Marker [VIDEO_YT:ID] no body indica YouTube embedded. Marcar lido: POST /api/announcements/:id/read.
import { useEffect, useMemo, useState } from "react";
import { Megaphone, FileText, Play, Check } from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";

interface Announcement {
  id: string;
  title: string;
  body?: string;
  target?: "ALL" | "SEGMENT" | "INDIVIDUAL";
  imageUrl?: string | null;
  documentUrl?: string | null;
  videoUrl?: string | null;
  createdBy?: string;
  createdAt?: string;
  read?: boolean;
}

interface ParsedBody { text: string; youtubeId: string | null; }

function parseBody(raw: string): ParsedBody {
  if (!raw) return { text: "", youtubeId: null };
  const m = raw.match(/\[VIDEO_YT:([A-Za-z0-9_-]{6,})\]/);
  if (!m) return { text: raw, youtubeId: null };
  return { text: raw.replace(m[0], "").trim(), youtubeId: m[1] };
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

// Avatar circular dourado da Calebe (estilo perfil do Instagram)
function CalebeAvatar({ size = 36 }: { size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 9999, flexShrink: 0,
        background: "linear-gradient(135deg,#E2BE6E,#9A7733)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,.35)", border: "1px solid rgba(255,255,255,.18)",
      }}
    >
      <span className="font-display font-bold" style={{ color: "#1a1206", fontSize: size * 0.52, lineHeight: 1 }}>C</span>
    </div>
  );
}

export function CorretorAvisos() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Announcement[] }>("/api/announcements?limit=200");
      setList(r.data ?? []);
    } catch (e: unknown) {
      showToast(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function markRead(id: string) {
    setList((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
    try {
      await api.post(`/api/announcements/${id}/read`, {});
    } catch (e: unknown) {
      setList((prev) => prev.map((a) => (a.id === id ? { ...a, read: false } : a)));
      showToast(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const active = useMemo(() => list.find((a) => a.id === activeId) ?? null, [list, activeId]);

  // Abrir o post = visualizar = marcar como lido (como abrir um post no Instagram)
  useEffect(() => {
    if (!activeId) return;
    const a = list.find((x) => x.id === activeId);
    if (a && !a.read) void markRead(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const unreadCount = useMemo(() => list.filter((a) => !a.read).length, [list]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        eyebrow="Comunicação"
        title="Mural Calebe"
        description={unreadCount > 0
          ? `${unreadCount} aviso${unreadCount === 1 ? "" : "s"} não lido${unreadCount === 1 ? "" : "s"} · toque para abrir`
          : "Mural em dia · todos os avisos lidos"}
      />

      {loading && list.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55">Carregando mural…</div>
      ) : list.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55">
          <Megaphone className="mx-auto mb-2 text-sand-100/35" size={28} />
          Sem avisos por enquanto.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(208px, 1fr))", gap: "0.85rem" }}>
          {list.map((a) => <MuralTile key={a.id} a={a} onOpen={() => setActiveId(a.id)} />)}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActiveId(null)} title={active ? active.title : ""} size="lg">
        {active && <FullPost a={active} />}
      </Modal>
    </div>
  );
}

// ===========================================================================
// Tile do mural · quadrado com capa (imagem/vídeo/youtube) ou cartão de texto
// ===========================================================================
function MuralTile({ a, onOpen }: { a: Announcement; onOpen: () => void }) {
  const { youtubeId } = parseBody(a.body ?? "");
  const img = a.imageUrl ? resolveBackendUrl(a.imageUrl) : null;
  const vid = a.videoUrl ? resolveBackendUrl(a.videoUrl) : null;
  const ytThumb = youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null;
  const hasMedia = !!(img || vid || ytThumb);
  const isVideo = !!(vid || ytThumb);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative overflow-hidden text-left"
      style={{
        aspectRatio: "1 / 1",
        borderRadius: 14,
        background: "#0b1422",
        border: a.read ? "1px solid rgba(255,255,255,.08)" : "1px solid rgba(212,168,83,.55)",
        boxShadow: a.read ? "none" : "0 0 0 1px rgba(212,168,83,.22), 0 10px 24px rgba(0,0,0,.28)",
        cursor: "pointer",
      }}
    >
      {img ? (
        <img src={img} alt={a.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      ) : ytThumb ? (
        <img src={ytThumb} alt={a.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      ) : vid ? (
        <video src={vid} muted preload="metadata" playsInline className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center"
          style={{ background: "radial-gradient(130% 130% at 50% 0%, rgba(212,168,83,.20), rgba(11,20,34,.55) 72%)" }}>
          <Megaphone size={26} className="mb-2" style={{ color: "#E8CE96" }} />
          <p className="font-bold text-sand-50 leading-snug"
            style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: ".92rem" }}>
            {a.title}
          </p>
        </div>
      )}

      {hasMedia && (
        <div className="absolute inset-x-0 bottom-0 p-3"
          style={{ background: "linear-gradient(0deg, rgba(0,0,0,.85) 0%, rgba(0,0,0,.32) 58%, transparent 100%)" }}>
          <p className="font-bold text-white leading-snug"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: ".88rem" }}>
            {a.title}
          </p>
        </div>
      )}

      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: "none" }}>
          <span style={{ width: 46, height: 46, borderRadius: 9999, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,.55)" }}>
            <Play size={20} className="text-white" style={{ marginLeft: 2 }} />
          </span>
        </div>
      )}

      {!a.read && (
        <span className="absolute text-[0.55rem] uppercase tracking-mono-xwide font-bold px-2 py-0.5 rounded-full"
          style={{ top: 10, left: 10, background: "#D4A853", color: "#1a1206" }}>
          Novo
        </span>
      )}
      <div className="absolute" style={{ top: 10, right: 10 }}><CalebeAvatar size={26} /></div>
    </button>
  );
}

// ===========================================================================
// Post completo (lightbox) · cabeçalho Calebe + mídia + legenda + documento
// ===========================================================================
function FullPost({ a }: { a: Announcement }) {
  const { text, youtubeId } = parseBody(a.body ?? "");
  const img = a.imageUrl ? resolveBackendUrl(a.imageUrl) : null;
  const vid = a.videoUrl ? resolveBackendUrl(a.videoUrl) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CalebeAvatar size={40} />
        <div className="min-w-0">
          <p className="font-bold text-sand-50 leading-tight">Calebe Investimentos</p>
          <p className="text-[0.72rem] text-sand-100/55">{fmtDate(a.createdAt)}</p>
        </div>
        {a.read && (
          <span className="ml-auto text-[0.7rem] uppercase tracking-mono-wide text-sand-100/40 inline-flex items-center gap-1">
            <Check size={12} /> Lido
          </span>
        )}
      </div>

      {img && (
        <div className="flex justify-center bg-black border hairline overflow-hidden" style={{ borderRadius: 12 }}>
          <img src={img} alt={a.title} loading="lazy" className="max-w-full" style={{ maxHeight: "64vh", objectFit: "contain" }} />
        </div>
      )}
      {youtubeId && (
        <div className="aspect-video border hairline overflow-hidden" style={{ borderRadius: 12 }}>
          <iframe src={`https://www.youtube.com/embed/${youtubeId}`} title={a.title} className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
      )}
      {vid && (
        <div className="flex justify-center bg-black border hairline overflow-hidden" style={{ borderRadius: 12 }}>
          <video src={vid} controls playsInline preload="metadata" className="max-w-full" style={{ maxHeight: "64vh" }} />
        </div>
      )}

      {text && (
        <p className="text-sm md:text-[0.95rem] text-sand-100/90 whitespace-pre-wrap leading-relaxed">{text}</p>
      )}

      {a.documentUrl && (
        <a href={resolveBackendUrl(a.documentUrl)} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 hover:text-gold-200">
          <FileText size={15} /> Abrir documento anexado
        </a>
      )}
    </div>
  );
}
