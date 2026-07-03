// Configuração de Notificações (admin) — toggle por evento do sistema.
// Backend: GET /api/notifications/push-settings · PUT /api/notifications/push-settings/:key
// Cada item = 1 evento push (push nativo FCM/APNs + Web Push). Default isActive=true.
// Quando off, o guard em services/push.js#sendPushToUser bloqueia o disparo.
import { useEffect, useMemo, useState } from "react";
import { Bell, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

interface PushSetting {
  key: string;
  label: string;
  description: string;
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
interface ListResp { data: PushSetting[] }

const CATEGORY_ORDER = [
  "Leads",
  "Vendas",
  "Comissões",
  "Telefones",
  "Visitas",
  "Imóveis",
  "Avisos",
  "Suporte/Admin",
];

function categoryRank(c: string): number {
  const idx = CATEGORY_ORDER.indexOf(c);
  return idx === -1 ? 999 : idx;
}

export function NotificacoesConfig() {
  const [items, setItems] = useState<PushSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const r = await api.get<ListResp>("/api/notifications/push-settings");
      setItems(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      showToast(`Erro ao carregar: ${msg}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function toggle(it: PushSetting) {
    const nextActive = !it.isActive;
    setBusyKey(it.key);
    // Atualização otimista — reverte se falhar.
    setItems((prev) => prev.map((p) => (p.key === it.key ? { ...p, isActive: nextActive } : p)));
    try {
      await api.put<PushSetting>(
        `/api/notifications/push-settings/${encodeURIComponent(it.key)}`,
        { isActive: nextActive },
      );
      showToast(nextActive ? `"${it.label}" ativado` : `"${it.label}" desativado`);
    } catch (e: unknown) {
      // Reverte estado em caso de erro.
      setItems((prev) => prev.map((p) => (p.key === it.key ? { ...p, isActive: it.isActive } : p)));
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro ao salvar: ${msg}`);
    } finally {
      setBusyKey(null);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, PushSetting[]>();
    for (const it of items) {
      const arr = m.get(it.category) ?? [];
      arr.push(it);
      m.set(it.category, arr);
    }
    return [...m.entries()]
      .map(([cat, arr]) => ({
        category: cat,
        items: arr.slice().sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      }))
      .sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  }, [items]);

  const counts = useMemo(() => ({
    total: items.length,
    active: items.filter((i) => i.isActive).length,
  }), [items]);

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <PageHeader
        eyebrow="Administração"
        title="Configuração de Notificações"
        description="Ligue ou desligue, por evento, as notificações push enviadas pro aplicativo dos usuários (Android e iOS). Mudanças entram em vigor em até 1 minuto."
        actions={
          <Button variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void load()} disabled={loading}>
            Recarregar
          </Button>
        }
      />

      <div className="flex items-center gap-3 mb-4 text-sm text-sand-100/70">
        <span className="inline-flex items-center gap-1.5">
          <Bell size={14} className="text-gold-300" />
          {counts.active} de {counts.total} eventos ativos
        </span>
      </div>

      {errorMsg && !loading && items.length === 0 && (
        <div className="rounded border border-danger/40 bg-danger/10 text-danger px-4 py-3 text-sm">
          Falha ao carregar: {errorMsg}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="text-sand-100/65 text-sm py-8">Carregando…</div>
      )}

      {!loading && items.length === 0 && !errorMsg && (
        <div className="text-sand-100/65 text-sm py-8">Nenhum evento cadastrado.</div>
      )}

      <div className="space-y-6">
        {grouped.map((g) => (
          <section key={g.category}>
            <h2 className="text-[0.65rem] uppercase tracking-mono-xwide font-medium text-sand-100/45 mb-2 px-1">
              {g.category}
            </h2>
            <ul className="space-y-1.5">
              {g.items.map((it) => {
                const busy = busyKey === it.key;
                return (
                  <li
                    key={it.key}
                    className="flex items-start justify-between gap-4 rounded border hairline bg-app-elevated/70 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-sand-50">{it.label}</p>
                      <p className="text-xs text-sand-100/65 mt-0.5">{it.description}</p>
                      <p className="text-[0.65rem] font-mono text-sand-100/40 mt-1">{it.key}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={it.isActive}
                      aria-label={`${it.isActive ? "Desativar" : "Ativar"} ${it.label}`}
                      onClick={() => void toggle(it)}
                      disabled={busy}
                      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        it.isActive ? "bg-gold-400" : "bg-app-subtle"
                      } ${busy ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-sand-50 shadow-sm transition-transform ${
                          it.isActive ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
