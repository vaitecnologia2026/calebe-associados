// Aprovação de corretores
// GET   /api/associates/applications?limit=200
// PATCH /api/associates/:id/approve  body { category, segment, tempPassword? }
// PATCH /api/associates/:id/deny     body { reason }
// GET   /api/associates/applications/:id/credential       (ADMIN · Bearer) → arquivo CRECI
// POST  /api/associates/applications/creci-status         (ADMIN) → status IMOBISEC (lote)
// GET   /api/associates/applications/:id/creci-status?fresh=1 (ADMIN) → reconsulta 1
import { useEffect, useState } from "react";
import { Check, X, Eye, ExternalLink, RefreshCw } from "lucide-react";
import { api, getAuth, API_BASE } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";

interface Application {
  id: string;
  name: string;
  email: string;
  phone?: string;
  cpf?: string;
  rg?: string;
  creci?: string;
  creciUf?: string;
  city?: string;
  currentAgency?: string;
  yearsMarket?: number;
  instagram?: string;
  notes?: string;
  credentialUrl?: string | null;
  status: "PENDING" | "APPROVED" | "DENIED" | "REVIEWING";
  denialReason?: string;
  createdAt?: string;
}

// Resultado da pré-consulta IMOBISEC (agregador não-oficial).
interface CreciStatus {
  status: string; // active | inactive | unknown | not_found | error | loading
  rawStatus?: string | null;
  name?: string | null;
  lastProviderUpdate?: string | null;
  checkedAt?: number;
  reason?: string;
  remaining?: string | null;
}

// UF -> página de consulta de inscritos do CRECI regional (sites oficiais).
// UFs não mapeadas caem numa busca que leva ao site oficial da região.
const CRECI_CONSULTA: Record<string, string> = {
  SC: "https://www.crecisc.conselho.net.br/form_pesquisa_cadastro_geral_site.php",
  SP: "https://www.crecisp.gov.br/cidadao/buscaporcorretores",
  RS: "https://www.creci-rs.gov.br/siteNovo/pesquisaInscrito.php",
  PR: "https://www.crecipr.gov.br/pesquisa-credenciados",
  RJ: "https://www.crecirj.conselho.net.br/form_pesquisa_cadastro_geral_site.php",
  SE: "https://crecise.gov.br/pesquisar-corretores-inscritos/",
  PB: "https://creci-pb.gov.br/canal-do-cidadao/pesquisa-de-corretores-credenciados/",
  CE: "https://www.crecice.conselho.net.br/form_pesquisa_cadastro_geral_site.php",
  GO: "https://www.crecigo.conselho.net.br/form_pesquisa_cadastro_geral_site.php",
  MG: "https://crecimg.spiderware.com.br/spw/consultacadastral/TelaConsultaPublicaCompleta.aspx",
};

function creciConsultaUrl(uf?: string | null): string {
  const u = (uf ?? "").trim().toUpperCase();
  if (u && CRECI_CONSULTA[u]) return CRECI_CONSULTA[u];
  const q = encodeURIComponent(`CRECI ${u} consulta de corretores inscritos`.trim());
  return `https://www.google.com/search?q=${q}`;
}

