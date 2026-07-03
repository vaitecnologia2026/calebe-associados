// Corretores · admin
// GET   /api/associates?limit=5000
// GET   /api/associates/:id                          (carrega detalhes + application)
// PATCH /api/associates/:id/category                 body { category: BRONZE|SILVER|GOLD|DIAMOND }
// PATCH /api/associates/:id/segment                  body { segment: "Alto padrão"|"Investidor"|"Lançamentos"|"Regional" }
// PATCH /api/associates/:id/status                   body { status: APPROVED|INACTIVE, reason? }
// POST  /api/associates/:id/transfer-leads           body { destinationAssociateId: string | null }
import { useEffect, useMemo, useState } from "react";
import { Pencil, Power, PlayCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { Associate, AssociateCategory, AssociateStatus } from "@/types/lead";

const CATEGORY_TONE: Record<AssociateCategory, "neutral" | "gold" | "info" | "success"> = {
  BRONZE: "neutral",
  SILVER: "info",
  GOLD: "gold",
  DIAMOND: "success",
};
const CATEGORY_LABEL: Record<AssociateCategory, string> = {
  BRONZE: "Bronze", SILVER: "Prata", GOLD: "Ouro", DIAMOND: "Diamante",
};
const CATEGORY_QUOTA: Record<AssociateCategory, number> = {
  BRONZE: 1, SILVER: 2, GOLD: 3, DIAMOND: 5,
};
const STATUS_LABEL: Record<AssociateStatus, string> = {
  APPROVED: "Ativo",
  INACTIVE: "Inativo",
  PENDING:  "Pendente",
  DENIED:   "Negado",
};
const STATUS_TONE: Record<AssociateStatus, "success" | "danger" | "warning" | "neutral"> = {
  APPROVED: "success",
  INACTIVE: "danger",
  PENDING:  "warning",
  DENIED:   "neutral",
};
const SEGMENTOS = ["Alto padrão", "Investidor", "Lançamentos", "Regional"] as const;

interface AssociateDetail extends Associate {
  application?: {
    id?: string;
    phone?: string;
    cpf?: string;
    rg?: string;
    city?: string;
    currentAgency?: string;
    yearsMarket?: number;
    instagram?: string;
    notes?: string;
    credentialUrl?: string | null;
  } | null;
}

export function Corretores() {
  const [list, setList] = useState<Associate[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | AssociateStatus>("");
  const [catFilter, setCatFilter] = useState<"" | AssociateCategory>("");

  const [editing, setEditing] = useState<AssociateDetail | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editCat, setEditCat] = useState<AssociateCategory>("BRONZE");
  const [editSeg, setEditSeg] = useState<string>("Regional");
  const [saving, setSaving] = useState(false);

  const [deactivating, setDeactivating] = useState<Associate | null>(null);
  const [deactDest, setDeactDest] = useState<"queue" | "transfer">("queue");
  const [deactTarget, setDeactTarget] = useState<string>("");
  const [deactReason, setDeactReason] = useState("");
  const [deactBusy, setDeactBusy] = useState(false);

  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Associate[] }>("/api/associates?limit=5000");
      setList(r.data ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return list.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (catFilter && a.category !== catFilter) return false;
      if (term) {
        const hay = `${a.user?.name ?? ""} ${a.user?.email ?? ""} ${a.phone ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [list, q, statusFilter, catFilter]);

  const ativos = list.filter((a) => a.status === "APPROVED").length;

  async function openEdit(a: Associate) {
    setEditing(a);
    setEditCat(a.category);
    setEditSeg(a.segment ?? "Regional");
    setEditLoading(true);
    try {
      const full = await api.get<AssociateDetail>(`/api/associates/${a.id}`);
      setEditing(full);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Falha ao carregar cadastro: ${msg}`);
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const original = list.find((x) => x.id === editing.id);
    if (!original) return;
    setSaving(true);
    try {
      if (editCat !== original.category) {
        await api.patch(`/api/associates/${editing.id}/category`, { category: editCat });
      }
      if (editSeg !== (original.segment ?? "")) {
        await api.patch(`/api/associates/${editing.id}/segment`, { segment: editSeg });
      }
      showToast(`${editing.user?.name ?? "Corretor"} atualizado · ${CATEGORY_LABEL[editCat]} · ${editSeg}`);
      setEditing(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  function openDeactivate(a: Associate) {
    setDeactivating(a);
    setDeactDest("queue");
    setDeactTarget("");
    setDeactReason("");
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    const destId = deactDest === "transfer" ? deactTarget : null;
    if (deactDest === "transfer" && !destId) {
      showToast("Selecione o corretor destino");
      return;
    }
    setDeactBusy(true);
    try {
      // 1. Transfere ou devolve leads (sempre antes do status, pra não perder atribuição)
      const tx = await api.post<{ ok: boolean; transferred: number; mode: string }>(
        `/api/associates/${deactivating.id}/transfer-leads`,
        { destinationAssociateId: destId },
      );
      // 2. Marca o corretor como INACTIVE
      await api.patch(`/api/associates/${deactivating.id}/status`, {
        status: "INACTIVE",
        reason: deactReason.trim() || undefined,
      });
      const what = destId
        ? `${tx.transferred} lead(s) transferidos`
        : `${tx.transferred} lead(s) devolvidos à fila`;
      showToast(`${deactivating.user?.name ?? "Corretor"} desativado · ${what}`);
      setDeactivating(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally {
      setDeactBusy(false);
    }
  }

  async function reactivate(a: Associate) {
    if (!window.confirm(`Reativar ${a.user?.name ?? "esse corretor"}?`)) return;
    try {
      const r = await api.patch<{ id: string; status: string; leadsRestored?: number }>(
        `/api/associates/${a.id}/status`,
        { status: "APPROVED" },
      );
      const restored = r.leadsRestored ?? 0;
      showToast(restored > 0
        ? `${a.user?.name ?? "Corretor"} reativado · ${restored} lead(s) restaurados`
        : `${a.user?.name ?? "Corretor"} reativado`);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  const cols: Column<Associate>[] = [
    {
      key: "name", header: "Corretor",
      render: (a) => (
        <div>
          <p className="font-semibold">{a.user?.name ?? "—"}</p>
          <p className="text-xs text-sand-100/55">{a.user?.email ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "phone", header: "Contato",
      render: (a) => {
        const raw = a.whatsapp ?? a.phone ?? "";
        const digits = raw.replace(/\D/g, "");
        const waLink = digits ? `https://wa.me/${digits.startsWith("55") ? digits : "55" + digits}` : null;
        return (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-mono">{raw || "—"}</span>
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-400 hover:text-emerald-300 w-fit"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.122.551 4.116 1.512 5.848L.057 23.427a.75.75 0 00.956.956l5.58-1.455A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.75 9.75 0 01-4.962-1.354l-.355-.214-3.683.961.979-3.578-.233-.37A9.75 9.75 0 1112 21.75z"/>
                </svg>
                Chamar
              </a>
            )}
          </div>
        );
      },
    },
    {
      key: "seg", header: "Segmento",
      render: (a) => a.segment ?? "—",
    },
    {
      key: "cat", header: "Categoria",
      render: (a) => (
        <StatusPill tone={CATEGORY_TONE[a.category] ?? "neutral"}>
          {CATEGORY_LABEL[a.category] ?? a.category}
        </StatusPill>
      ),
    },
    { key: "leads", header: "Leads hoje", render: (a) => a.leadsHoje ?? 0, align: "right" },
    { key: "vendas", header: "Vendas", render: (a) => a.vendas ?? 0, align: "right" },
    {
      key: "status", header: "Status",
      render: (a) => {
        const pill = (
          <StatusPill tone={STATUS_TONE[a.status] ?? "neutral"}>
            {STATUS_LABEL[a.status] ?? a.status}
          </StatusPill>
        );
        if (a.status === "INACTIVE" && a.blockReason) {
          return (
            <div className="leading-tight">
              {pill}
              <p className="text-[11px] mt-1 text-red-300/80 max-w-[220px]" title={a.blockReason}>
                {a.blockReason.length > 60 ? a.blockReason.slice(0, 60) + "…" : a.blockReason}
              </p>
            </div>
          );
        }
        return pill;
      },
    },
    {
      key: "act", header: "", align: "right",
      render: (a) => (
        <div className="flex gap-1.5 justify-end">
          <button
            type="button"
            className="text-xs uppercase tracking-mono-wide font-semibold text-sand-100/70 hover:text-sand-50 inline-flex items-center gap-1"
            onClick={() => void openEdit(a)}
            title="Editar categoria e segmento"
          >
            <Pencil size={12} /> Editar
          </button>
          {a.status === "INACTIVE" ? (
            <button
              type="button"
              className="text-xs uppercase tracking-mono-wide font-semibold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1"
              onClick={() => void reactivate(a)}
              title="Reativar corretor"
            >
              <PlayCircle size={12} /> Reativar
            </button>
          ) : a.status === "APPROVED" ? (
            <button
              type="button"
              className="text-xs uppercase tracking-mono-wide font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1"
              onClick={() => openDeactivate(a)}
              title="Desativar corretor"
            >
              <Power size={12} /> Desativar
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  // Destinatários possíveis pra transferência (mesmo segmento primeiro)
  const transferOptions = useMemo(() => {
    if (!deactivating) return { same: [] as Associate[], others: [] as Associate[] };
    const allActive = list.filter((x) => x.id !== deactivating.id && x.status === "APPROVED");
    return {
      same:   allActive.filter((x) => x.segment === deactivating.segment),
      others: allActive.filter((x) => x.segment !== deactivating.segment),
    };
  }, [list, deactivating]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Corretores"
        description={`${list.length} cadastrados · ${ativos} ativos`}
      />

      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 mb-4">
        <input
          type="text"
          placeholder="Buscar nome, email ou telefone…"
          className="field-input text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="field-input text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | AssociateStatus)}>
          <option value="">Todos status</option>
          <option value="APPROVED">Ativo</option>
          <option value="INACTIVE">Inativo</option>
          <option value="PENDING">Pendente</option>
          <option value="DENIED">Negado</option>
        </select>
        <select className="field-input text-sm" value={catFilter} onChange={(e) => setCatFilter(e.target.value as "" | AssociateCategory)}>
          <option value="">Todas categorias</option>
          <option value="BRONZE">Bronze</option>
          <option value="SILVER">Prata</option>
          <option value="GOLD">Ouro</option>
          <option value="DIAMOND">Diamante</option>
        </select>
      </div>

      {loading && filtered.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
      ) : (
        <DataTable rows={filtered} columns={cols} rowKey={(a) => a.id} />
      )}

      {/* Modal Editar */}
      <Modal open={!!editing} onClose={() => !saving && setEditing(null)} title={editing ? `Editar ${editing.user?.name ?? ""}` : ""} size="md">
        {editing && (
          <>
            <p className="text-sm text-sand-100/70 mb-5">
              Dados do cadastro abaixo (somente leitura). Ajuste categoria e segmento — as cotas diárias e a distribuição se recalculam automaticamente.
            </p>

            {editLoading ? (
              <div className="text-center py-6 text-sand-100/55 text-sm">Carregando cadastro…</div>
            ) : (
              <div className="mb-5 p-4 bg-app-subtle/40 border hairline rounded-lg">
                <p className="text-[0.68rem] uppercase tracking-mono-xwide font-bold text-gold-400/80 mb-3">Dados do cadastro</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <ReadField label="Nome completo" value={editing.user?.name} />
                  <ReadField label="E-mail" value={editing.user?.email} />
                  <ReadField label="Telefone" value={editing.application?.phone ?? editing.phone} />
                  <ReadField label="WhatsApp" value={editing.whatsapp} />
                  <ReadField label="CPF" value={editing.application?.cpf ?? editing.cpf} />
                  <ReadField label="RG" value={editing.application?.rg ?? editing.rg} />
                  <ReadField label="CRECI" value={editing.creci ? `${editing.creci}/${editing.creciUf ?? "—"}` : null} />
                  <ReadField label="Cidade" value={editing.application?.city} />
                  <ReadField label="Imobiliária atual" value={editing.application?.currentAgency} />
                  <ReadField label="Anos no mercado" value={editing.application?.yearsMarket} />
                  <ReadField label="Instagram" value={editing.application?.instagram} />
                </div>
                {editing.application?.notes && (
                  <div className="mt-3 pt-3 border-t hairline">
                    <ReadField label="Observações do cadastro" value={editing.application.notes} />
                  </div>
                )}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3 mb-5">
              <div>
                <label className="field-label">Categoria</label>
                <select className="field-input text-sm" value={editCat} onChange={(e) => setEditCat(e.target.value as AssociateCategory)} disabled={saving}>
                  {(Object.keys(CATEGORY_LABEL) as AssociateCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]} — {CATEGORY_QUOTA[c]} lead{CATEGORY_QUOTA[c] === 1 ? "" : "s"}/dia
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-sand-100/55">Define a cota diária de leads.</p>
              </div>
              <div>
                <label className="field-label">Segmento de atuação</label>
                <select className="field-input text-sm" value={editSeg} onChange={(e) => setEditSeg(e.target.value)} disabled={saving}>
                  {SEGMENTOS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <p className="mt-1 text-xs text-sand-100/55">Usado para match de leads na distribuição.</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t hairline">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
              <Button variant="gold" onClick={() => void saveEdit()} loading={saving}>Salvar alterações</Button>
            </div>
          </>
        )}
      </Modal>

      {/* Modal Desativar */}
      <Modal open={!!deactivating} onClose={() => !deactBusy && setDeactivating(null)} title={deactivating ? `Desativar ${deactivating.user?.name ?? ""}?` : ""} size="md">
        {deactivating && (
          <>
            <p className="text-sm text-sand-100/70 mb-4">
              Segmento: <strong className="text-sand-50">{deactivating.segment ?? "—"}</strong> · Categoria: <strong className="text-sand-50">{CATEGORY_LABEL[deactivating.category] ?? deactivating.category}</strong>
            </p>

            <div className="mb-5">
              <p className="text-[0.7rem] uppercase tracking-mono-label font-semibold text-gold-400 mb-3">O que fazer com os leads?</p>
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${deactDest === "queue" ? "border-gold-400/60 bg-gold-400/5" : "hairline"}`}>
                <input
                  type="radio"
                  name="deact-dest"
                  value="queue"
                  checked={deactDest === "queue"}
                  onChange={() => setDeactDest("queue")}
                  className="mt-1"
                  disabled={deactBusy}
                />
                <div>
                  <p className="text-sm font-semibold">Devolver à fila</p>
                  <p className="text-xs text-sand-100/55">Leads em aberto voltam para distribuição (não fechados/perdidos).</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors mt-2 ${deactDest === "transfer" ? "border-gold-400/60 bg-gold-400/5" : "hairline"}`}>
                <input
                  type="radio"
                  name="deact-dest"
                  value="transfer"
                  checked={deactDest === "transfer"}
                  onChange={() => setDeactDest("transfer")}
                  className="mt-1"
                  disabled={deactBusy}
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold">Transferir para outro corretor</p>
                  <p className="text-xs text-sand-100/55 mb-2">Todos os leads vão para o corretor selecionado.</p>
                  <select
                    className="field-input text-sm w-full"
                    value={deactTarget}
                    onChange={(e) => setDeactTarget(e.target.value)}
                    disabled={deactDest !== "transfer" || deactBusy}
                  >
                    <option value="">— selecionar corretor destino —</option>
                    {transferOptions.same.length > 0 && (
                      <optgroup label={`Mesmo segmento (${deactivating.segment ?? "—"})`}>
                        {transferOptions.same.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.user?.name ?? "—"} · {CATEGORY_LABEL[x.category]}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {transferOptions.others.length > 0 && (
                      <optgroup label="Outros segmentos">
                        {transferOptions.others.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.user?.name ?? "—"} · {x.segment ?? "—"} · {CATEGORY_LABEL[x.category]}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </label>
            </div>

            <div className="mb-5">
              <label className="field-label">Motivo do bloqueio (opcional)</label>
              <input
                type="text"
                className="field-input text-sm"
                placeholder="Ex: inatividade prolongada, ausência de retorno…"
                value={deactReason}
                onChange={(e) => setDeactReason(e.target.value)}
                maxLength={500}
                disabled={deactBusy}
              />
              <p className="mt-1 text-xs text-sand-100/55">Se informado e WhatsApp habilitado, envia o template <code>calebe_acesso_bloqueado</code>.</p>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t hairline">
              <Button variant="outline" onClick={() => setDeactivating(null)} disabled={deactBusy}>Cancelar</Button>
              <Button variant="danger" onClick={() => void confirmDeactivate()} loading={deactBusy}>Confirmar desativação</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value?: string | number | null }) {
  const v = value == null || value === "" ? "—" : String(value);
  return (
    <div>
      <p className="text-[0.62rem] uppercase tracking-mono-label text-sand-100/50 mb-0.5">{label}</p>
      <p className="text-sand-50 break-words">{v}</p>
    </div>
  );
}
