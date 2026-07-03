// Simulador de parcelamento · porte FIEL ao monólito (linhas 4747-4845 + 19822-19927)
// SAC com correção CUB ou IPCA + juros extras opcionais

import { useEffect, useMemo, useState } from "react";
import { Calculator, Copy, FileText, X } from "lucide-react";
import { useUi } from "@/store/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  propertyName: string;
  devName?: string | null;
  valorInicial?: number | null;
  corretorName?: string;
}

type Indice = "cub" | "ipca";

function fmtBRL(v: number): string {
  if (!Number.isFinite(v)) return "R$ —";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function SimuladorModal({ open, onClose, propertyName, devName, valorInicial, corretorName }: Props) {
  const [valorTotal, setValorTotal] = useState<number>(0);
  const [entradaPct, setEntradaPct] = useState<number>(20);
  const [entradaVal, setEntradaVal] = useState<number>(0);
  const [parcelas, setParcelas] = useState<number>(60);
  const [indice, setIndice] = useState<Indice>("cub");
  const [indiceTaxa, setIndiceTaxa] = useState<number>(6.5);
  const [jurosExtra, setJurosExtra] = useState<number>(0);
  const showToast = useUi((s) => s.showToast);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    const v = valorInicial && valorInicial > 0 ? valorInicial : 0;
    setValorTotal(v);
    setEntradaPct(20);
    setEntradaVal(v * 0.2);
    setParcelas(60);
    setIndice("cub");
    setIndiceTaxa(6.5);
    setJurosExtra(0);
  }, [open, valorInicial]);

  // ESC fecha
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  // Recalcula entradaVal ao mudar pct
  function onPctChange(v: number) {
    setEntradaPct(v);
    setEntradaVal(valorTotal * v / 100);
  }
  function onValChange(v: number) {
    setEntradaVal(v);
    setEntradaPct(valorTotal > 0 ? (v / valorTotal) * 100 : 0);
  }

  // Cálculo SAC com correção · monólito linha 19878
  const calc = useMemo(() => {
    const N = Math.max(1, Math.min(600, parcelas));
    const saldoIni = Math.max(0, valorTotal - entradaVal);
    const parcBase = saldoIni / N;
    const indMensal = Math.pow(1 + indiceTaxa / 100, 1 / 12) - 1;
    const jurMensal = Math.pow(1 + jurosExtra / 100, 1 / 12) - 1;
    const fator = (m: number) => Math.pow(1 + indMensal + jurMensal, m);

    let totalPago = 0, parcIni = 0, parcFim = 0;
    const rows: { m: number; parc: number; saldo: number }[] = [];
    let saldo = saldoIni;
    for (let m = 1; m <= N; m++) {
      const p = parcBase * fator(m);
      totalPago += p;
      saldo -= parcBase;
      if (m === 1) parcIni = p;
      if (m === N) parcFim = p;
      if (m === 1 || m === Math.round(N / 2) || m === N) {
        rows.push({ m, parc: p, saldo: Math.max(0, saldo) });
      }
    }
    return { saldoIni, parcIni, parcFim, totalFinal: entradaVal + totalPago, rows };
  }, [valorTotal, entradaVal, parcelas, indiceTaxa, jurosExtra]);

  function copiarResumo() {
    const lines = [
      `Simulação · ${propertyName}`,
      devName ? `Empreendimento: ${devName}` : null,
      `Valor total: ${fmtBRL(valorTotal)}`,
      `Entrada (${entradaPct.toFixed(1)}%): ${fmtBRL(entradaVal)}`,
      `Saldo a financiar: ${fmtBRL(calc.saldoIni)}`,
      `${parcelas}x · Parcela inicial ${fmtBRL(calc.parcIni)} · final ${fmtBRL(calc.parcFim)}`,
      `Índice: ${indice.toUpperCase()} ${indiceTaxa}% a.a.${jurosExtra > 0 ? ` + ${jurosExtra}% extra` : ""}`,
      `Total estimado: ${fmtBRL(calc.totalFinal)}`,
    ].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(lines).then(
      () => showToast("Resumo copiado"),
      () => showToast("Falha ao copiar")
    );
  }

  // Gera PDF via window.print de uma janela nova estilizada (monólito 19930)
  function gerarPDF() {
    const data = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    const corretor = corretorName ?? "—";
    const rowsHtml = calc.rows.map((r) =>
      `<tr><td>${r.m}</td><td class="num">${fmtBRL(r.parc)}</td><td class="num">${fmtBRL(r.saldo)}</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Simulação · ${propertyName}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
body{ font-family: 'Helvetica Neue', Arial, sans-serif; color:#04101F; margin:0; }
.header{ border-bottom: 3px solid #C9A961; padding-bottom: 16px; margin-bottom: 28px; display:flex; align-items:center; justify-content:space-between; gap:20px; }
.logo{ font-family: 'Georgia', serif; font-weight:700; font-size: 32px; letter-spacing:-.02em; color:#04101F; }
.logo small{ display:block; font-size:11px; font-weight:600; letter-spacing:.18em; text-transform:uppercase; color:#C9A961; margin-top:2px; }
.meta{ text-align:right; font-size: 11px; color:#666; line-height:1.5; }
h1{ font-size: 22px; margin: 0 0 6px; font-weight: 700; letter-spacing:-.02em; }
h2{ font-size: 12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#C9A961; margin:28px 0 10px; border-bottom: 1px solid #e0d4b3; padding-bottom: 4px; }
.empreendimento{ font-size: 13px; color:#666; margin-bottom:24px; }
.resumo{ display:grid; grid-template-columns: repeat(3,1fr); gap:12px; margin:8px 0 16px; }
.resumo .card{ border:1px solid #e0d4b3; border-radius:6px; padding:12px 14px; background:#fbf9f4; }
.resumo .label{ font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#888; margin-bottom:4px; }
.resumo .valor{ font-size:18px; font-weight:700; color:#04101F; }
.resumo .valor.gold{ color:#C9A961; }
.destaque{ background: linear-gradient(135deg,#C9A961,#DEB96D); color:#04101F; padding:18px 22px; border-radius:8px; margin:16px 0; display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.destaque .label{ font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; opacity:.8; margin-bottom:4px; }
.destaque .valor{ font-size:22px; font-weight:700; }
table{ width:100%; border-collapse:collapse; margin-top:8px; }
th{ font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:#888; text-align:left; padding:6px 10px; border-bottom:1px solid #ddd; }
td{ font-size:12px; padding:6px 10px; border-bottom:1px solid #f0ebd9; }
td.num{ text-align:right; font-family: monospace; }
.disclaimer{ font-size:10px; color:#777; font-style:italic; margin-top:24px; padding-top:12px; border-top:1px dashed #ccc; line-height:1.5; }
</style></head><body>
<div class="header">
  <div class="logo">CALEBE<small>Investimentos Imobiliários</small></div>
  <div class="meta"><strong>${corretor}</strong><br>Simulação emitida em ${data}</div>
</div>
<h1>${propertyName}</h1>
<p class="empreendimento">${devName ?? "Unidade avulsa"}</p>
<h2>Condições da simulação</h2>
<div class="resumo">
  <div class="card"><div class="label">Valor total</div><div class="valor">${fmtBRL(valorTotal)}</div></div>
  <div class="card"><div class="label">Entrada (${entradaPct.toFixed(1)}%)</div><div class="valor">${fmtBRL(entradaVal)}</div></div>
  <div class="card"><div class="label">Saldo a financiar</div><div class="valor">${fmtBRL(calc.saldoIni)}</div></div>
</div>
<h2>Parcelamento</h2>
<div class="destaque">
  <div><div class="label">${parcelas}x Parcela inicial</div><div class="valor">${fmtBRL(calc.parcIni)}</div></div>
  <div><div class="label">Parcela final estimada</div><div class="valor">${fmtBRL(calc.parcFim)}</div></div>
</div>
<p style="font-size:12px;color:#666;margin:8px 0;">
  Índice: <strong>${indice === "cub" ? "CUB (mensal · Sinduscon)" : "IPCA (mensal)"}</strong> · taxa anual ${indiceTaxa}% ${jurosExtra > 0 ? `· juros adicionais ${jurosExtra}% a.a.` : ""}
</p>
<h2>Parcelas representativas</h2>
<table>
  <thead><tr><th>Mês</th><th class="num">Valor da parcela</th><th class="num">Saldo restante</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
<h2>Total estimado</h2>
<div class="resumo">
  <div class="card" style="grid-column:1/span 3;background:linear-gradient(135deg,#fbf9f4,#f5efe4);"><div class="label">Total ao final (entrada + parcelas)</div><div class="valor gold" style="font-size:26px">${fmtBRL(calc.totalFinal)}</div></div>
</div>
<p class="disclaimer">⚠ Simulação estimativa · valores reais dependem da política da incorporadora, índice oficial mensal e do contrato.</p>
<script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { showToast("Bloqueador de pop-up impediu o PDF"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center bg-navy-950/90 backdrop-blur-md p-0 md:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-app-elevated border hairline rounded-none md:rounded-[6px] my-0 md:my-6 relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 md:px-7 py-5 border-b hairline flex items-center justify-between sticky top-0 bg-app-elevated z-10">
          <div>
            <p className="meta-gold mb-1 inline-flex items-center gap-1.5">
              <Calculator size={13} /> Simulador
            </p>
            <h2 className="text-xl md:text-2xl font-bold tracking-display-tight">{propertyName}</h2>
            <p className="text-xs text-sand-100/60 mt-1">{devName ?? "Unidade avulsa"}</p>
          </div>
          <button
            onClick={onClose}
            className="h-10 w-10 inline-flex items-center justify-center text-sand-100/60 hover:text-sand-50 hover:bg-white/5 rounded-[4px]"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 p-5 md:p-7 grid lg:grid-cols-2 gap-5">
          {/* Inputs */}
          <section>
            <h3 className="text-sm font-bold uppercase tracking-mono-wide text-gold-400/80 mb-3">Condições</h3>
            <div className="space-y-3">
              <div>
                <label className="field-label">Valor total do imóvel</label>
                <input
                  className="field-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={valorTotal || ""}
                  onChange={(e) => { const v = Number(e.target.value) || 0; setValorTotal(v); setEntradaVal(v * entradaPct / 100); }}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Entrada (%)</label>
                  <input
                    className="field-input"
                    type="number" step="0.5" min="0" max="100"
                    value={entradaPct}
                    onChange={(e) => onPctChange(Number(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="field-label">Entrada (R$)</label>
                  <input
                    className="field-input"
                    type="number" step="0.01" min="0"
                    value={Number.isFinite(entradaVal) ? entradaVal.toFixed(2) : 0}
                    onChange={(e) => onValChange(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div>
                <label className="field-label">Número de parcelas</label>
                <input
                  className="field-input"
                  type="number" min="1" max="600"
                  value={parcelas}
                  onChange={(e) => setParcelas(Math.max(1, Math.min(600, parseInt(e.target.value, 10) || 1)))}
                />
              </div>
              <div>
                <label className="field-label">Índice de correção</label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`card p-3 cursor-pointer flex items-center gap-2 ${indice === "cub" ? "border-gold-400 bg-gold-400/10" : ""}`}>
                    <input type="radio" name="simIndice" value="cub" checked={indice === "cub"} onChange={() => setIndice("cub")} className="accent-gold-400" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold">CUB</p>
                      <p className="text-[0.65rem] text-sand-100/55">Mensal · Sinduscon</p>
                    </div>
                  </label>
                  <label className={`card p-3 cursor-pointer flex items-center gap-2 ${indice === "ipca" ? "border-gold-400 bg-gold-400/10" : ""}`}>
                    <input type="radio" name="simIndice" value="ipca" checked={indice === "ipca"} onChange={() => setIndice("ipca")} className="accent-gold-400" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold">IPCA + %</p>
                      <p className="text-[0.65rem] text-sand-100/55">Anual + juros</p>
                    </div>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">
                    {indice === "cub" ? "CUB anual estimado (%)" : "IPCA anual estimado (%)"}
                  </label>
                  <input
                    className="field-input"
                    type="number" step="0.1" min="0"
                    value={indiceTaxa}
                    onChange={(e) => setIndiceTaxa(Number(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="field-label">Juros adicionais (% a.a.)</label>
                  <input
                    className="field-input"
                    type="number" step="0.1" min="0"
                    value={jurosExtra}
                    onChange={(e) => setJurosExtra(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Output */}
          <section>
            <h3 className="text-sm font-bold uppercase tracking-mono-wide text-gold-400/80 mb-3">Resumo</h3>
            <div className="card p-4 space-y-2.5 mb-4 bg-app-subtle/30">
              <Row label="Entrada" value={fmtBRL(entradaVal)} />
              <Row label="Saldo a financiar" value={fmtBRL(calc.saldoIni)} />
              <Row label="Parcela inicial" value={fmtBRL(calc.parcIni)} highlight />
              <Row label="Parcela final (estimada)" value={fmtBRL(calc.parcFim)} />
              <div className="border-t hairline pt-2.5 mt-2.5" />
              <div className="flex justify-between text-base">
                <span className="text-sand-100/65 font-semibold">Total ao final</span>
                <span className="font-bold text-sand-50">{fmtBRL(calc.totalFinal)}</span>
              </div>
            </div>
            <div className="card p-3 overflow-hidden">
              <p className="text-[0.65rem] uppercase tracking-mono-wide font-bold text-sand-100/55 mb-2">Parcelas chave</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-sand-100/55 text-[0.65rem] uppercase tracking-mono-wide">
                    <tr><th className="text-left py-1">Mês</th><th className="text-right py-1">Valor</th><th className="text-right py-1">Saldo</th></tr>
                  </thead>
                  <tbody>
                    {calc.rows.length === 0 ? (
                      <tr><td colSpan={3} className="py-3 text-center text-sand-100/45">—</td></tr>
                    ) : calc.rows.map((r) => (
                      <tr key={r.m} className="border-t hairline">
                        <td className="py-1.5">Mês {r.m}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtBRL(r.parc)}</td>
                        <td className="py-1.5 text-right tabular-nums text-sand-100/65">{fmtBRL(r.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[0.66rem] text-sand-100/45 mt-3 italic">
              ⚠ Simulação estimativa · valores reais dependem da política da incorporadora, índice oficial mensal e do contrato.
            </p>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 md:px-7 py-4 border-t hairline sticky bottom-0 bg-app-elevated flex-wrap">
          <button className="btn-base btn-outline" style={{ padding: ".55rem 1.1rem" }} onClick={onClose}>Fechar</button>
          <button className="btn-base btn-outline inline-flex items-center gap-1.5" style={{ padding: ".55rem 1.1rem" }} onClick={copiarResumo}>
            <Copy size={13} /> Copiar resumo
          </button>
          <button className="btn-base btn-gold inline-flex items-center gap-1.5" style={{ padding: ".55rem 1.25rem" }} onClick={gerarPDF}>
            <FileText size={13} /> Gerar PDF
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-sand-100/65">{label}</span>
      <span className={highlight ? "font-bold text-gold-300" : "font-semibold"}>{value}</span>
    </div>
  );
}
