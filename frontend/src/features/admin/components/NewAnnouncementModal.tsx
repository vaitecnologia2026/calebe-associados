// Modal "Criar Aviso" · porte FIEL do criarAvisoModal do monólito (linha 6897+)
// Endpoint: POST /api/announcements (multipart FormData)
//
// Mapping frontend → backend (EXATAMENTE como o monólito envia):
//   titulo            → title          (string trim · obrigatório)
//   descricao         → body           (string trim · obrigatório · com possível [VIDEO_YT:ID] appended)
//   destino           → target         ("todos|segmento|individual" → "ALL|SEGMENT|INDIVIDUAL")
//   segmentoAlvo      → targetSegment  (se destino=segmento)
//   corretorAlvo      → targetUserId   (se destino=individual)
//   showOnLogin       → showOnLogin    ("true"|"false" string)
//   imagem (File)     → imagem         (multipart)
//   documento (File)  → documento      (multipart)
//   video (File)      → video          (multipart, até 100MB)
//   videoYoutubeUrl   → [VIDEO_YT:ID] appended ao body (extração de id local)

import { useEffect, useState, type FormEvent } from "react";
import { Image as ImgIcon, FileText, Video, Send, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ApiError } from "@/types/api";
import type { Associate } from "@/types/lead";

const TARGET_MAP: Record<string, "ALL" | "SEGMENT" | "INDIVIDUAL"> = {
  todos: "ALL", segmento: "SEGMENT", individual: "INDIVIDUAL",
};

