// Admin revisa envios de permuta/avaliação. 2026-06-09
import { useEffect, useState } from "react";
import { api, getAuth, API_BASE } from "@/lib/api";

interface Permuta {
  id: string; associateNome?: string | null; nome: string; telefone?: string | null;
  tipoNegociacao: string; imovelAvaliacao?: string | null; imovelObs?: string | null;
  imovelFotos: string[]; carroFotos: string[]; carroDocUrl?: string | null;
  status: string; createdAt: string;
}

export function AdminPermutas() {
  const [list, setList] = useState<Permuta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: Permuta[] }>("/api/permutas").then((r) => setList(r.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function openFile(id: string, name: string) {
    const win = window.open("", "_blank");
    try {
      const url = `${API_BASE}/api/permutas/${id}/file/${encodeURIComponent(name)}`;
      const doFetch = (t?: string) => fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {}, credentials: "include" });
      let res = await doFetch(getAuth()?.accessToken);
      if (res.status === 401) { const nt = await api.refresh(); if (nt) res = await doFetch(nt); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      if (win) win.location.href = blobUrl; else window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch { if (win) win.close(); }
  }

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <p className="meta-gold">Administração</p>
        <h1 className="text-3xl font-bold tracking-display-tight mt-1">Permutas / Avaliações</h1>
        <p className="text-sand-100/55 text-sm mt-1">Envios dos corretores (imóvel ou carro) para análise.</p>
      </header>
      {loading ? <p className="text-sand-100/55 text-sm">Carregando…</p>
        : list.length === 0 ? <p className="text-sand-100/55 text-sm">Nenhum envio ainda.</p>
        : (
        <div className="space-y-4">
          {list.map((p) => (
            <div key={p.id} className="border hairline rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <b>{p.nome}</b>
                {p.telefone && <span className="text-sand-100/70 text-sm">{p.telefone}</span>}
                <span className="text-[0.65rem] uppercase tracking-mono-wide font-bold px-2 py-1 rounded" style={{ background: "rgba(231,192,99,.15)", color: "#E7C063" }}>{p.tipoNegociacao}</span>
                <span className="text-sand-100/45 text-xs">{new Date(p.createdAt).toLocaleString("pt-BR")}</span>
                {p.associateNome && <span className="text-sand-100/45 text-xs">· por {p.associateNome}</span>}
              </div>
              {p.imovelAvaliacao && <p className="text-sm"><b>Avaliação imóvel:</b> {p.imovelAvaliacao}</p>}
              {p.imovelObs && <p className="text-sm text-sand-100/70">Obs: {p.imovelObs}</p>}
              <div className="flex flex-wrap gap-2 mt-2">
                {p.imovelFotos.map((f, i) => <button key={f} className="btn btn-ghost" onClick={() => openFile(p.id, f)}>Imóvel foto {i + 1}</button>)}
                {p.carroFotos.map((f, i) => <button key={f} className="btn btn-ghost" onClick={() => openFile(p.id, f)}>Carro foto {i + 1}</button>)}
                {p.carroDocUrl && <button className="btn btn-ghost" onClick={() => openFile(p.id, p.carroDocUrl!)}>Doc do carro</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
