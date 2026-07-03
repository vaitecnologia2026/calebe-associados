// Modal "Novo empreendimento" · porte FIEL de developmentModal + submitDevelopment
// (monolito linhas 4847+ e 20254+)
//
// Endpoint: POST /api/developments  (PATCH se editar)
// Após save: upload opcional de capa/vídeo em
//   POST /api/developments/{id}/upload/cover  (multipart "file")
//   POST /api/developments/{id}/upload/video  (multipart "file")
//
// Payload tem MESMOS nomes que o backend espera (vide submitDevelopment do monólito).

import { useEffect, useState, type FormEvent } from "react";
import { Save, X, Upload, Plus, Info, Camera, DollarSign, Home as HomeIcon } from "lucide-react";
import { api, API_BASE, getAuth } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/types/api";
import type { Tipologia, Development } from "@/types/property";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  // Se editId definido, modo edição (PATCH); senão criação (POST)
  editId?: string | null;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ACTIVE", label: "Ativo" },
  { value: "SOLD_OUT", label: "Esgotado" },
  { value: "DELIVERED", label: "Entregue" },
  { value: "SUSPENDED", label: "Suspenso" },
];

const TYPE_OPTIONS = ["", "Residencial", "Comercial", "Misto", "Hoteleiro"];

interface FormState {
  code: string;
  name: string;
  description: string;
  address: string;
  zipCode: string;
  neighborhood: string;
  city: string;
  state: string;
  developmentType: string;
  totalUnits: string;
  totalFloors: string;
  totalTowers: string;
  deliveryDate: string;
  launchDate: string;
  commonAreas: string;
  leisureFeatures: string;
  differentials: string;
  builder: string;
  registryNumber: string;
  status: string;
  coverImageUrl: string;
  videoUrl: string;
  latitude: string;
  longitude: string;
  commissionDefault: string;
  cubBaseValue: string;
  acceptsPermuta: boolean;
  acceptsParcelado: boolean;
  valorPermutaParcelado: string;
}

const EMPTY: FormState = {
  code: "", name: "", description: "",
  address: "", zipCode: "", neighborhood: "", city: "", state: "SC",
  developmentType: "",
  totalUnits: "", totalFloors: "", totalTowers: "",
  deliveryDate: "", launchDate: "",
  commonAreas: "", leisureFeatures: "", differentials: "",
  builder: "", registryNumber: "", status: "ACTIVE",
  coverImageUrl: "", videoUrl: "", latitude: "", longitude: "",
  commissionDefault: "", cubBaseValue: "",
  acceptsPermuta: false, acceptsParcelado: false,
  valorPermutaParcelado: "",
};