export function Aprovacao() {
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, CreciStatus>>({});
  const [statusConfigured, setStatusConfigured] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Application[] }>("/api/associates/applications?limit=200");
      const data = r.data ?? [];
      setItems(data);
      void loadStatuses(data);
    } finally {
      setLoading(false);
    }
  }

  // Pré-consulta IMOBISEC só dos PENDING com CRECI (controla custo). Não-fatal:
  // se a API não estiver configurada ou falhar, o selo some e o fluxo manual segue.
  async function loadStatuses(apps: Application[]) {
    const ids = apps.filter((a) => a.status === "PENDING" && a.creci).map((a) => a.id);
    if (!ids.length) return;
    try {
      const r = await api.post<{ configured: boolean; results: Record<string, CreciStatus> }>(
        "/api/associates/applications/creci-status",
        { ids },
      );
      setStatusConfigured(!!r.configured);
      if (r.results) setStatuses((prev) => ({ ...prev, ...r.results }));
    } catch {
      /* silencioso: selo opcional */
    }
  }

  async function refreshStatus(id: string) {
    setStatuses((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { status: "loading" }), status: "loading" } }));
    try {
      const r = await api.get<CreciStatus & { id: string }>(
        `/api/associates/applications/${id}/creci-status?fresh=1`,
      );
      setStatuses((prev) => ({ ...prev, [id]: r }));
    } catch {
      setStatuses((prev) => ({ ...prev, [id]: { status: "error" } }));
    }
  }

  // Abre a credencial CRECI pela rota autenticada (Bearer). Abre a aba ANTES
  // do await pra não ser bloqueada por popup-blocker; depois aponta pro blob.
  async function viewCredential(a: Application) {
    if (!a.credentialUrl) return;
    const win = window.open("", "_blank");
    try {
      const url = `${API_BASE}/api/associates/applications/${a.id}/credential`;
      const doFetch = (t?: string) =>
        fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {}, credentials: "include" });
      let res = await doFetch(getAuth()?.accessToken);
      if (res.status === 401) {
        const nt = await api.refresh();
        if (nt) res = await doFetch(nt);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      if (win) win.location.href = blobUrl;
      else window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e: unknown) {
      if (win) win.close();
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro ao abrir credencial: ${msg}`);
    }
  }

  // Copia o número (só dígitos) pro clipboard e abre o site de consulta da UF.
  // AGUARDA a cópia antes de window.open — a nova aba rouba o foco e o clipboard
  // só grava com o documento focado.
  async function consultarCreci(a: Application) {
    const num = (a.creci ?? "").replace(/\D+/g, "");
    const url = creciConsultaUrl(a.creciUf);
    if (num) {
      try {
        await navigator.clipboard.writeText(num);
        showToast(`CRECI ${num} copiado — é só colar no campo de consulta`);
      } catch {
        showToast(`Não consegui copiar — copie manual: ${num}`);
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function approve(id: string) {
    try {
      await api.patch(`/api/associates/${id}/approve`, { category: "BRONZE", segment: "Regional" });
      showToast("Solicitação aprovada");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  async function deny(id: string) {
    const reason = prompt("Motivo da reprovação?");
    if (!reason || !reason.trim()) return;
    try {
      await api.patch(`/api/associates/${id}/deny`, { reason: reason.trim() });
      showToast("Solicitação negada");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  useEffect(() => { void load(); }, []);

  // Selo de status IMOBISEC + botão de reconsulta.
  function statusBadge(a: Application) {
    const s = statuses[a.id];
    const pill = !s ? (
      <StatusPill tone="neutral">…</StatusPill>
    ) : s.status === "active" ? (
      <StatusPill tone="success">✓ Ativo</StatusPill>
    ) : s.status === "inactive" ? (
      <StatusPill tone="danger">✗ Inativo</StatusPill>
    ) : s.status === "not_found" ? (
      <StatusPill tone="warning">Não achado</StatusPill>
    ) : s.status === "loading" ? (
      <StatusPill tone="neutral">…</StatusPill>
    ) : s.status === "error" ? (
      <StatusPill tone="neutral">Erro</StatusPill>
    ) : (
      <StatusPill tone="info">?</StatusPill>
    );
    const when = s?.checkedAt ? new Date(s.checkedAt).toLocaleDateString("pt-BR") : "";
    const tip = `Fonte IMOBISEC (não-oficial — conferir no site) · ${s?.rawStatus ?? s?.reason ?? s?.status ?? "—"}${when ? " · " + when : ""}`;
    return (
      <span title={tip} style={{ display: "inline-flex", alignItems: "center", gap: ".3rem" }}>
        {pill}
        <button type="button" onClick={() => refreshStatus(a.id)} title="Reconsultar (gasta 1 crédito)" style={{ opacity: 0.55, lineHeight: 0, background: "none", border: 0, cursor: "pointer", padding: 0 }}>
          <RefreshCw size={11} />
        </button>
      </span>
    );
  }

  const statusCol: Column<Application> = {
    key: "creci-status", header: "CRECI (IMOBISEC)",
    render: (a) => (a.creci ? statusBadge(a) : <span style={{ opacity: 0.4 }}>—</span>),
  };

  const cols: Column<Application>[] = [
    {
      key: "name", header: "Candidato",
      render: (a) => (
        <div>
          <p className="font-semibold">{a.name}</p>
          <p className="text-xs text-sand-100/55">{a.email}</p>
        </div>
      ),
    },
    { key: "phone", header: "Telefone", render: (a) => a.phone ?? "—" },
    { key: "creci", header: "CRECI", render: (a) => a.creci ? `${a.creci}/${a.creciUf ?? "—"}` : "—" },
    ...(statusConfigured ? [statusCol] : []),
    { key: "city", header: "Cidade", render: (a) => a.city ?? "—" },
    { key: "createdAt", header: "Cadastro", render: (a) => a.createdAt ? new Date(a.createdAt).toLocaleDateString("pt-BR") : "—" },
    {
      key: "status", header: "Status",
      render: (a) => {
        const pill =
          a.status === "PENDING"  ? <StatusPill tone="warning">Pendente</StatusPill> :
          a.status === "APPROVED" ? <StatusPill tone="success">Aprovado</StatusPill> :
          a.status === "DENIED"   ? <StatusPill tone="danger">Negado</StatusPill> :
          <StatusPill tone="info">Em análise</StatusPill>;
        const reason = a.status === "DENIED" && a.denialReason?.trim();
        return (
          <div className="leading-tight">
            {pill}
            {reason && (
              <p className="text-[11px] mt-1 text-red-300/90 leading-snug max-w-[280px]" title={reason}>
                <span className="font-semibold">Motivo:</span> {reason.length > 90 ? reason.slice(0, 90) + "…" : reason}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "actions", header: "", align: "right",
      render: (a) => (
        <div className="flex gap-1.5 justify-end">
          {a.credentialUrl && (
            <button type="button" onClick={() => viewCredential(a)} className="btn-base btn-outline" style={{ padding: ".4rem .55rem" }} title="Visualizar credencial CRECI (acesso protegido)">
              <Eye size={14} />
            </button>
          )}
          {a.creci && (
            <button type="button" onClick={() => consultarCreci(a)} className="btn-base btn-outline" style={{ padding: ".4rem .55rem" }} title={`Consultar ${a.creci}/${a.creciUf ?? "—"} no site do CRECI (nº copiado)`}>
              <ExternalLink size={14} />
            </button>
          )}
          {a.status === "PENDING" && (
            <>
              <Button variant="gold" onClick={() => approve(a.id)} style={{ padding: ".4rem .8rem", fontSize: ".75rem" }}>
                <Check size={14} /> Aprovar
              </Button>
              <Button variant="danger" onClick={() => deny(a.id)} style={{ padding: ".4rem .8rem", fontSize: ".75rem" }}>
                <X size={14} /> Negar
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Aprovação de corretores"
        description="Solicitações de adesão ao programa · análise da documentação CRECI"
      />
      {loading && items.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
      ) : (
        <DataTable rows={items} columns={cols} rowKey={(a) => a.id} empty="Nenhuma solicitação pendente." />
      )}
    </div>
  );
}
