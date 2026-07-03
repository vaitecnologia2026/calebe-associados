// Modal Nova Venda · porte minimalista do form do legado (cors-vendas · linha 16030+)
// Backend: POST /api/sales { propertyId (cuid), clientName, clientData, finalValue, paymentConditions? }
//          POST /api/sales/:id/submit  (envia ao jurídico)
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Loader2, FileText, X as XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { Property } from "@/types/property";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (saleId: string, submitted: boolean) => void;
  /** Pre-seleciona o imóvel pelo id quando o modal abre de dentro do chat com lead já vinculado */
  prefillPropertyId?: string | null;
  /** Pre-preenche o nome do cliente quando vem do chat com lead carregado */
  prefillClientName?: string;
}

type TipoNeg = "vista" | "financiado" | "hibrida";
type EstadoCivil = "solteiro" | "casado" | "uniao" | "divorciado" | "viuvo";

function parseBRL(s: string): number {
  if (!s) return 0;
  const cleaned = String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function NovaVendaModal({ open, onClose, onSaved, prefillPropertyId, prefillClientName }: Props) {
  const showToast = useUi((s) => s.showToast);

  // Imóveis disponíveis
  const [properties, setProperties] = useState<Property[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);

  // Form state
  const [propertyId, setPropertyId] = useState("");
  const [clientName, setClientName] = useState("");
  const [cpf, setCpf] = useState("");
  const [rg, setRg] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [profession, setProfession] = useState("");
  const [nationality, setNationality] = useState("brasileiro");
  const [maritalStatus, setMaritalStatus] = useState<EstadoCivil>("solteiro");
  const [spouseName, setSpouseName] = useState("");
  const [spouseCpf, setSpouseCpf] = useState("");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("SC");
  const [zip, setZip] = useState("");

  const [tipoNeg, setTipoNeg] = useState<TipoNeg>("hibrida");
  const [valorVista, setValorVista] = useState("");
  const [entrada, setEntrada] = useState("");
  const [financiado, setFinanciado] = useState("");
  const [banco, setBanco] = useState("");
  const [prazoMeses, setPrazoMeses] = useState("");
  const [valorFechado, setValorFechado] = useState("");

  // Documentos pra anexar (RG, CPF, comprovante de renda, etc)
  const [docs, setDocs] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [saving, setSaving] = useState(false);

  // Carrega imóveis ao abrir
  useEffect(() => {
    if (!open) return;
    setLoadingProps(true);
    (async () => {
      try {
        const r = await api.get<{ data: Property[] }>("/api/properties?limit=500");
        const all = r.data ?? [];
        // Filtra só os disponíveis (legacy aceita qualquer, mas pra UX só lista os que fazem sentido)
        const dispo = all.filter((p) => p.status === "AVAILABLE" || !p.status);
        setProperties(dispo.length ? dispo : all);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Erro ao carregar imóveis: ${msg}`);
      } finally {
        setLoadingProps(false);
      }
    })();
  }, [open, showToast]);

  // Prefill quando abre
  useEffect(() => {
    if (!open) return;
    if (prefillPropertyId) setPropertyId(prefillPropertyId);
    if (prefillClientName) setClientName(prefillClientName);
  }, [open, prefillPropertyId, prefillClientName]);

  function resetForm() {
    setPropertyId(""); setClientName(""); setCpf(""); setRg(""); setEmail(""); setPhone("");
    setBirthDate(""); setProfession(""); setNationality("brasileiro"); setMaritalStatus("solteiro");
    setSpouseName(""); setSpouseCpf("");
    setAddress(""); setNeighborhood(""); setCity(""); setState("SC"); setZip("");
    setTipoNeg("hibrida"); setValorVista(""); setEntrada(""); setFinanciado(""); setBanco("");
    setPrazoMeses(""); setValorFechado("");
    setDocs([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onPickDocs(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Filtra > 25MB e tipos perigosos
    const valid = files.filter((f) => {
      if (f.size > 25 * 1024 * 1024) { showToast(`${f.name} > 25MB · ignorado`); return false; }
      return true;
    });
    setDocs((prev) => [...prev, ...valid].slice(0, 20));
  }
  function removeDoc(i: number) {
    setDocs((prev) => prev.filter((_, idx) => idx !== i));
  }
  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  function handleClose() {
    if (saving) return;
    resetForm();
    onClose();
  }

  async function submit(e: FormEvent, modo: "rascunho" | "submeter") {
    e.preventDefault();
    if (!propertyId) { showToast("Selecione o imóvel"); return; }
    if (!clientName.trim() && modo === "submeter") {
      showToast("Nome do cliente é obrigatório pra enviar ao jurídico");
      return;
    }

    // Calcula valor final (prefere valor fechado; senão vai pelo tipo)
    const finalNum = parseBRL(valorFechado)
      || (tipoNeg === "vista" ? parseBRL(valorVista) : parseBRL(entrada) + parseBRL(financiado));

    // Cônjuge (concatenado igual ao legacy)
    const temConjuge = maritalStatus === "casado" || maritalStatus === "uniao";
    const spouseParts = temConjuge
      ? [spouseName, spouseCpf ? `CPF ${spouseCpf}` : null].filter(Boolean)
      : [];

    // Negociação string
    const negociacao = tipoNeg === "vista"
      ? `Tipo: vista · Valor ${valorVista || "—"}`
      : [
          `Tipo: ${tipoNeg}`,
          entrada    && `Entrada ${entrada}`,
          financiado && `Financiado ${financiado}`,
          banco      && `Banco ${banco}`,
          prazoMeses && `${prazoMeses} meses`,
        ].filter(Boolean).join(" · ");

    const payload = {
      propertyId,
      clientName: clientName.trim() || "Rascunho",
      clientData: {
        cpf:           cpf.trim()           || undefined,
        rg:            rg.trim()            || undefined,
        birthDate:     birthDate.trim()     || undefined,
        maritalStatus,
        profession:    profession.trim()    || undefined,
        nationality:   nationality.trim()   || undefined,
        email:         email.trim()         || undefined,
        phone:         phone.trim()         || undefined,
        address:       address.trim()       || undefined,
        neighborhood:  neighborhood.trim()  || undefined,
        city:          city.trim()          || undefined,
        state:         state.trim()         || undefined,
        zip:           zip.trim()           || undefined,
        spouse:        spouseParts.length ? spouseParts.join(" · ") : undefined,
      },
      finalValue: finalNum > 0 ? finalNum : 0,
      paymentConditions: negociacao || undefined,
    };

    setSaving(true);
    try {
      const created = await api.post<{ id: string; code?: string; status?: string }>("/api/sales", payload);
      const saleId = created?.id;
      if (!saleId) throw new Error("Backend não retornou id da venda");

      // Upload de documentos (se algum foi anexado) — backend espera array "files" multipart, max 20
      let docsUploaded = 0;
      if (docs.length > 0) {
        try {
          const fd = new FormData();
          for (const f of docs) fd.append("files", f);
          const up = await api.post<{ uploaded?: number }>(`/api/sales/${saleId}/upload/documento`, fd);
          docsUploaded = up?.uploaded ?? 0;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          showToast(`Venda criada mas upload de docs falhou: ${msg}`);
        }
      }

      const docsLabel = docsUploaded > 0 ? ` · ${docsUploaded} doc${docsUploaded === 1 ? "" : "s"} anexado${docsUploaded === 1 ? "" : "s"}` : "";
      const codeLabel = created.code ?? saleId.slice(0, 8);

      if (modo === "submeter") {
        try {
          await api.post(`/api/sales/${saleId}/submit`, {});
          showToast(`Venda ${codeLabel} enviada ao jurídico${docsLabel}`);
          onSaved(saleId, true);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          showToast(`Venda criada como rascunho mas submit falhou: ${msg}`);
          onSaved(saleId, false);
        }
      } else {
        showToast(`Rascunho ${codeLabel} salvo${docsLabel}`);
        onSaved(saleId, false);
      }
      resetForm();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Falha ao salvar venda: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Registrar venda" size="lg">
      <p className="text-sm text-sand-100/70 mb-5">
        Preencha os dados da venda. Você pode salvar como <strong>rascunho</strong> e voltar depois, ou <strong>enviar ao jurídico</strong> pra iniciar a análise do contrato.
      </p>

      <form onSubmit={(e) => submit(e, "submeter")} className="space-y-5">
        {/* Imóvel */}
        <section>
          <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-400 mb-2">Imóvel</p>
          <div>
            <label className="field-label">Selecione *</label>
            {loadingProps ? (
              <div className="field-input flex items-center gap-2 text-sand-100/55 text-sm">
                <Loader2 size={14} className="animate-spin" /> Carregando imóveis…
              </div>
            ) : (
              <select className="field-input text-sm" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required disabled={saving}>
                <option value="">— escolha um imóvel —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.title}{p.city ? ` (${p.city})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        </section>

        {/* Cliente */}
        <section>
          <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-400 mb-2">Cliente</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nome completo *" value={clientName} onChange={(e) => setClientName(e.target.value)} required disabled={saving} />
            <Field label="CPF" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" disabled={saving} />
            <Field label="RG" value={rg} onChange={(e) => setRg(e.target.value)} disabled={saving} />
            <Field label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={saving} />
            <Field label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
            <Field label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(47) 99999-9999" disabled={saving} />
            <Field label="Profissão" value={profession} onChange={(e) => setProfession(e.target.value)} disabled={saving} />
            <Field label="Nacionalidade" value={nationality} onChange={(e) => setNationality(e.target.value)} disabled={saving} />
            <div>
              <label className="field-label">Estado civil</label>
              <select className="field-input text-sm" value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value as EstadoCivil)} disabled={saving}>
                <option value="solteiro">Solteiro(a)</option>
                <option value="casado">Casado(a)</option>
                <option value="uniao">União estável</option>
                <option value="divorciado">Divorciado(a)</option>
                <option value="viuvo">Viúvo(a)</option>
              </select>
            </div>
          </div>

          {(maritalStatus === "casado" || maritalStatus === "uniao") && (
            <div className="grid sm:grid-cols-2 gap-3 mt-3 p-3 bg-app-subtle/40 border hairline rounded">
              <Field label="Nome do cônjuge" value={spouseName} onChange={(e) => setSpouseName(e.target.value)} disabled={saving} />
              <Field label="CPF do cônjuge" value={spouseCpf} onChange={(e) => setSpouseCpf(e.target.value)} disabled={saving} />
            </div>
          )}
        </section>

        {/* Endereço */}
        <section>
          <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-400 mb-2">Endereço</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Endereço (rua + nº)" value={address} onChange={(e) => setAddress(e.target.value)} disabled={saving} />
            <Field label="Bairro" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} disabled={saving} />
            <Field label="Cidade" value={city} onChange={(e) => setCity(e.target.value)} disabled={saving} />
            <Field label="UF" value={state} onChange={(e) => setState(e.target.value)} maxLength={2} disabled={saving} />
            <Field label="CEP" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="00000-000" disabled={saving} />
          </div>
        </section>

        {/* Negociação */}
        <section>
          <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-400 mb-2">Negociação</p>
          <div className="grid sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="field-label">Tipo</label>
              <select className="field-input text-sm" value={tipoNeg} onChange={(e) => setTipoNeg(e.target.value as TipoNeg)} disabled={saving}>
                <option value="vista">À vista</option>
                <option value="financiado">Financiado</option>
                <option value="hibrida">Híbrida (entrada + financiamento)</option>
              </select>
            </div>
            {tipoNeg === "vista" ? (
              <Field label="Valor à vista" value={valorVista} onChange={(e) => setValorVista(e.target.value)} placeholder="R$ 0,00" disabled={saving} />
            ) : (
              <>
                <Field label="Entrada" value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="R$ 0,00" disabled={saving} />
                <Field label="Financiado" value={financiado} onChange={(e) => setFinanciado(e.target.value)} placeholder="R$ 0,00" disabled={saving} />
                <Field label="Banco" value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Caixa, BB, Itaú…" disabled={saving} />
                <Field label="Prazo (meses)" type="number" value={prazoMeses} onChange={(e) => setPrazoMeses(e.target.value)} disabled={saving} />
              </>
            )}
          </div>
          <Field label="Valor final fechado" value={valorFechado} onChange={(e) => setValorFechado(e.target.value)} placeholder="R$ 0,00" hint="Deixe em branco pra usar o cálculo automático" disabled={saving} />
        </section>

        {/* Documentos */}
        <section>
          <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-400 mb-2">Documentos (opcional)</p>
          <p className="text-xs text-sand-100/55 mb-3">RG, CPF, comprovante de renda, contrato social, etc. Máximo 20 arquivos · 25MB cada.</p>

          <label className="inline-flex items-center gap-2 cursor-pointer mb-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={onPickDocs}
              disabled={saving}
              className="hidden"
            />
            <span className="btn-base btn-outline text-sm" style={{ padding: ".5rem 1rem" }}>
              <FileText size={14} /> Anexar arquivos
            </span>
            {docs.length > 0 && (
              <span className="text-xs text-sand-100/65">{docs.length} arquivo{docs.length === 1 ? "" : "s"} selecionado{docs.length === 1 ? "" : "s"}</span>
            )}
          </label>

          {docs.length > 0 && (
            <ul className="space-y-1.5">
              {docs.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs bg-app-subtle/40 border hairline rounded px-2.5 py-2">
                  <FileText size={12} className="text-gold-400 shrink-0" />
                  <span className="flex-1 truncate text-sand-50">{f.name}</span>
                  <span className="text-sand-100/55 tabular-nums shrink-0">{fmtSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeDoc(i)}
                    disabled={saving}
                    className="text-sand-100/55 hover:text-red-300 shrink-0"
                    aria-label="Remover arquivo"
                  >
                    <XIcon size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap justify-end gap-2 pt-4 border-t hairline">
          <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>Cancelar</Button>
          <Button type="button" variant="ghost" onClick={(e) => void submit(e as unknown as FormEvent, "rascunho")} disabled={saving}>
            Salvar rascunho
          </Button>
          <Button type="submit" variant="gold" loading={saving}>
            <Plus size={14} /> Enviar ao jurídico
          </Button>
        </div>
      </form>
    </Modal>
  );
}
