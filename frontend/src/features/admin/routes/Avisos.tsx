// Avisos · CRUD broadcast pra corretores
// GET /api/announcements · POST /api/announcements (multipart via NewAnnouncementModal)
import { useEffect, useState } from "react";
import { Plus, Trash2, Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { NewAnnouncementModal } from "../components/NewAnnouncementModal";

interface Announcement {
  id: string;
  title: string;
  body?: string;
  createdAt?: string;
  createdBy?: string; // backend retorna User.id (string), não objeto com name
  target?: "ALL" | "SEGMENT" | "INDIVIDUAL";
  targetSegment?: string | null;
  targetUserId?: string | null;
  imageUrl?: string | null;
  documentUrl?: string | null;
  videoUrl?: string | null;
  showOnLogin?: boolean;
}

export function Avisos() {
  const [list, setList] = useState<Announcement[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    try {
      const r = await api.get<{ data: Announcement[] }>("/api/announcements?limit=200");
      setList(r.data ?? []);
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }
  useEffect(() => { void load(); }, []);

  async function remove(id: string) {
    if (!confirm("Excluir este aviso?")) return;
    try {
      await api.del(`/api/announcements/${id}`);
      showToast("Aviso excluído");
      await load();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }

  function destLabel(a: Announcement) {
    if (a.target === "SEGMENT")    return `Segmento · ${a.targetSegment ?? "—"}`;
    if (a.target === "INDIVIDUAL") return `Corretor específico`;
    return "Todos os corretores";
  }

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Avisos"
        description="Comunicados broadcast pra todos os corretores"
        actions={
          <Button variant="gold" onClick={() => setModalOpen(true)}>
            <Megaphone size={14} /> Criar aviso
          </Button>
        }
      />

      <div className="space-y-3">
        {list.length === 0 ? (
          <div className="card p-10 text-center text-sand-100/55">Nenhum aviso publicado.</div>
        ) : list.map((a) => (
          <article key={a.id} className="card p-5 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base mb-1">{a.title}</h3>
              {a.body && <p className="text-sm text-sand-100/75 whitespace-pre-wrap">{a.body}</p>}
              {/* Mídia anexada */}
              {a.imageUrl && (
                <img src={resolveBackendUrl(a.imageUrl)} alt={a.title} className="max-w-xs rounded border hairline mt-3" loading="lazy"
                     onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              )}
              {a.videoUrl && (
                <video src={resolveBackendUrl(a.videoUrl)} controls playsInline preload="metadata" className="max-w-xs rounded border hairline mt-3" />
              )}
              {a.documentUrl && (
                <a href={resolveBackendUrl(a.documentUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-gold-300 hover:text-gold-200 mt-2">
                  Documento anexado
                </a>
              )}
              <p className="text-[0.7rem] text-sand-100/45 mt-2">
                {a.createdAt?.slice(0, 16).replace("T", " ") ?? ""} · {destLabel(a)}
                {a.showOnLogin && <span className="ml-2 text-gold-300">· mostrar no login</span>}
              </p>
            </div>
            <Button variant="danger" onClick={() => remove(a.id)} style={{ padding: ".5rem .7rem" }}>
              <Trash2 size={14} />
            </Button>
          </article>
        ))}
      </div>

      <NewAnnouncementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}
