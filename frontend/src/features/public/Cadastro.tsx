// Cadastro de corretor · POST /api/associates/applications (multipart)
// Porte de openCadastro (linha 9202 do monólito)
import { useState, type FormEvent } from "react";
import { Upload, ArrowRight, ShieldCheck } from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { useUi } from "@/store/ui";
import { ApiError } from "@/types/api";

const UFs = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function maskCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1-$2");
}

export function Cadastro() {
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", cpf: "", rg: "", instagram: "",
    creci: "", creciState: "SC", city: "Itapema",
    currentAgency: "", yearsMarket: "", notes: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm({ ...form, [k]: v });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) { setError("Anexe a foto da credencial CRECI"); return; }
    if (file.size > 8 * 1024 * 1024) { setError("Arquivo grande demais (máx 8MB)"); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      // Mapeia os nomes do form pros nomes que o backend (zod) exige.
      const keyMap: Record<string, string> = { fullName: "name", creciState: "creciUf" };
      Object.entries(form).forEach(([k, v]) => fd.append(keyMap[k] || k, String(v)));
      fd.append("credential", file);
      await fetch(`${API_BASE}/api/associates/applications`, { method: "POST", body: fd, credentials: "include" })
        .then(async (r) => {
          if (!r.ok) {
            const d = await r.json().catch(() => null);
            const det = Array.isArray(d?.issues) ? d.issues.map((i: any) => i.path?.join(".")).join(", ") : "";
            throw new ApiError(d?.error || d?.message || (det ? `Confira os campos: ${det}` : `Erro ${r.status} ao enviar`), r.status, d);
          }
        });
      setSuccess(true);
      showToast("Cadastro enviado · resposta em até 48h úteis");
    } catch (e: any) {
      setError(e?.message ?? "Falha ao enviar");
    } finally { setSubmitting(false); }
  }

  if (success) {
    return (
      <div className="container-site py-24 text-center max-w-xl">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gold-400/10 border border-gold-400/40 text-gold-400 mb-6">
          <ShieldCheck size={28} />
        </div>
        <h1 className="text-3xl md:text-5xl font-bold tracking-display-tight">
          Cadastro <span className="text-gold-400">recebido</span>.
        </h1>
        <p className="mt-5 text-sand-100/70 max-w-xl mx-auto">
          Nossa equipe vai analisar sua documentação e retornar em até 48 horas úteis via WhatsApp.
        </p>
        <a href="/" className="btn-base btn-outline mt-10 inline-flex">Voltar para a página inicial</a>
      </div>
    );
  }

  return (
    <div className="container-site py-12 md:py-16 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-10">
      <section>
        <div className="pill mb-5">Passo 1 de 3 · Informações</div>
        <h1 className="text-3xl md:text-5xl font-bold tracking-display-tight">
          Solicite sua <span className="text-gold-400">adesão</span> ao programa.
        </h1>
        <p className="mt-4 text-sand-100/70">Preencha com atenção. Retornaremos via WhatsApp em até 48h úteis.</p>

        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="field-label">Nome completo *</label>
              <input className="field-input" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} required /></div>
            <div><label className="field-label">E-mail *</label>
              <input className="field-input" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required /></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="field-label">Telefone / WhatsApp *</label>
              <input className="field-input" value={form.phone} onChange={(e) => update("phone", maskPhone(e.target.value))} required placeholder="(47) 99999-9999" /></div>
            <div><label className="field-label">CPF *</label>
              <input className="field-input" value={form.cpf} onChange={(e) => update("cpf", maskCpf(e.target.value))} required placeholder="000.000.000-00" /></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="field-label">RG *</label>
              <input className="field-input" value={form.rg} onChange={(e) => update("rg", e.target.value)} required /></div>
            <div><label className="field-label">Instagram</label>
              <input className="field-input" value={form.instagram} onChange={(e) => update("instagram", e.target.value)} placeholder="@seuperfil" /></div>
          </div>

          <div className="divider-gold my-2" />

          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="field-label">CRECI *</label>
              <input className="field-input" value={form.creci} onChange={(e) => update("creci", e.target.value)} required /></div>
            <div><label className="field-label">UF CRECI *</label>
              <select className="field-input" value={form.creciState} onChange={(e) => update("creciState", e.target.value)} required>
                {UFs.map((uf) => (<option key={uf} value={uf}>{uf}</option>))}
              </select>
            </div>
            <div><label className="field-label">Cidade de atuação *</label>
              <input className="field-input" value={form.city} onChange={(e) => update("city", e.target.value)} required /></div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="field-label">Imobiliária atual</label>
              <input className="field-input" value={form.currentAgency} onChange={(e) => update("currentAgency", e.target.value)} /></div>
            <div><label className="field-label">Tempo de mercado (anos)</label>
              <input className="field-input" type="number" min={0} max={80} value={form.yearsMarket} onChange={(e) => update("yearsMarket", e.target.value)} /></div>
          </div>

          <div>
            <label className="field-label">Foto da credencial CRECI *</label>
            <label className="flex items-center gap-4 cursor-pointer bg-app-subtle/60 border hairline border-white/10 rounded px-4 py-4 hover:border-gold-400/60 transition-colors">
              <span className="h-10 w-10 rounded border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400">
                <Upload size={18} />
              </span>
              <span className="flex flex-col flex-1 min-w-0">
                <span className="text-sm">{fileName || "Selecionar arquivo (JPG, PNG, WEBP, PDF · até 8MB)"}</span>
                <span className="text-xs text-sand-100/55">Clique para anexar</span>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f); setFileName(f?.name ?? "");
                }}
              />
            </label>
          </div>

          <div>
            <label className="field-label">Observações</label>
            <textarea className="field-input" rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Perfil, especialidade, idiomas…" />
          </div>

          <button className="btn-base btn-gold w-full" type="submit" disabled={submitting}>
            {submitting ? "Enviando…" : <>Enviar cadastro <ArrowRight size={14} /></>}
          </button>
          <p className="text-xs text-sand-100/55 text-center">Ao enviar, você concorda com o processo de análise interna da Calebe.</p>
        </form>
      </section>

      <aside className="lg:sticky lg:top-24 h-fit">
        <div className="card p-5 mb-4">
          <p className="pill mb-3">O que acontece depois</p>
          <ol className="space-y-3 mt-2">
            {[
              { n: 1, t: "Análise discreta", b: "Dados avaliados apenas pela equipe Calebe." },
              { n: 2, t: "CRECI validado", b: "Verificação manual junto ao órgão." },
              { n: 3, t: "Entrada gradual", b: "Aprovação conforme abertura de vagas." },
            ].map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="h-9 w-9 rounded border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400 shrink-0">{s.n}</span>
                <div>
                  <p className="font-medium">{s.t}</p>
                  <p className="text-xs text-sand-100/65">{s.b}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-sand-100/55 leading-relaxed">
          Dados tratados conforme LGPD. Finalidade: análise da adesão ao programa.
          Base legal: legítimo interesse + consentimento.
        </p>
      </aside>
    </div>
  );
}