// Replica extractYouTubeId do monólito · aceita youtu.be/ID, watch?v=ID, shorts/ID
function extractYouTubeId(raw: string): string | null {
  if (!raw) return null;
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{6,15})/,
    /youtube\.com\/watch\?[^#]*v=([a-zA-Z0-9_-]{6,15})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,15})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,15})/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  // raw já é só o id?
  if (/^[a-zA-Z0-9_-]{6,15}$/.test(raw.trim())) return raw.trim();
  return null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

const SEGMENTOS = ["Alto padrão", "Investidor", "Lançamentos", "Regional"];

export function NewAnnouncementModal({ open, onClose, onCreated }: Props) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [destino, setDestino] = useState<"todos" | "segmento" | "individual">("todos");
  const [segmentoAlvo, setSegmentoAlvo] = useState(SEGMENTOS[0]);
  const [corretorAlvo, setCorretorAlvo] = useState("");
  const [showOnLogin, setShowOnLogin] = useState(false);
  const [videoYtUrl, setVideoYtUrl] = useState("");
  const [imagem, setImagem] = useState<File | null>(null);
  const [documento, setDocumento] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);

  const [corretores, setCorretores] = useState<Associate[]>([]);
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await api.get<{ data: Associate[] }>("/api/associates?limit=5000");
        const ativos = (r.data ?? []).filter((b) => b.status === "APPROVED");
        setCorretores(ativos);
        if (ativos.length && !corretorAlvo) setCorretorAlvo(ativos[0].user?.id ?? "");
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function reset() {
    setTitulo(""); setDescricao(""); setDestino("todos");
    setSegmentoAlvo(SEGMENTOS[0]); setCorretorAlvo("");
    setShowOnLogin(false); setVideoYtUrl("");
    setImagem(null); setDocumento(null); setVideo(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const titleTrim = titulo.trim();
    const bodyTrim = descricao.trim();
    if (!titleTrim || !bodyTrim) { showToast("Preencha título e descrição"); return; }

    // YouTube URL → appended ao body como [VIDEO_YT:ID]
    let bodyToSend = bodyTrim;
    if (videoYtUrl.trim()) {
      const ytId = extractYouTubeId(videoYtUrl.trim());
      if (!ytId) {
        showToast("Link do YouTube inválido · use youtu.be/ID, watch?v=ID ou shorts/ID");
        return;
      }
      bodyToSend = bodyTrim + "\n\n[VIDEO_YT:" + ytId + "]";
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", titleTrim);
      fd.append("body", bodyToSend);
      fd.append("target", TARGET_MAP[destino] ?? "ALL");
      if (destino === "segmento"   && segmentoAlvo) fd.append("targetSegment", segmentoAlvo);
      if (destino === "individual" && corretorAlvo) fd.append("targetUserId",  corretorAlvo);
      fd.append("showOnLogin", showOnLogin ? "true" : "false");
      if (imagem)    fd.append("imagem",    imagem);
      if (documento) fd.append("documento", documento);
      if (video)     fd.append("video",     video);

      await api.post("/api/announcements", fd);

      const destLabel = destino === "todos" ? "todos os corretores"
        : destino === "segmento" ? `segmento ${segmentoAlvo}`
        : corretorAlvo;
      showToast(`Aviso enviado · ${destLabel}`);
      reset();
      onClose();
      onCreated?.();
    } catch (e) {
      let msg = "Falha ao salvar aviso";
      if (e instanceof ApiError) {
        msg = e.message;
        const issues = (e.data as { issues?: Array<{ path?: string[]; message?: string }> })?.issues;
        if (issues?.length) {
          msg = "Corrija: " + issues.map((i) => `${i.path?.join(".")} ${i.message}`).join("; ");
        }
      }
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="mb-5">
        <p className="meta-gold mb-1">Comunicação interna</p>
        <h2 className="text-2xl font-bold tracking-display-tight">Criar aviso</h2>
        <p className="text-sm text-sand-100/65 mt-1">Defina destino e conteúdo. O corretor recebe no painel de avisos.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Título *"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          required
          placeholder="Ex: Nova tabela de comissões"
        />

        <div>
          <label className="field-label">Descrição *</label>
          <textarea
            className="field-input"
            rows={5}
            required
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Corpo da mensagem"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <FileSlot
            label="Imagem (opcional)"
            Icon={ImgIcon}
            file={imagem} onChange={setImagem}
            accept="image/*" placeholder="Selecionar imagem"
          />
          <FileSlot
            label="Documento (opcional)"
            Icon={FileText}
            file={documento} onChange={setDocumento}
            accept=".pdf,.doc,.docx" placeholder="Selecionar documento"
          />
        </div>

        <div>
          <FileSlot
            label="Vídeo · upload (opcional · até 100MB)"
            Icon={Video}
            file={video} onChange={setVideo}
            accept="video/*" placeholder="Selecionar vídeo"
          />
          <p className="text-[0.7rem] text-sand-100/55 mt-1.5">
            Sobe arquivo MP4/WebM/MOV direto · player nativo HTML5 no card do corretor. Pode usar isso OU o link do YouTube abaixo · não é obrigatório os dois.
          </p>
        </div>

        <div>
          <label className="field-label">Vídeo do YouTube (opcional)</label>
          <input
            className="field-input"
            value={videoYtUrl}
            onChange={(e) => setVideoYtUrl(e.target.value)}
            placeholder="https://youtu.be/HsPwDr-lJRw  ·  https://youtube.com/shorts/XXXXX  ·  https://youtube.com/watch?v=XXXXX"
          />
          <p className="text-[0.7rem] text-sand-100/55 mt-1.5">
            Cola a URL do vídeo · aparece como player embedado no aviso pra todos os corretores.
            Aceita URLs longas com ?si= ou ?t= (parâmetros são ignorados).
          </p>
        </div>

        <div>
          <label className="field-label">Destino *</label>
          <select
            className="field-input"
            required
            value={destino}
            onChange={(e) => setDestino(e.target.value as any)}
          >
            <option value="todos">Todos os corretores</option>
            <option value="segmento">Grupo segmentado</option>
            <option value="individual">Corretor específico</option>
          </select>
        </div>

        {destino === "segmento" && (
          <div>
            <label className="field-label">Segmento *</label>
            <select className="field-input" value={segmentoAlvo} onChange={(e) => setSegmentoAlvo(e.target.value)}>
              {SEGMENTOS.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
        )}

        {destino === "individual" && (
          <div>
            <label className="field-label">Corretor *</label>
            <select className="field-input" value={corretorAlvo} onChange={(e) => setCorretorAlvo(e.target.value)}>
              {corretores.map((b) => (
                <option key={b.id} value={b.user?.id ?? ""}>
                  {b.user?.name} · {b.segment ?? "—"}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="card p-4 cursor-pointer hover:border-gold-400/40 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 accent-gold-400"
            checked={showOnLogin}
            onChange={(e) => setShowOnLogin(e.target.checked)}
          />
          <div>
            <p className="font-semibold text-sand-50">Exibir ao logar</p>
            <p className="text-sm text-sand-100/65 mt-1">
              O aviso aparece automaticamente no primeiro acesso do corretor e trava a tela até o "Entendi".
            </p>
          </div>
        </label>

        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="gold" loading={saving}>
            <Send size={14} /> Enviar aviso
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function FileSlot({ label, Icon, file, onChange, accept, placeholder }: {
  label: string;
  Icon: LucideIcon;
  file: File | null;
  onChange: (f: File | null) => void;
  accept: string;
  placeholder: string;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <label className="bg-app-subtle/60 border hairline rounded px-3 py-3 cursor-pointer hover:border-gold-400/40 flex items-center gap-2">
        <Icon size={16} className="text-gold-400 shrink-0" />
        <span className="flex-1 text-sm truncate">{file?.name ?? placeholder}</span>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}
