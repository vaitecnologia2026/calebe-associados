// Modal Reportar problema · captura screenshot automático com html2canvas,
// permite trocar imagem, envia via POST /api/feedback (multipart).
// Backend cria 1 Notification por admin + audit log + SSE feedback.submitted.
import { useEffect, useRef, useState, type FormEvent } from "react";
import html2canvas from "html2canvas";
import { Bug, Send, X as XIcon, RefreshCw, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

type Category = "bug" | "performance" | "outro";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "bug",         label: "Bug · Algo não funciona" },
  { value: "performance", label: "Performance · Lentidão ou travamento" },
  { value: "outro",       label: "Outro" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

const CAPTURE_TIMEOUT_MS = 6000;

async function captureScreenshot(): Promise<File | null> {
  try {
    const target = document.body;
    // Race · html2canvas pode travar indefinidamente se houver <img> CORS que nunca resolve
    const work = html2canvas(target, {
      backgroundColor: null,
      logging: false,
      scale: 1,
      useCORS: true,
      allowTaint: true,
      imageTimeout: 3000,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
    });
    const canvas = await Promise.race([
      work,
      new Promise<HTMLCanvasElement>((_, rej) => setTimeout(() => rej(new Error("timeout")), CAPTURE_TIMEOUT_MS)),
    ]);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png", 0.92));
    if (!blob) return null;
    return new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" });
  } catch (e) {
    console.warn("[ReportarProblema] screenshot falhou:", e);
    return null;
  }
}

export function ReportarProblemaModal({ open, onClose }: Props) {
  const user = useAuth((s) => s.user);
  const showToast = useUi((s) => s.showToast);

  const [category, setCategory] = useState<Category | "">("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Captura screenshot ao abrir o modal · com timeout 6s pra não ficar infinito
  // CRÍTICO: oculta o próprio modal durante a captura pra ele NÃO aparecer na foto
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCapturing(true);
    setCaptureFailed(false);

    (async () => {
      // 1. Acha o overlay do modal (todos os fixed inset-0 que são z-50/z-100 do dialog)
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      const hiddenSnapshots: Array<{ el: HTMLElement; prev: string }> = [];
      for (const d of dialogs) {
        // Oculta o próprio modal + seu container fixed parent
        const fixedParent = d.closest<HTMLElement>('.fixed.inset-0') ?? d;
        hiddenSnapshots.push({ el: fixedParent, prev: fixedParent.style.display });
        fixedParent.style.display = "none";
      }
      // 2. Espera o repaint sem o modal
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      // 3. Captura
      const file = await captureScreenshot();

      // 4. Restaura o modal
      for (const { el, prev } of hiddenSnapshots) {
        el.style.display = prev;
      }

      if (cancelled) return;
      if (file) {
        setScreenshot(file);
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      } else {
        setCaptureFailed(true);
      }
      setCapturing(false);
    })();

    return () => { cancelled = true; };
  }, [open]);

  // Cleanup blob URL
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function reset() {
    setCategory("");
    setDescription("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshot(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    if (sending) return;
    reset();
    onClose();
  }

  async function retakeScreenshot() {
    setCapturing(true);
    setCaptureFailed(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshot(null);
    setPreviewUrl(null);
    // Oculta modal durante a captura
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    const hiddenSnapshots: Array<{ el: HTMLElement; prev: string }> = [];
    for (const d of dialogs) {
      const fixedParent = d.closest<HTMLElement>('.fixed.inset-0') ?? d;
      hiddenSnapshots.push({ el: fixedParent, prev: fixedParent.style.display });
      fixedParent.style.display = "none";
    }
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const file = await captureScreenshot();
    for (const { el, prev } of hiddenSnapshots) {
      el.style.display = prev;
    }
    if (file) {
      setScreenshot(file);
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setCaptureFailed(true);
      showToast("Falha ao capturar · use anexar imagem");
    }
    setCapturing(false);
  }

  function pickManualFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { showToast("Selecione uma imagem"); return; }
    if (f.size > 10 * 1024 * 1024) { showToast("Imagem > 10MB · reduza ou compresse"); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshot(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  function removeScreenshot() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshot(null);
    setPreviewUrl(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!category) { showToast("Selecione uma categoria"); return; }
    if (description.trim().length < 10) { showToast("Descreva com pelo menos 10 caracteres"); return; }
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("type", category);
      fd.append("description", description.trim());
      fd.append("currentUrl", window.location.href);
      fd.append("userAgent", navigator.userAgent.slice(0, 500));
      if (screenshot) fd.append("screenshot", screenshot);

      const r = await api.post<{ ok: boolean; adminsNotified?: number }>("/api/feedback", fd);
      const notified = r.adminsNotified ?? 0;
      showToast(notified > 0
        ? `Relatório enviado · ${notified} admin${notified === 1 ? "" : "s"} notificado${notified === 1 ? "" : "s"}`
        : "Relatório enviado");
      reset();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro ao enviar: ${msg}`);
    } finally { setSending(false); }
  }

  const senderName = user?.name?.split(" ")[0] ?? user?.email ?? "anônimo";

  return (
    <Modal open={open} onClose={handleClose} title="" size="md">
      <div className="-mt-2 -mb-1">
        <div className="flex items-start gap-2 mb-1">
          <Bug size={20} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-xl font-bold text-sand-50">Reportar problema</h2>
            <p className="text-sm text-sand-100/70 mt-0.5">
              Encontrou um bug ou tem uma sugestão? Nos ajude a melhorar a plataforma.
            </p>
            <p className="text-xs text-sand-100/55 mt-1">
              Enviando como <strong className="text-sand-100/85">{senderName}</strong>
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 mt-5">
          {/* Categoria */}
          <div>
            <label className="field-label">Tipo do problema</label>
            <select
              className="field-input text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              required
              disabled={sending}
            >
              <option value="">Selecione uma categoria</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Descrição */}
          <div>
            <label className="field-label">Descreva o problema</label>
            <textarea
              className="field-input text-sm"
              rows={4}
              minLength={10}
              maxLength={4000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que aconteceu? O que você esperava que acontecesse?"
              required
              disabled={sending}
            />
            <p className="mt-1 text-xs text-sand-100/55">Mínimo 10 caracteres. Quanto mais detalhes, melhor!</p>
          </div>

          {/* Captura de tela */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="field-label !mb-0">Captura de tela</label>
              {(screenshot || capturing) && (
                <button
                  type="button"
                  onClick={() => void retakeScreenshot()}
                  className="text-xs font-semibold text-blue-300 hover:text-blue-200 inline-flex items-center gap-1"
                  disabled={sending || capturing}
                >
                  {capturing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Trocar imagem
                </button>
              )}
            </div>

            {capturing ? (
              <div className="card p-6 text-center text-sand-100/55 inline-flex items-center justify-center gap-2 w-full">
                <Loader2 size={14} className="animate-spin" /> Capturando tela…
              </div>
            ) : previewUrl ? (
              <div className="relative card overflow-hidden">
                <img
                  src={previewUrl}
                  alt="Captura"
                  className="w-full block"
                  style={{ maxHeight: 280, objectFit: "contain", backgroundColor: "var(--app-bg, #0B131F)" }}
                />
                <button
                  type="button"
                  onClick={removeScreenshot}
                  disabled={sending}
                  className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded bg-app-elevated/85 backdrop-blur border hairline text-sand-100/75 hover:text-red-300 hover:border-red-400/40"
                  aria-label="Remover imagem"
                >
                  <XIcon size={13} />
                </button>
                <p className="text-[0.7rem] text-sand-100/55 px-3 py-2 bg-app-subtle/50">
                  Captura automática da tela
                </p>
              </div>
            ) : (
              <div className="card p-4">
                <p className="text-xs text-sand-100/55 mb-2">
                  {captureFailed
                    ? "Não conseguimos capturar a tela automaticamente · anexe uma imagem manualmente se quiser:"
                    : "Nenhuma imagem · você pode anexar uma manualmente:"}
                </p>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={pickManualFile}
                    className="hidden"
                  />
                  <span className="btn-base btn-outline text-xs" style={{ padding: ".4rem .8rem" }}>
                    Anexar imagem
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Botões */}
          <div className="flex justify-end gap-2 pt-4 border-t hairline">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={sending}>Cancelar</Button>
            <Button type="submit" variant="gold" loading={sending}>
              <Send size={14} /> Enviar relatório
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
