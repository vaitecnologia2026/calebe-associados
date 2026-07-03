// Modal "Nova unidade" / "Imóvel especial" · porte FIEL do imovelModal do monólito
// (linhas 6080+ HTML + submitImovelCadastro linha 20446)
//
// Mesmo modal serve para os 2 botões — flag `isEspecial` apenas marca isSpecial=true
// no payload + muda o título.
//
// Endpoint principal: POST /api/properties (PATCH /api/properties/:id em edição)
// Upload pós-save:
//   POST /api/properties/:id/upload/midia       (multipart "files")
//   POST /api/properties/:id/upload/documento   (multipart "files")
//
// Payload e nomes de campo IDÊNTICOS ao monólito.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Save, Image as ImgIcon, Video, FileText, Sparkles } from "lucide-react";
import { api, API_BASE, getAuth } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/StatusPill";
import { ApiError } from "@/types/api";
import type { Development } from "@/types/property";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  isEspecial?: boolean;
  developmentIdPrefill?: string | null; // pra "+ adicionar unidade" dentro do empreendimento
  editId?: string | null;
}

const TIPO_OPTIONS = ["Apartamento", "Cobertura", "Casa", "Terreno", "Comercial"];

const VIS_KEYS = ["valor", "priceList", "priceCash", "comissao", "commissionValue", "empreendimento", "units", "area", "quartos"] as const;

interface FormState {
  im_tipo: string;
  im_titulo: string;
  im_desc: string;
  im_end: string;
  im_bairro: string;
  im_cidade: string;
  im_uf: string;
  im_cep: string;
  im_valor: string;        // "R$ 0,00" formato
  im_comissao: string;     // "2.5" ou "2,5"
  im_status: string;       // "rascunho" | "enviado"
  im_quartos: string;
  im_suites: string;
  im_vagas: string;
  im_area: string;         // "128 m²"
  im_developmentId: string;
  im_empreendimento: string;
  im_units: string;        // número da unidade
  im_priceList: string;
  im_priceCash: string;
  im_commissionValue: string;
  im_videoUrl: string;
  // Proprietário
  p_nome: string;
  p_tel: string;
  p_obs: string;
}

const EMPTY: FormState = {
  im_tipo: "Apartamento", im_titulo: "", im_desc: "",
  im_end: "", im_bairro: "", im_cidade: "", im_uf: "SC", im_cep: "",
  im_valor: "", im_comissao: "2.5", im_status: "rascunho",
  im_quartos: "", im_suites: "", im_vagas: "", im_area: "",
  im_developmentId: "", im_empreendimento: "", im_units: "",
  im_priceList: "", im_priceCash: "", im_commissionValue: "",
  im_videoUrl: "",
  p_nome: "", p_tel: "", p_obs: "",
};

