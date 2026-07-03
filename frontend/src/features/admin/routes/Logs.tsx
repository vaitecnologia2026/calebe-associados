// Logs · auditoria de ações admin
// Backend: GET /api/dev/audit?limit=200&action=&since= (autoriza ADMIN+DEV)
// Retorna { data: [{ id, action, entity, actor, actorRole, ipAddress, metadata, createdAt }] }
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";

interface AuditLog {
  id: string;
  action?: string;
  entity?: string | null;
  actor?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  metadata?: unknown;
  createdAt?: string;
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return iso.slice(0, 19); }
}

export function Logs() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState("");
  const [limit, setLimit] = useState(200);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (actionFilter.trim()) qs.set("action", actionFilter.trim());
      const r = await api.get<{ data: AuditLog[]; total: number }>(`/api/dev/audit?${qs}`);
      setItems(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const cols: Column<AuditLog>[] = [
    { key: "createdAt", header: "Quando", render: (l) => <span className="text-xs whitespace-nowrap">{fmtDate(l.createdAt)}</span> },
    { key: "actor", header: "Ator", render: (l) => (
      <div className="text-xs leading-tight">
        <div>{l.actor ?? "—"}</div>
        {l.actorRole && <div className="text-sand-100/55">{l.actorRole}</div>}
      </div>
    )},
    { key: "action", header: "Ação", render: (l) => <code className="text-xs text-gold-300 font-semibold">{l.action ?? "—"}</code> },
    { key: "entity", header: "Entidade", render: (l) => <code className="text-xs text-sand-100/75">{l.entity ?? "—"}</code> },
    { key: "ipAddress", header: "IP", render: (l) => <span className="text-xs text-sand-100/55">{l.ipAddress ?? "—"}</span> },
    { key: "metadata", header: "Detalhes", render: (l) => l.metadata ? (
      <details className="text-xs">
        <summary className="cursor-pointer text-sand-100/55 hover:text-sand-100/85">ver</summary>
        <pre className="mt-1 text-[10px] bg-app-subtle/40 p-2 rounded max-w-xs overflow-x-auto">{JSON.stringify(l.metadata, null, 2)}</pre>
      </details>
    ) : <span className="text-xs text-sand-100/30">—</span> },
  ];

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Logs"
        description="Auditoria de ações administrativas (audit events do backend)"
        actions={
          <Button variant="outline" onClick={load} loading={loading}>
            <RefreshCw size={14} /> Atualizar
          </Button>
        }
      />

      <div className="card p-3 mb-4 flex gap-2 flex-wrap items-center">
        <input
          type="text"
          className="field-input text-sm flex-1 min-w-[200px]"
          placeholder="Filtrar por ação (ex: ASSOCIATE_APPROVED, COMMISSION_PAID)…"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
        />
        <select
          className="field-input text-sm"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          <option value={100}>Últimos 100</option>
          <option value={200}>Últimos 200</option>
          <option value={500}>Últimos 500</option>
          <option value={1000}>Últimos 1000</option>
        </select>
        <Button variant="outline" onClick={load} loading={loading}>Aplicar</Button>
      </div>

      <DataTable
        rows={items}
        columns={cols}
        rowKey={(l) => l.id}
        empty="Nenhum log encontrado com os filtros atuais."
      />
    </div>
  );
}
