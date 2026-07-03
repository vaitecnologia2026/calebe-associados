// Painel DEV · Audit logs gerais
// GET /api/dev/audit?limit=200&action=...
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  actor: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
interface Resp { data: AuditEntry[]; total: number }

function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

// Tom da pill baseado em padrões de action
function actionTone(action: string): string {
  if (action.includes("FAIL") || action.includes("ERROR") || action.includes("DENIED")) return "text-red-300 bg-red-500/10 border-red-400/30";
  if (action.includes("DELETE") || action.includes("DESTROY") || action.includes("LOST"))  return "text-orange-300 bg-orange-500/10 border-orange-400/30";
  if (action.includes("CREATE") || action.includes("APPROVED") || action.includes("SENT")) return "text-emerald-300 bg-emerald-500/10 border-emerald-400/30";
  if (action.includes("LOGIN") || action.includes("AUTH"))                                  return "text-blue-300 bg-blue-500/10 border-blue-400/30";
  if (action.includes("FEEDBACK") || action.includes("BUG"))                                return "text-purple-300 bg-purple-500/10 border-purple-400/30";
  return "text-sand-100/75 bg-sand-100/5 border-sand-100/15";
}

export function DevLogs() {
  const [list, setList] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const url = actionFilter
        ? `/api/dev/audit?limit=500&action=${encodeURIComponent(actionFilter)}`
        : "/api/dev/audit?limit=500";
      const r = await api.get<Resp>(url);
      setList(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [actionFilter]);

  const actions = useMemo(
    () => [...new Set(list.map((l) => l.action))].sort(),
    [list],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return list;
    return list.filter((l) =>
      l.action.toLowerCase().includes(q) ||
      l.entity.toLowerCase().includes(q) ||
      (l.actor ?? "").toLowerCase().includes(q)
    );
  }, [list, search]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Audit Logs"
        description={`${list.length} eventos · cada ação administrativa é registrada de forma imutável (triggers Postgres impedem UPDATE/DELETE)`}
        actions={<Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>}
      />

      <div className="grid sm:grid-cols-[1fr_auto] gap-2 mb-4">
        <input
          type="text"
          placeholder="Buscar action, entity, actor…"
          className="field-input text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="field-input text-sm"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">Todas actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Quando</th>
              <th className="text-left p-3">Action</th>
              <th className="text-left p-3">Entity</th>
              <th className="text-left p-3">Actor</th>
              <th className="text-left p-3">IP</th>
              <th className="text-left p-3">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-sand-100/55">
                  <ScrollText className="mx-auto mb-2 text-sand-100/35" size={26} />
                  Nenhum log encontrado.
                </td>
              </tr>
            ) : filtered.map((l) => (
              <tr key={l.id} className="border-t hairline align-top">
                <td className="p-3 text-xs whitespace-nowrap text-sand-100/75">{fmtDateTime(l.createdAt)}</td>
                <td className="p-3">
                  <span className={`text-[0.62rem] uppercase tracking-mono-wide font-bold px-2 py-1 rounded-full border ${actionTone(l.action)}`}>
                    {l.action}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs text-sand-100/85 max-w-[200px] truncate" title={l.entity}>{l.entity}</td>
                <td className="p-3 text-xs">
                  <p className="text-sand-50">{l.actor ?? "—"}</p>
                  {l.actorRole && <p className="text-[10px] text-sand-100/55">{l.actorRole}</p>}
                </td>
                <td className="p-3 text-[11px] text-sand-100/55 font-mono">{l.ipAddress ?? "—"}</td>
                <td className="p-3 max-w-md">
                  {l.metadata && Object.keys(l.metadata).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-gold-300 hover:text-gold-200">Ver JSON</summary>
                      <pre className="mt-1 p-2 bg-app-canvas/50 rounded text-[10px] text-sand-100/75 overflow-x-auto max-h-32">
                        {JSON.stringify(l.metadata, null, 2)}
                      </pre>
                    </details>
                  ) : <span className="text-sand-100/35 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