// Helpers (mesmo comportamento do monólito · linha 20465-20473)
function toIntOrUndef(s: string): number | undefined {
  const n = parseInt(String(s ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function toMoneyOrUndef(s: string): number | undefined {
  const clean = String(s ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function parseValor(s: string): number {
  return Number(String(s ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
}
function maskPhone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function NewUnitModal({ open, onClose, onSaved, isEspecial, developmentIdPrefill, editId }: Props) {
  const [f, setF] = useState<FormState>(EMPTY);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    valor: true, priceList: false, priceCash: true, comissao: false, commissionValue: false,
    empreendimento: true, units: false, area: true, quartos: true,
  });
  const [fotos, setFotos] = useState<FileList | null>(null);
  const [videos, setVideos] = useState<FileList | null>(null);
  const [documentos, setDocumentos] = useState<FileList | null>(null);
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  // Carrega empreendimentos
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await api.get<{ data: Development[] }>("/api/developments?limit=5000");
        setDevelopments(r.data ?? []);
      } catch { /* silent */ }
    })();
  }, [open]);

  // Reset / prefill em modo edição
  useEffect(() => {
    if (!open) return;
    if (editId) {
      (async () => {
        try {
          const p: any = await api.get(`/api/properties/${editId}`);
          setF({
            im_tipo: p.propertyType ?? "Apartamento",
            im_titulo: p.title ?? "",
            im_desc: p.description ?? "",
            im_end: p.address ?? "",
            im_bairro: p.neighborhood ?? "",
            im_cidade: p.city ?? "",
            im_uf: p.state ?? "SC",
            im_cep: p.zipCode ?? "",
            im_valor: p.value != null ? String(p.value).replace(".", ",") : "",
            im_comissao: (p.commission ?? "2,5%").replace("%", "").replace(",", "."),
            im_status: "rascunho",
            im_quartos: p.bedrooms != null ? String(p.bedrooms) : "",
            im_suites: p.suites != null ? String(p.suites) : "",
            im_vagas: p.garages != null ? String(p.garages) : "",
            im_area: p.area ?? "",
            im_developmentId: p.developmentId ?? "",
            im_empreendimento: p._meta?.empreendimento ?? "",
            im_units: p.unitNumber ?? "",
            im_priceList: p.priceList != null ? String(p.priceList) : "",
            im_priceCash: p.priceCash != null ? String(p.priceCash) : "",
            im_commissionValue: p._meta?.commissionValue != null ? String(p._meta.commissionValue) : "",
            im_videoUrl: p._meta?.videoUrl ?? "",
            p_nome: p._meta?.owner?.name ?? "",
            p_tel: p._meta?.owner?.phone ?? "",
            p_obs: p._meta?.owner?.notes ?? "",
          });
          if (p._meta?.visibility) setVisibility({ ...visibility, ...p._meta.visibility });
        } catch (e: any) { showToast(`Erro carregando: ${e?.message ?? e}`); }
      })();
    } else {
      setF({ ...EMPTY, im_developmentId: developmentIdPrefill ?? "" });
      setVisibility({
        valor: true, priceList: false, priceCash: true, comissao: false, commissionValue: false,
        empreendimento: true, units: false, area: true, quartos: true,
      });
      setFotos(null); setVideos(null); setDocumentos(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId, developmentIdPrefill]);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  const titulo = useMemo(() => isEspecial ? "Imóvel especial" : (editId ? "Editar unidade" : "Nova unidade"), [isEspecial, editId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const titleTrim = f.im_titulo.trim();
    const cidadeTrim = f.im_cidade.trim();
    const bairroTrim = f.im_bairro.trim();
    if (!titleTrim) { showToast("Informe o título do imóvel"); return; }
    if (!f.im_valor.trim()) { showToast("Informe o valor"); return; }
    if (!cidadeTrim && !bairroTrim) { showToast("Informe ao menos a cidade ou o bairro"); return; }
    if ((bairroTrim || cidadeTrim).length < 2) { showToast("Cidade/bairro precisam ter ao menos 2 caracteres"); return; }
    const valorNum = parseValor(f.im_valor);
    if (!isFinite(valorNum) || valorNum <= 0) { showToast("Valor inválido"); return; }

    // Código auto-gerado (mesma fórmula do monólito · linha 20463)
    const codigo = editId
      ? undefined // backend mantém o original
      : "CAL-" + String(Math.floor(Date.now() / 1000) % 100000);

    const ownerName = f.p_nome.trim();
    const ownerPhone = f.p_tel.trim();
    const ownerNotes = f.p_obs.trim();
    const owner = (ownerName || ownerPhone || ownerNotes)
      ? { name: ownerName || undefined, phone: ownerPhone || undefined, notes: ownerNotes || undefined }
      : undefined;

    const _meta = {
      empreendimento: f.im_empreendimento.trim() || undefined,
      units:          toIntOrUndef(f.im_units),
      priceList:      toMoneyOrUndef(f.im_priceList),
      priceCash:      toMoneyOrUndef(f.im_priceCash),
      commissionValue: toMoneyOrUndef(f.im_commissionValue),
      videoUrl:       f.im_videoUrl.trim() || undefined,
      visibility,
      owner,
    };

    const developmentId = f.im_developmentId.trim() || null;

    const payload: any = {
      ...(codigo ? { code: codigo } : {}),
      title:        titleTrim,
      neighborhood: bairroTrim || cidadeTrim || "—",
      city:         cidadeTrim || bairroTrim || "—",
      value:        valorNum,
      commission:   (f.im_comissao || "2,5").replace(".", ",") + "%",
      propertyType: f.im_tipo || "Apartamento",
      description:  f.im_desc.trim() || undefined,
      isSpecial:    !!isEspecial,
      features:     [],
      area:         f.im_area.trim() || undefined,
      bedrooms:     toIntOrUndef(f.im_quartos),
      suites:       toIntOrUndef(f.im_suites),
      garages:      toIntOrUndef(f.im_vagas),
      developmentId,
      unitNumber:   f.im_units.trim() || undefined,
      priceList:    toMoneyOrUndef(f.im_priceList),
      priceCash:    toMoneyOrUndef(f.im_priceCash),
      _meta,
    };

    setSaving(true);
    try {
      const created: any = editId
        ? await api.patch(`/api/properties/${editId}`, payload)
        : await api.post("/api/properties", payload);

      const id = created?.id ?? editId;
      // Uploads
      const errs: string[] = [];
      let mid = 0, doc = 0;
      try { mid += await uploadFiles(id!, "midia", fotos); }
      catch (e: any) { errs.push(`fotos: ${e?.message ?? e}`); }
      try { mid += await uploadFiles(id!, "midia", videos); }
      catch (e: any) { errs.push(`vídeos: ${e?.message ?? e}`); }
      try { doc += await uploadFiles(id!, "documento", documentos); }
      catch (e: any) { errs.push(`docs: ${e?.message ?? e}`); }

      const action = editId ? "atualizado" : "salvo";
      let msg = `Imóvel ${created?.code ?? codigo ?? ""} ${action}`.trim();
      if (mid || doc) {
        const parts: string[] = [];
        if (mid) parts.push(`${mid} arquivo(s) em Midias`);
        if (doc) parts.push(`${doc} arquivo(s) em Documentos`);
        msg += " · " + parts.join(" · ");
      }
      if (errs.length) msg += " · upload parcial: " + errs.join(" · ");
      showToast(msg);

      onClose();
      onSaved?.();
    } catch (e) {
      let msg = (editId ? "Falha ao atualizar imóvel" : "Falha ao salvar imóvel");
      if (e instanceof ApiError) {
        if ((e.data as any)?.error === "duplicate") msg = "Já existe imóvel com esse código.";
        else if ((e.data as any)?.issues) {
          msg = "Corrija: " + ((e.data as any).issues as Array<{ path?: string[]; message?: string }>)
            .map((i) => `${i.path?.join(".")} ${i.message}`).join("; ");
        }
        else msg = e.message;
      }
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(propId: string, tipo: "midia" | "documento", files: FileList | null) {
    if (!files?.length) return 0;
    const fd = new FormData();
    for (const file of Array.from(files)) fd.append("files", file);
    const r = await fetch(`${API_BASE}/api/properties/${propId}/upload/${tipo}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + (getAuth()?.accessToken ?? "") },
      credentials: "include",
      body: fd,
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      throw new Error(j?.message ?? j?.error ?? `HTTP ${r.status}`);
    }
    const j = await r.json();
    return j.uploaded ?? 0;
  }

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="meta-gold mb-1">Nível 2 · Unidade</p>
          <h2 className="text-2xl md:text-3xl font-bold tracking-display-tight inline-flex items-center gap-2">
            {isEspecial && <Sparkles size={20} className="text-gold-400" />}
            {titulo}
          </h2>
        </div>
        <StatusPill tone={f.im_status === "enviado" ? "info" : "warning"}>
          {f.im_status === "enviado" ? "Para validação" : "Rascunho"}
        </StatusPill>
      </div>

      <form onSubmit={submit} className="space-y-5">
        {/* Dados do imóvel */}
        <section>
          <h3 className="text-lg font-bold tracking-[-0.02em] mb-4">Dados do imóvel</h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Tipo</label>
              <select className="field-input" value={f.im_tipo} onChange={(e) => update("im_tipo", e.target.value)}>
                {TIPO_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <Field label="Título *" value={f.im_titulo} onChange={(e) => update("im_titulo", e.target.value)} required />
            </div>
            <div className="lg:col-span-4">
              <label className="field-label">Descrição</label>
              <textarea className="field-input" rows={2} value={f.im_desc} onChange={(e) => update("im_desc", e.target.value)} placeholder="Breve descrição do imóvel..." />
            </div>
            <div className="lg:col-span-2"><Field label="Endereço" value={f.im_end} onChange={(e) => update("im_end", e.target.value)} /></div>
            <div><Field label="Bairro" value={f.im_bairro} onChange={(e) => update("im_bairro", e.target.value)} /></div>
            <div><Field label="Cidade" value={f.im_cidade} onChange={(e) => update("im_cidade", e.target.value)} /></div>
            <div><Field label="UF" value={f.im_uf} onChange={(e) => update("im_uf", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} /></div>
            <div><Field label="CEP" value={f.im_cep} onChange={(e) => update("im_cep", e.target.value)} placeholder="00000-000" /></div>
            <div><Field label="Valor *" value={f.im_valor} onChange={(e) => update("im_valor", e.target.value)} placeholder="R$ 0,00" required /></div>
            <div><Field label="Comissão (%)" value={f.im_comissao} onChange={(e) => update("im_comissao", e.target.value)} placeholder="2.5" /></div>
            <div>
              <label className="field-label">Status</label>
              <select className="field-input" value={f.im_status} onChange={(e) => update("im_status", e.target.value)}>
                <option value="rascunho">Rascunho</option>
                <option value="enviado">Enviar para validação</option>
              </select>
            </div>
            <div><Field label="Quartos" type="number" value={f.im_quartos} onChange={(e) => update("im_quartos", e.target.value)} placeholder="0" /></div>
            <div><Field label="Suítes" type="number" value={f.im_suites} onChange={(e) => update("im_suites", e.target.value)} placeholder="0" /></div>
            <div><Field label="Vagas" type="number" value={f.im_vagas} onChange={(e) => update("im_vagas", e.target.value)} placeholder="0" /></div>
            <div><Field label="Área" value={f.im_area} onChange={(e) => update("im_area", e.target.value)} placeholder="128 m²" /></div>
            <div className="lg:col-span-2">
              <label className="field-label">Empreendimento <span className="text-sand-100/50 font-normal normal-case">(vincular a empreendimento cadastrado ou deixar avulso)</span></label>
              <select className="field-input" value={f.im_developmentId} onChange={(e) => update("im_developmentId", e.target.value)}>
                <option value="">— imóvel avulso (sem empreendimento) —</option>
                {developments.map((d) => (<option key={d.id} value={d.id}>{d.code} · {d.name}</option>))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <Field
                label="Empreendimento (texto livre, se não cadastrado)"
                value={f.im_empreendimento}
                onChange={(e) => update("im_empreendimento", e.target.value)}
                placeholder="Residencial Jardim Calebe (preencha só se não houver empreendimento cadastrado acima)"
              />
            </div>
            <div><Field label="Unidade" value={f.im_units} onChange={(e) => update("im_units", e.target.value)} placeholder="0" /></div>
            <div><Field label="Valor de tabela" value={f.im_priceList} onChange={(e) => update("im_priceList", e.target.value)} placeholder="R$ 0,00" /></div>
            <div><Field label="Valor à vista (com desconto)" value={f.im_priceCash} onChange={(e) => update("im_priceCash", e.target.value)} placeholder="R$ 0,00" /></div>
            <div><Field label="Valor da comissão" value={f.im_commissionValue} onChange={(e) => update("im_commissionValue", e.target.value)} placeholder="R$ 0,00" /></div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Visibilidade na LP */}
        <section>
          <h3 className="text-lg font-bold tracking-[-0.02em] mb-2">Visibilidade na LP de afiliado</h3>
          <p className="text-xs text-sand-100/60 mb-3">
            Selecione quais informações aparecem publicamente na página do imóvel compartilhada pelo corretor.
            Dados não marcados ficam só no painel interno.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              ["valor", "Valor principal"],
              ["priceList", "Valor de tabela"],
              ["priceCash", "Valor à vista (com desconto)"],
              ["comissao", "Comissão (%)"],
              ["commissionValue", "Valor de comissão"],
              ["empreendimento", "Empreendimento"],
              ["units", "Unidade"],
              ["area", "Área"],
              ["quartos", "Quartos/Suítes/Vagas"],
            ].map(([k, label]) => (
              <label key={k} className="card p-3 text-sm cursor-pointer inline-flex items-center gap-2">
                <input
                  type="checkbox" className="accent-gold-400"
                  checked={!!visibility[k]}
                  onChange={(e) => setVisibility({ ...visibility, [k]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <div className="divider-gold" />

        {/* Proprietário */}
        <section>
          <h3 className="text-lg font-bold tracking-[-0.02em] mb-4">Proprietário</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Nome do proprietário" value={f.p_nome} onChange={(e) => update("p_nome", e.target.value)} />
            <Field
              label="Telefone do proprietário"
              value={f.p_tel}
              onChange={(e) => update("p_tel", maskPhone(e.target.value))}
            />
            <div className="md:col-span-2">
              <label className="field-label">Observações</label>
              <textarea
                className="field-input" rows={2}
                value={f.p_obs}
                onChange={(e) => update("p_obs", e.target.value)}
                placeholder="Situação jurídica, condições..."
              />
            </div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Fotos · vídeos · documentos */}
        <section>
          <h3 className="text-lg font-bold tracking-[-0.02em] mb-4">Fotos, vídeos & documentos</h3>
          <p className="text-xs text-sand-100/60 mb-3">
            Fotos/vídeos vão para <code className="text-gold-300">Midias/</code>, documentos para{" "}
            <code className="text-gold-300">Documentos/</code>. URL de YouTube/Vimeo é opcional.
          </p>
          <div className="mb-3">
            <Field
              label="URL do vídeo (YouTube/Vimeo) · opcional"
              value={f.im_videoUrl}
              onChange={(e) => update("im_videoUrl", e.target.value)}
              placeholder="https://youtu.be/… ou https://vimeo.com/…"
            />
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <FilesSlot
              label="Fotos · JPG/PNG/WEBP · múltiplas"
              Icon={ImgIcon}
              files={fotos} onChange={setFotos}
              accept="image/*"
            />
            <FilesSlot
              label="Vídeos (arquivo) · MP4/MOV/WEBM · múltiplos"
              Icon={Video}
              files={videos} onChange={setVideos}
              accept="video/*"
            />
            <FilesSlot
              label="Documentos · Matrícula, IPTU, procuração"
              Icon={FileText}
              files={documentos} onChange={setDocumentos}
              accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
            />
          </div>
        </section>

        <footer className="flex items-center justify-end gap-2 pt-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="gold" loading={saving}>
            <Save size={14} /> Salvar imóvel
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function FilesSlot({ label, Icon, files, onChange, accept }: {
  label: string;
  Icon: any;
  files: FileList | null;
  onChange: (f: FileList | null) => void;
  accept: string;
}) {
  const count = files?.length ?? 0;
  return (
    <label className="bg-app-subtle/60 border hairline rounded p-3 cursor-pointer hover:border-gold-400/40 flex items-center gap-2">
      <div className="h-10 w-10 rounded border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400 shrink-0">
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">
          {count > 0 ? `${count} arquivo${count === 1 ? "" : "s"} selecionado${count === 1 ? "" : "s"}` : "Selecionar"}
        </p>
        <p className="text-xs text-sand-100/55 truncate">{label}</p>
      </div>
      <input type="file" multiple accept={accept} className="hidden" onChange={(e) => onChange(e.target.files)} />
    </label>
  );
}
