// Corretor envia permuta/avaliação (imóvel ou carro). 2026-06-09
import { useState } from "react";
import { getAuth } from "@/lib/api";

const FIPE = "https://veiculos.fipe.org.br/";
const DETRAN: Record<string, string> = {
  SC: "https://www.detran.sc.gov.br/",
  SP: "https://www.detran.sp.gov.br/",
  RS: "https://www.detran.rs.gov.br/",
  PR: "https://www.detran.pr.gov.br/",
};

export function CorretorPermuta() {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [tipo, setTipo] = useState("Permuta por imóvel");
  const [imovelAvaliacao, setImovelAvaliacao] = useState("");
  const [imovelObs, setImovelObs] = useState("");
  const [imovelFotos, setImovelFotos] = useState<FileList | null>(null);
  const [carroFotos, setCarroFotos] = useState<FileList | null>(null);
  const [carroDoc, setCarroDoc] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { setErr("Informe o nome"); return; }
    setSaving(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("nome", nome); fd.append("telefone", telefone); fd.append("tipoNegociacao", tipo);
      fd.append("imovelAvaliacao", imovelAvaliacao); fd.append("imovelObs", imovelObs);
      if (imovelFotos) Array.from(imovelFotos).forEach((f) => fd.append("imovelFotos", f));
      if (carroFotos) Array.from(carroFotos).forEach((f) => fd.append("carroFotos", f));
      if (carroDoc) fd.append("carroDoc", carroDoc);
      const token = getAuth()?.accessToken;
      const res = await fetch("/api/permutas", {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (!res.ok) { setErr("Falha ao enviar. Tente novamente."); setSaving(false); return; }
      setMsg("✅ Enviado! A equipe vai avaliar e retornar.");
      setNome(""); setTelefone(""); setImovelAvaliacao(""); setImovelObs("");
      setImovelFotos(null); setCarroFotos(null); setCarroDoc(null);
      (e.target as HTMLFormElement).reset();
      setSaving(false);
    } catch { setErr("Erro de conexão."); setSaving(false); }
  }

  return (
    <div className="p-6 md:p-8" style={{ maxWidth: 760 }}>
      <header className="mb-6">
        <p className="meta-gold">Corretor</p>
        <h1 className="text-3xl font-bold tracking-display-tight mt-1">Permuta / Avaliação</h1>
        <p className="text-sand-100/55 text-sm mt-1">Envie uma permuta de imóvel ou avaliação de carro para a equipe analisar.</p>
      </header>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="field-label">Nome do corretor associado *</label>
            <input className="field-input" value={nome} onChange={(e) => setNome(e.target.value)} required /></div>
          <div><label className="field-label">Telefone</label>
            <input className="field-input" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(47) 99999-9999" /></div>
        </div>
        <div><label className="field-label">Tipo de negociação</label>
          <select className="field-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option>Permuta por imóvel</option>
            <option>Permuta por carro</option>
            <option>Venda</option>
            <option>Outro</option>
          </select></div>

        <fieldset className="border hairline rounded-xl p-4 space-y-3">
          <legend className="px-2 text-sm font-bold" style={{ color: "#E7C063" }}>Permuta por imóvel</legend>
          <div><label className="field-label">Avaliação (valor)</label>
            <input className="field-input" value={imovelAvaliacao} onChange={(e) => setImovelAvaliacao(e.target.value)} placeholder="R$ ..." /></div>
          <div><label className="field-label">Fotos do imóvel</label>
            <input className="field-input" type="file" accept="image/*" multiple onChange={(e) => setImovelFotos(e.target.files)} /></div>
          <div><label className="field-label">Observações</label>
            <textarea className="field-input" rows={3} value={imovelObs} onChange={(e) => setImovelObs(e.target.value)} /></div>
        </fieldset>

        <fieldset className="border hairline rounded-xl p-4 space-y-3">
          <legend className="px-2 text-sm font-bold" style={{ color: "#E7C063" }}>Avaliação de carro</legend>
          <div><label className="field-label">Fotos do carro</label>
            <input className="field-input" type="file" accept="image/*" multiple onChange={(e) => setCarroFotos(e.target.files)} /></div>
          <div><label className="field-label">Documento do carro (foto ou PDF)</label>
            <input className="field-input" type="file" accept="image/*,application/pdf" onChange={(e) => setCarroDoc(e.target.files?.[0] || null)} /></div>
          <div>
            <p className="field-label">Consultas rápidas</p>
            <div className="flex flex-wrap gap-2">
              <a href={FIPE} target="_blank" rel="noreferrer" className="btn btn-ghost">Tabela FIPE</a>
              <a href={DETRAN.SC} target="_blank" rel="noreferrer" className="btn btn-ghost">Detran SC</a>
              <a href={DETRAN.SP} target="_blank" rel="noreferrer" className="btn btn-ghost">Detran SP</a>
              <a href={DETRAN.RS} target="_blank" rel="noreferrer" className="btn btn-ghost">Detran RS</a>
              <a href={DETRAN.PR} target="_blank" rel="noreferrer" className="btn btn-ghost">Detran PR</a>
            </div>
          </div>
        </fieldset>

        {err && <p className="text-sm" style={{ color: "#F26D6D" }}>{err}</p>}
        {msg && <p className="text-sm" style={{ color: "#5FD1A8" }}>{msg}</p>}
        <button type="submit" className="btn btn-gold" disabled={saving}>{saving ? "Enviando..." : "Enviar para avaliação"}</button>
      </form>
    </div>
  );
}
