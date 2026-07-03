// Chat History (admin) · explora histórico read-only de conversas
// Backend: GET /api/chat-history?limit=&offset= · GET /api/chat-history/:conversationId
// Banco dedicado :5433/chat — pode estar offline (503 chat_db_disabled)
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, MessageSquare, AlertCircle, ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

function fmtPhone(phone?: string | null): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (!d) return phone;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    const part = num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`;
    return `+55 (${ddd}) ${part}`;
  }
  return d.replace(/(\d{2,3})(?=\d)/g, "$1 ").trim();
}

interface ChatConversation {
  id: string;
  crm_user_id?: string | null;
  crm_user_name?: string | null;
  lead_id?: string | null;
  lead_name?: string | null;
  lead_phone_mask?: string | null;
  lead_phone?: string | null;
  vai_chat_id?: string | null;
  vai_contact_id?: string | null;
  status?: string | null;
  first_message_at?: string | null;
  last_message_at?: string | null;
  message_count?: number | null;
}

interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound" | string;
  from_role?: string | null;
  sender_user_id?: string | null;
  sender_name?: string | null;
  content?: string | null;
  content_type?: string | null; // text, audio, image, document, etc
  file_url?: string | null;
  is_note?: boolean | null;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at?: string;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return iso.slice(0, 19); }
}

export function ChatHistorico() {
  const [convs, setConvs] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbDown, setDbDown] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function loadConvs() {
    setLoading(true);
    setDbDown(false);
    try {
      const r = await api.get<{ data: ChatConversation[] }>("/api/chat-history?limit=200");
      setConvs(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("chat_db_disabled") || msg.includes("503")) {
        setDbDown(true);
      } else {
        showToast(`Erro: ${msg}`);
      }
      setConvs([]);
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadConvs(); }, []);

  async function openConv(id: string) {
    setSelectedId(id);
    setLoadingMsgs(true);
    try {
      const r = await api.get<{ data: ChatMessage[] }>(`/api/chat-history/${encodeURIComponent(id)}?limit=500`);
      setMsgs(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
      setMsgs([]);
    } finally { setLoadingMsgs(false); }
  }

  const filteredConvs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter((c) =>
      (c.lead_name ?? "").toLowerCase().includes(q) ||
      (c.crm_user_name ?? "").toLowerCase().includes(q) ||
      (c.lead_phone_mask ?? "").includes(q)
    );
  }, [convs, search]);

  const selectedConv = useMemo(() => convs.find((c) => c.id === selectedId), [convs, selectedId]);

  if (dbDown) {
    return (
      <div className="p-6 md:p-8">
        <PageHeader title="Histórico de chat" description="Banco dedicado :5433/chat" />
        <div className="card p-8 flex items-start gap-3 max-w-2xl">
          <AlertCircle className="text-amber-300 shrink-0 mt-1" size={20} />
          <div>
            <p className="font-semibold text-amber-200 mb-1">Banco de chat history indisponível</p>
            <p className="text-sm text-sand-100/65">
              O backend retornou <code>chat_db_disabled</code>. O Postgres dedicado (:5433/chat) não está conectado
              ou foi desabilitado via env var. Verifique <code>CHAT_DB_URL</code> no servidor.
            </p>
            <Button variant="outline" onClick={loadConvs} className="mt-3"><RefreshCw size={14} /> Tentar novamente</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Histórico de chat"
        description={`${convs.length} conversas no banco dedicado · read-only · ordenado por última mensagem`}
        actions={<Button variant="outline" onClick={loadConvs} loading={loading}><RefreshCw size={14} /> Atualizar</Button>}
      />

      {selectedId ? (
        <ChatDetail
          conversation={selectedConv}
          messages={msgs}
          loading={loadingMsgs}
          onBack={() => { setSelectedId(null); setMsgs([]); }}
        />
      ) : (
        <>
          <div className="card p-3 mb-4">
            <input
              type="text"
              placeholder="Buscar por lead / corretor / telefone…"
              className="field-input text-sm w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
                <tr>
                  <th className="text-left p-3">Lead</th>
                  <th className="text-left p-3">Corretor</th>
                  <th className="text-left p-3">Telefone</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Msgs</th>
                  <th className="text-left p-3">Início</th>
                  <th className="text-left p-3">Última msg</th>
                </tr>
              </thead>
              <tbody>
                {loading && convs.length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
                ) : filteredConvs.length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-sand-100/55">
                    {search ? "Nenhuma conversa bate com a busca." : "Nenhuma conversa no banco de history."}
                  </td></tr>
                ) : filteredConvs.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => void openConv(c.id)}
                    className="border-t hairline hover:bg-app-subtle/40 cursor-pointer"
                  >
                    <td className="p-3 font-semibold">{c.lead_name ?? "—"}</td>
                    <td className="p-3">{c.crm_user_name ?? "—"}</td>
                    <td className="p-3 font-mono text-xs">{fmtPhone(c.lead_phone) || c.lead_phone_mask || "—"}</td>
                    <td className="p-3 text-xs">{c.status ?? "—"}</td>
                    <td className="p-3 text-right text-xs tabular-nums">{c.message_count ?? 0}</td>
                    <td className="p-3 text-xs text-sand-100/55">{fmtDate(c.first_message_at)}</td>
                    <td className="p-3 text-xs text-sand-100/55">{fmtDate(c.last_message_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ChatDetail({ conversation, messages, loading, onBack }: {
  conversation?: ChatConversation;
  messages: ChatMessage[];
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="card overflow-hidden">
      <header className="px-5 py-3 border-b hairline flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sand-100/70 hover:text-gold-400 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft size={16} /> Voltar
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{conversation?.lead_name ?? "—"}</p>
          <p className="text-xs text-sand-100/55">
            {conversation?.crm_user_name ? `${conversation.crm_user_name} · ` : ""}
            {conversation?.message_count ?? messages.length} mensagens
          </p>
        </div>
      </header>

      <div className="p-4 max-h-[70vh] overflow-y-auto bg-app-canvas">
        {loading ? (
          <p className="text-center text-sand-100/55 py-8 text-sm">Carregando mensagens…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sand-100/55 py-8 text-sm">Sem mensagens.</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[80%] rounded p-3 text-sm ${
                  m.direction === "outbound"
                    ? "ml-auto bg-gold-400/15 border border-gold-400/30"
                    : "bg-app-subtle/60 border hairline"
                }`}
              >
                {m.sender_name && (
                  <p className="text-[10px] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-1">
                    {m.sender_name}{m.is_note ? " · NOTA INTERNA" : ""}
                  </p>
                )}
                {m.content_type === "audio" && m.file_url ? (
                  <audio src={resolveBackendUrl(m.file_url)} controls className="w-full max-w-xs" />
                ) : m.content_type === "image" && m.file_url ? (
                  <a href={resolveBackendUrl(m.file_url)} target="_blank" rel="noreferrer">
                    <img src={resolveBackendUrl(m.file_url)} alt="" className="rounded max-h-60 max-w-full" loading="lazy" />
                  </a>
                ) : m.content_type === "document" && m.file_url ? (
                  <a href={resolveBackendUrl(m.file_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gold-300 hover:text-gold-200">
                    <MessageSquare size={12} /> Anexo · {m.file_url.split("/").pop()}
                  </a>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content || "(vazio)"}</p>
                )}
                <p className="text-[10px] text-sand-100/40 mt-1.5 text-right">
                  {fmtDate(m.created_at)}
                  {m.delivered_at ? " · entregue" : ""}
                  {m.read_at ? " · lida" : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
