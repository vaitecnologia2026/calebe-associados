// Modal de Template Oficial Meta · envia mensagem aprovada pela Meta pra reabrir
// janela do WhatsApp quando o lead não respondeu nas últimas 24h.
//
// Backend:
//   GET  /api/whatsapp/templates  → { data: [{ name, language, category, status, components }] }
//   POST /api/whatsapp/conversations/:id/send-template
//        body: { templateName, languageCode, bodyParams: string[] }
//
// Cada template tem `components` com type=BODY contendo `text` que pode ter `{{1}}`, `{{2}}`...
// O modal extrai os placeholders e gera inputs dinâmicos.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Send, Sparkles, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { useAuth } from "@/store/auth";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

// Templates em que {{1}} = nome do CORRETOR e {{2}} = nome do LEAD (ordem invertida)
const CORRETOR_FIRST = new Set(["calebe_corretor_apresenta", "calebe_corretora_apresenta"]);

type ComponentType = "HEADER" | "BODY" | "FOOTER" | "BUTTONS";

interface TemplateComponent {
  type: ComponentType | string;
  text?: string;
  format?: string; // pra HEADER pode ser TEXT/IMAGE/VIDEO/DOCUMENT
  buttons?: { type?: string; text?: string; url?: string }[];
}

interface MetaTemplate {
  name: string;
  language: string;
  category?: string;
  status?: string;
  qualityScore?: string | null;
  components?: TemplateComponent[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** ID da Conversation alvo */
  conversationId: string;
  /** Nome do lead pra pré-preencher `{{1}}` se o template tiver placeholders */
  leadName?: string;
  /** Callback após envio bem-sucedido */
  onSent?: (info: { templateName: string; messageId: string }) => void;
}

function extractPlaceholders(text: string): number[] {
  const matches = [...text.matchAll(/\{\{(\d+)\}\}/g)];
  const set = new Set<number>();
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function renderPreview(text: string, params: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = params[Number(n) - 1];
    return v != null && v.trim() ? v : `{{${n}}}`;
  });
}

function firstName(name?: string): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