export function NewDevelopmentModal({ open, onClose, onSaved, editId }: Props) {
  const [f, setF] = useState<FormState>(EMPTY);
  const [tips, setTips] = useState<Tipologia[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  // Carrega dados em modo edição
  useEffect(() => {
    if (!open) return;
    if (!editId) { setF(EMPTY); setTips([]); setCoverFile(null); setVideoFile(null); return; }
    (async () => {
      try {
        const d = await api.get<Development>(`/api/developments/${editId}`);
        setF({
          code: d.code ?? "",
          name: d.name ?? "",
          description: d.description ?? "",
          address: d.address ?? "",
          zipCode: d.zipCode ?? "",
          neighborhood: d.neighborhood ?? "",
          city: d.city ?? "",
          state: d.state ?? "SC",
          developmentType: d.developmentType ?? "",
          totalUnits: d.totalUnits != null ? String(d.totalUnits) : "",
          totalFloors: d.totalFloors != null ? String(d.totalFloors) : "",
          totalTowers: d.totalTowers != null ? String(d.totalTowers) : "",
          deliveryDate: d.deliveryDate ? d.deliveryDate.slice(0, 10) : "",
          launchDate: d.launchDate ? d.launchDate.slice(0, 10) : "",
          commonAreas: (d.commonAreas ?? []).join(", "),
          leisureFeatures: (d.leisureFeatures ?? []).join(", "),
          differentials: d.differentials ?? "",
          builder: d.builder ?? "",
          registryNumber: d.registryNumber ?? "",
          status: d.status ?? "ACTIVE",
          coverImageUrl: d.coverImageUrl ?? "",
          videoUrl: d.videoUrl ?? "",
          latitude: d.latitude != null ? String(d.latitude) : "",
          longitude: d.longitude != null ? String(d.longitude) : "",
          commissionDefault: d.commissionDefault ?? "",
          cubBaseValue: d.cubBaseValue != null ? String(d.cubBaseValue) : "",
          acceptsPermuta: !!d.acceptsPermuta,
          acceptsParcelado: !!d.acceptsParcelado,
          valorPermutaParcelado: d.valorPermutaParcelado != null ? String(d.valorPermutaParcelado) : "",
        });
        setTips(d.tipologias ?? []);
      } catch (e: any) { showToast(`Erro carregando: ${e?.message ?? e}`); }
    })();
  }, [open, editId, showToast]);

  function csv(v: string) {
    return v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
  }
  function isoOrNull(v: string) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Payload com nomes EXATOS do monólito · vide submitDevelopment (linha 20264)
      const payload: any = {
        code:            f.code.trim().toUpperCase(),
        name:            f.name.trim(),
        description:     f.description.trim() || null,
        address:         f.address.trim() || null,
        zipCode:         f.zipCode.trim() || null,
        neighborhood:    f.neighborhood.trim(),
        city:            f.city.trim(),
        state:           f.state.trim().toUpperCase(),
        developmentType: f.developmentType || null,
        totalUnits:      f.totalUnits  ? Number(f.totalUnits)  : null,
        totalFloors:     f.totalFloors ? Number(f.totalFloors) : null,
        totalTowers:     f.totalTowers ? Number(f.totalTowers) : null,
        deliveryDate:    isoOrNull(f.deliveryDate),
        launchDate:      isoOrNull(f.launchDate),
        commonAreas:     csv(f.commonAreas),
        leisureFeatures: csv(f.leisureFeatures),
        differentials:   f.differentials.trim() || null,
        builder:         f.builder.trim() || null,
        registryNumber:  f.registryNumber.trim() || null,
        status:          f.status || "ACTIVE",
        coverImageUrl:   f.coverImageUrl.trim() || null,
        videoUrl:        f.videoUrl.trim() || null,
        latitude:        f.latitude  ? Number(f.latitude)  : null,
        longitude:       f.longitude ? Number(f.longitude) : null,
        commissionDefault: f.commissionDefault.trim() || null,
        acceptsPermuta:    f.acceptsPermuta,
        acceptsParcelado:  f.acceptsParcelado,
        cubBaseValue:    f.cubBaseValue ? Number(f.cubBaseValue) : null,
        tipologias:      tips.filter((t) => t.label || t.suites != null || t.valorAvista != null),
        valorPermutaParcelado: f.valorPermutaParcelado ? Number(f.valorPermutaParcelado) : null,
      };

      let saved: Development;
      if (editId) {
        saved = await api.patch<Development>(`/api/developments/${editId}`, payload);
      } else {
        saved = await api.post<Development>("/api/developments", payload);
      }
      const devId = saved?.id ?? editId;

      // Upload de capa/video se admin selecionou arquivo
      const errs: string[] = [];
      const uploaded: string[] = [];
      if (coverFile && devId) {
        try { await uploadFile(devId, "cover", coverFile); uploaded.push("capa"); }
        catch (e: any) { errs.push(`capa: ${e?.message ?? e}`); }
      }
      if (videoFile && devId) {
        try { await uploadFile(devId, "video", videoFile); uploaded.push("vídeo"); }
        catch (e: any) { errs.push(`vídeo: ${e?.message ?? e}`); }
      }

      const action = editId ? "atualizado" : "criado";
      let msg = `Empreendimento ${payload.code} ${action}`;
      if (uploaded.length) msg += ` · ${uploaded.join(" · ")} enviado(s)`;
      if (errs.length)     msg += ` · upload parcial: ${errs.join(" · ")}`;
      showToast(msg);

      onClose();
      onSaved?.();
    } catch (e) {
      let msg = "Falha ao salvar empreendimento";
      if (e instanceof ApiError) {
        msg = e.message;
        const issues = (e.data as any)?.issues as Array<{ path?: string[]; message?: string }> | undefined;
        if (issues?.length) {
          msg = "Corrija: " + issues.map((i) => `${i.path?.join(".")} ${i.message}`).join("; ");
        }
      }
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(devId: string, kind: "cover" | "video", file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API_BASE}/api/developments/${devId}/upload/${kind}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + (getAuth()?.accessToken ?? "") },
      credentials: "include",
      body: fd,
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      throw new Error(j?.message ?? j?.error ?? `HTTP ${r.status}`);
    }
    return r.json();
  }

  function addTip()    { setTips([...tips, { label: "", suites: undefined, valorAvista: undefined }]); }
  function rmTip(i: number) { setTips(tips.filter((_, idx) => idx !== i)); }
  function updTip<K extends keyof Tipologia>(i: number, k: K, v: Tipologia[K]) {
    setTips(tips.map((t, idx) => idx === i ? { ...t, [k]: v } : t));
  }

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="mb-5">
        <p className="meta-gold mb-1">Nível 1 · Empreendimento</p>
        <h2 className="text-2xl md:text-3xl font-bold tracking-display-tight">
          {editId ? "Editar empreendimento" : "Novo empreendimento"}
        </h2>
      </div>

      <form onSubmit={submit} className="space-y-6">
        {/* Identificação */}
        <section>
          <h3 className="text-lg font-bold mb-3">Identificação</h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Código * <span className="text-sand-100/50 font-normal">(curto)</span></label>
              <input className="field-input" value={f.code} onChange={(e) => update("code", e.target.value)} required maxLength={40} placeholder="MERAKI-HR" />
            </div>
            <div className="md:col-span-2">
              <label className="field-label">Nome comercial *</label>
              <input className="field-input" value={f.name} onChange={(e) => update("name", e.target.value)} required maxLength={200} placeholder="Meraki Home Resort" />
            </div>
            <div className="md:col-span-3">
              <label className="field-label">Descrição</label>
              <textarea className="field-input" rows={2} value={f.description} onChange={(e) => update("description", e.target.value)} placeholder="Texto comercial geral do empreendimento..." />
            </div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Localização */}
        <section>
          <h3 className="text-lg font-bold mb-3">Localização</h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2"><label className="field-label">Endereço</label>
              <input className="field-input" value={f.address} onChange={(e) => update("address", e.target.value)} placeholder="Rua, número, complemento" /></div>
            <div><label className="field-label">CEP</label>
              <input className="field-input" value={f.zipCode} onChange={(e) => update("zipCode", e.target.value)} placeholder="00000-000" /></div>
            <div><label className="field-label">Bairro *</label>
              <input className="field-input" value={f.neighborhood} onChange={(e) => update("neighborhood", e.target.value)} required /></div>
            <div><label className="field-label">Cidade *</label>
              <input className="field-input" value={f.city} onChange={(e) => update("city", e.target.value)} required /></div>
            <div><label className="field-label">UF *</label>
              <input className="field-input" value={f.state} onChange={(e) => update("state", e.target.value.toUpperCase().slice(0, 2))} required maxLength={2} /></div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Datas & estrutura */}
        <section>
          <h3 className="text-lg font-bold mb-3">Datas & estrutura</h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div><label className="field-label">Data de entrega</label>
              <input className="field-input" type="date" value={f.deliveryDate} onChange={(e) => update("deliveryDate", e.target.value)} /></div>
            <div><label className="field-label">Data de lançamento</label>
              <input className="field-input" type="date" value={f.launchDate} onChange={(e) => update("launchDate", e.target.value)} /></div>
            <div><label className="field-label">Tipo</label>
              <select className="field-input" value={f.developmentType} onChange={(e) => update("developmentType", e.target.value)}>
                {TYPE_OPTIONS.map((o) => (<option key={o} value={o}>{o || "—"}</option>))}
              </select></div>
            <div><label className="field-label">Total de unidades</label>
              <input className="field-input" type="number" min={0} value={f.totalUnits} onChange={(e) => update("totalUnits", e.target.value)} /></div>
            <div><label className="field-label">Andares</label>
              <input className="field-input" type="number" min={0} value={f.totalFloors} onChange={(e) => update("totalFloors", e.target.value)} /></div>
            <div><label className="field-label">Torres</label>
              <input className="field-input" type="number" min={0} value={f.totalTowers} onChange={(e) => update("totalTowers", e.target.value)} /></div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Áreas comuns & lazer */}
        <section>
          <h3 className="text-lg font-bold mb-3">Áreas comuns & lazer</h3>
          <p className="text-xs text-sand-100/60 mb-3">Separe por vírgula. Ex: "Piscina, Academia, Salão de festas".</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className="field-label">Áreas comuns</label>
              <textarea className="field-input" rows={2} value={f.commonAreas} onChange={(e) => update("commonAreas", e.target.value)} placeholder="Hall, portaria 24h, elevadores, gerador..." /></div>
            <div><label className="field-label">Itens de lazer</label>
              <textarea className="field-input" rows={2} value={f.leisureFeatures} onChange={(e) => update("leisureFeatures", e.target.value)} placeholder="Piscina, SPA, rooftop, espaço gourmet..." /></div>
            <div className="md:col-span-2"><label className="field-label">Diferenciais (texto livre)</label>
              <textarea className="field-input" rows={3} value={f.differentials} onChange={(e) => update("differentials", e.target.value)} placeholder="Vista para o mar, conceito resort, serviços inclusos..." /></div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Construtora & registro */}
        <section>
          <h3 className="text-lg font-bold mb-3">Construtora & registro</h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2"><label className="field-label">Construtora / incorporadora</label>
              <input className="field-input" value={f.builder} onChange={(e) => update("builder", e.target.value)} placeholder="Pastório Constr. e Inc. Ltda." /></div>
            <div><label className="field-label">Matrícula(s)</label>
              <input className="field-input" value={f.registryNumber} onChange={(e) => update("registryNumber", e.target.value)} placeholder="Matrícula 11.891 · ORI Porto Belo" /></div>
            <div><label className="field-label">Status</label>
              <select className="field-input" value={f.status} onChange={(e) => update("status", e.target.value)}>
                {STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select></div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Capa, vídeo e localização */}
        <section>
          <h3 className="text-lg font-bold mb-3 inline-flex items-center gap-2"><Camera size={16} /> Capa, vídeo e localização</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="field-label">Imagem de capa <span className="text-sand-100/50 font-normal">(grande, horizontal · 1200×600px)</span></label>
              <div className="flex gap-2 items-start">
                <input className="field-input flex-1" value={f.coverImageUrl} onChange={(e) => update("coverImageUrl", e.target.value)} placeholder="Cole a URL OU envie o arquivo ao lado" />
                <label className="btn-base btn-outline cursor-pointer inline-flex items-center gap-2 whitespace-nowrap" style={{ padding: ".55rem .9rem" }}>
                  <Upload size={14} />
                  <span>{coverFile?.name ?? "Arquivo"}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <p className="text-[0.65rem] text-sand-100/50 mt-1">Se enviar o arquivo, ele sobrescreve a URL acima após salvar.</p>
            </div>
            <div className="md:col-span-2">
              <label className="field-label">Vídeo do empreendimento</label>
              <div className="flex gap-2 items-start">
                <input className="field-input flex-1" value={f.videoUrl} onChange={(e) => update("videoUrl", e.target.value)} placeholder="https://youtu.be/… ou cole URL · ou envie MP4 ao lado" />
                <label className="btn-base btn-outline cursor-pointer inline-flex items-center gap-2 whitespace-nowrap" style={{ padding: ".55rem .9rem" }}>
                  <Upload size={14} />
                  <span>{videoFile?.name ?? "Arquivo"}</span>
                  <input type="file" accept="video/*" className="hidden" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <p className="text-[0.65rem] text-sand-100/50 mt-1">YouTube/Vimeo (URL) ou MP4/MOV/WEBM (arquivo · até 200MB).</p>
            </div>
            <div><label className="field-label">Latitude <span className="text-sand-100/50 font-normal">(para mapa)</span></label>
              <input className="field-input" type="number" step="any" value={f.latitude} onChange={(e) => update("latitude", e.target.value)} placeholder="-27.1500" /></div>
            <div><label className="field-label">Longitude</label>
              <input className="field-input" type="number" step="any" value={f.longitude} onChange={(e) => update("longitude", e.target.value)} placeholder="-48.5300" /></div>
            <p className="md:col-span-2 text-[0.7rem] text-sand-100/55 inline-flex items-center gap-1">
              <Info size={12} /> Pega lat/lng no Google Maps: clica com o botão direito no local → copia coordenadas.
            </p>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Comissão & formas de pagamento */}
        <section>
          <h3 className="text-lg font-bold mb-3 inline-flex items-center gap-2"><DollarSign size={16} /> Comissão & formas de pagamento</h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div><label className="field-label">Comissão padrão <span className="text-sand-100/50 font-normal">(% que aparece no card)</span></label>
              <input className="field-input" value={f.commissionDefault} onChange={(e) => update("commissionDefault", e.target.value)} placeholder="2,5%" /></div>
            <div><label className="field-label">Valor base do CUB <span className="text-sand-100/50 font-normal">(R$ p/ simulador)</span></label>
              <input className="field-input" type="number" step="0.01" value={f.cubBaseValue} onChange={(e) => update("cubBaseValue", e.target.value)} placeholder="3850.00" /></div>
            <div className="flex flex-col gap-2 pt-6">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-gold-400" checked={f.acceptsPermuta} onChange={(e) => update("acceptsPermuta", e.target.checked)} />
                Aceita permuta
              </label>
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-gold-400" checked={f.acceptsParcelado} onChange={(e) => update("acceptsParcelado", e.target.checked)} />
                Aceita parcelado
              </label>
            </div>
          </div>
        </section>

        <div className="divider-gold" />

        {/* Tipologias */}
        <section>
          <h3 className="text-lg font-bold mb-3 inline-flex items-center gap-2"><HomeIcon size={16} /> Tipologias e valores no card</h3>
          <p className="text-xs text-sand-100/65 mb-3">
            Cada tipologia vira uma coluna no card do empreendimento (igual MERAKI). Adicione uma linha por opção de planta.
          </p>
          <div className="space-y-2 mb-3">
            {tips.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_180px_auto] gap-2 items-end">
                <div>
                  <label className="field-label">Label</label>
                  <input className="field-input text-sm" value={t.label ?? ""} onChange={(e) => updTip(i, "label", e.target.value)} placeholder="Ex: 2 suítes" />
                </div>
                <div>
                  <label className="field-label">Suítes</label>
                  <input className="field-input text-sm" type="number" min={0} value={t.suites ?? ""} onChange={(e) => updTip(i, "suites", e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="field-label">Valor à vista (R$)</label>
                  <input className="field-input text-sm" type="number" step="0.01" value={t.valorAvista ?? ""} onChange={(e) => updTip(i, "valorAvista", e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <button type="button" onClick={() => rmTip(i)} className="text-red-400 hover:text-red-300 p-2 mb-0.5" title="Remover">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={addTip} style={{ padding: ".45rem .9rem", fontSize: ".85rem" }}>
            <Plus size={13} /> Adicionar tipologia
          </Button>
          <div className="grid md:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="field-label">Valor único permuta/parcelado <span className="text-sand-100/50 font-normal">(R$)</span></label>
              <input className="field-input" type="number" step="0.01" value={f.valorPermutaParcelado} onChange={(e) => update("valorPermutaParcelado", e.target.value)} placeholder="1890000.00" />
              <p className="text-[0.65rem] text-sand-100/55 mt-1 italic">Aparece no card como "Permuta / Parcelado: R$ X". Vazio = "Aceita".</p>
            </div>
          </div>
        </section>

        <footer className="flex items-center justify-end gap-2 pt-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="gold" loading={saving}>
            <Save size={14} /> {editId ? "Atualizar empreendimento" : "Criar empreendimento"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