export function MetaTemplateModal({ open, onClose, conversationId, leadName, onSent }: Props) {
  const showToast = useUi((s) => s.showToast);
  const me = useAuth((s) => s.user);

  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTpls, setLoadingTpls] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  // Carrega templates quando abre o modal
  useEffect(() => {
    if (!open) return;
    setLoadingTpls(true);
    setTplError(null);
    (async () => {
      try {
        const r = await api.get<{ data: MetaTemplate[]; total?: number }>("/api/whatsapp/templates");
        const list = r.data ?? [];
        setTemplates(list);
        // Auto-seleciona o primeiro
        if (list.length && !selectedName) setSelectedName(list[0].name);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("disabled") || msg.includes("503")) {
          setTplError("WhatsApp Cloud não está habilitado. Avise o admin pra configurar em Configurações → Integrações.");
        } else {
          setTplError(`Falha ao carregar templates: ${msg}`);
        }
      } finally { setLoadingTpls(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = useMemo(
    () => templates.find((t) => t.name === selectedName) ?? null,
    [templates, selectedName],
  );

  // Componente BODY do template selecionado
  const bodyComponent = useMemo(
    () => (selected?.components ?? []).find((c) => (c.type || "").toUpperCase() === "BODY"),
    [selected],
  );
  const headerComponent = useMemo(
    () => (selected?.components ?? []).find((c) => (c.type || "").toUpperCase() === "HEADER"),
    [selected],
  );
  const footerComponent = useMemo(
    () => (selected?.components ?? []).find((c) => (c.type || "").toUpperCase() === "FOOTER"),
    [selected],
  );
  const buttonsComponent = useMemo(
    () => (selected?.components ?? []).find((c) => (c.type || "").toUpperCase() === "BUTTONS"),
    [selected],
  );

  const placeholders = useMemo(
    () => extractPlaceholders(bodyComponent?.text ?? ""),
    [bodyComponent],
  );

  // Quando muda template, reset params + autofill com base no tipo do template.
  // Para calebe_corretor/corretora_apresenta: {{1}}=corretor, {{2}}=lead.
  // Para todos os outros: {{1}}=lead (padrão).
  useEffect(() => {
    if (!selected) { setParams([]); return; }
    const leadFirst  = firstName(leadName);
    const meFirst    = firstName(me?.name);
    const isCorretorFirst = CORRETOR_FIRST.has(selected.name);
    const next = placeholders.map((n) => {
      if (isCorretorFirst) return n === 1 ? meFirst : n === 2 ? leadFirst : "";
      return n === 1 && leadFirst ? leadFirst : "";
    });
    setParams(next);
  }, [selected, placeholders, leadName, me?.name]);

  function updateParam(idx: number, value: string) {
    setParams((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  const previewText = useMemo(
    () => renderPreview(bodyComponent?.text ?? "", params),
    [bodyComponent, params],
  );

  const allFilled = placeholders.every((_, i) => (params[i] ?? "").trim().length > 0);
  const canSend = !!selected && allFilled && !sending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) { showToast("Selecione um template"); return; }
    if (!allFilled) { showToast("Preencha todos os campos do template"); return; }

    setSending(true);
    try {
      const resp = await api.post<{ ok: boolean; messageId: string; whatsappMessageId?: string; templateName: string }>(
        `/api/whatsapp/conversations/${conversationId}/send-template`,
        {
          templateName: selected.name,
          languageCode: selected.language,
          bodyParams:   params,
        },
      );
      showToast(`Template "${selected.name}" enviado ao lead`);
      onSent?.({ templateName: resp.templateName, messageId: resp.messageId });
      handleClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("phone_unavailable")) {
        showToast("Telefone do lead indisponível · peça liberação ao admin primeiro");
      } else if (msg.includes("send_failed")) {
        showToast(`Falha no envio · Meta rejeitou: ${msg}`);
      } else if (msg.includes("whatsapp_cloud_disabled")) {
        showToast("WhatsApp Cloud não está habilitado · contate o admin");
      } else {
        showToast(`Erro: ${msg}`);
      }
    } finally { setSending(false); }
  }

  function handleClose() {
    if (sending) return;
    setSelectedName("");
    setParams([]);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Enviar template oficial Meta" size="md">
      <p className="text-sm text-sand-100/70 mb-5">
        Templates são mensagens pré-aprovadas pela Meta que <strong>garantem entrega</strong> via WhatsApp,
        mesmo quando o lead ainda não respondeu ou a janela de 24h está fechada.
      </p>

      {loadingTpls ? (
        <div className="card p-8 text-center text-sand-100/55 inline-flex items-center justify-center gap-2 w-full">
          <Loader2 size={16} className="animate-spin" /> Carregando templates aprovados…
        </div>
      ) : tplError ? (
        <div className="card p-5 border-red-400/30 bg-red-500/10">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-red-300 shrink-0 mt-0.5" />
            <p className="text-sm text-red-100/90">{tplError}</p>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <div className="card p-8 text-center text-sand-100/55">
          Nenhum template aprovado disponível. Avise o admin pra cadastrar templates na Meta Business.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {/* Seletor de template */}
          <div>
            <label className="field-label">Template *</label>
            <div className="relative">
              <select
                className="field-input text-sm appearance-none pr-8"
                value={selectedName}
                onChange={(e) => setSelectedName(e.target.value)}
                disabled={sending}
                required
              >
                {templates.map((t) => (
                  <option key={`${t.name}-${t.language}`} value={t.name}>
                    {t.name} · {t.language}
                    {t.category ? ` · ${t.category}` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-sand-100/55 pointer-events-none" />
            </div>
          </div>

          {/* Inputs dos placeholders */}
          {selected && placeholders.length > 0 && (
            <div className="space-y-3">
              <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-400">
                Personalização ({placeholders.length} campo{placeholders.length === 1 ? "" : "s"})
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {placeholders.map((n, i) => {
                  const isCorretorFirst = selected && CORRETOR_FIRST.has(selected.name);
                  const lbl = isCorretorFirst
                    ? n === 1 ? "Seu nome (corretor)" : n === 2 ? "Nome do cliente" : `Campo {{${n}}}`
                    : n === 1 && leadName ? "Nome do cliente (pré-preenchido)" : `Campo {{${n}}}`;
                  const ph = isCorretorFirst
                    ? n === 1 ? firstName(me?.name) || "Seu nome" : n === 2 ? firstName(leadName) || "Nome do cliente" : "Digite aqui"
                    : n === 1 ? firstName(leadName) || "Digite aqui" : "Digite aqui";
                  return (
                    <Field
                      key={n}
                      label={lbl}
                      value={params[i] ?? ""}
                      onChange={(e) => updateParam(i, e.target.value)}
                      required
                      disabled={sending}
                      placeholder={ph}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview da mensagem */}
          {selected && bodyComponent?.text && (
            <div>
              <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-400 mb-2">
                Preview da mensagem que o lead vai receber
              </p>
              <div className="card p-4 bg-emerald-500/5 border-emerald-400/30">
                {/* Header (se TEXT) */}
                {headerComponent?.format === "TEXT" && headerComponent.text && (
                  <p className="text-sm font-bold text-sand-50 mb-2">{headerComponent.text}</p>
                )}
                {headerComponent?.format && headerComponent.format !== "TEXT" && (
                  <p className="text-xs text-sand-100/55 italic mb-2">[Mídia: {headerComponent.format.toLowerCase()}]</p>
                )}

                {/* Body com placeholders substituídos */}
                <p className="text-sm text-sand-50 whitespace-pre-wrap leading-relaxed">{previewText}</p>

                {/* Footer */}
                {footerComponent?.text && (
                  <p className="text-xs text-sand-100/55 mt-3 pt-2 border-t hairline">{footerComponent.text}</p>
                )}

                {/* Buttons */}
                {buttonsComponent?.buttons && buttonsComponent.buttons.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t hairline">
                    {buttonsComponent.buttons.map((b, i) => (
                      <span
                        key={`${b.text}-${i}`}
                        className="inline-flex items-center text-xs font-semibold text-emerald-300 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-400/30"
                      >
                        {b.text ?? "Botão"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t hairline">
            <p className="text-[0.7rem] text-sand-100/55 inline-flex items-center gap-1.5">
              <Sparkles size={12} className="text-gold-400" />
              Template "{selected?.name ?? "—"}" · idioma {selected?.language ?? "—"}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={sending}>Cancelar</Button>
              <Button type="submit" variant="gold" loading={sending} disabled={!canSend}>
                <Send size={14} /> Enviar template
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
