// LPs · configura tracking Facebook Pixel + Google Ads + LP video padrão
// + override por par corretor×imóvel (lp.tracking.byCorretorImovel JSON)
//
// PATCH /api/settings/tracking.fb / /tracking.gads / /lp.video / /lp.tracking.byCorretorImovel
import { useEffect, useMemo, useState } from "react";
import { Trash2, Plus, Save as SaveIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

interface Settings {
  "tracking.fb"?: string;
  "tracking.gads"?: string;
  "lp.video"?: string;
  "lp.tracking.byCorretorImovel"?: string | LpTrackingMap;
  [k: string]: string | LpTrackingMap | undefined;
}

// Estrutura espelhada do monólito linha 8897:
//   { [corretorId]: { byImovel: { [propertyCode]: { fb, gads } } } }
type LpTrackingMap = Record<string, { byImovel?: Record<string, { fb?: string; gads?: string }> }>;

interface AssociateBrief { id: string; user?: { id?: string; name?: string } | null }
interface PropertyBrief { id: string; code?: string; title?: string }

function parseTrackingMap(v: string | LpTrackingMap | undefined): LpTrackingMap {
  if (!v) return {};
  if (typeof v === "object") return v;
  try { return JSON.parse(v) as LpTrackingMap; } catch { return {}; }
}

export function Lps() {
  const [fb, setFb] = useState("");
  const [gads, setGads] = useState("");
  const [video, setVideo] = useState("");
  const [trackingMap, setTrackingMap] = useState<LpTrackingMap>({});
  const [associates, setAssociates] = useState<AssociateBrief[]>([]);
  const [properties, setProperties] = useState<PropertyBrief[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const showToast = useUi((s) => s.showToast);

  // Form pra adicionar override novo
  const [newCorretor, setNewCorretor] = useState("");
  const [newImovel, setNewImovel] = useState("");
  const [newFb, setNewFb] = useState("");
  const [newGads, setNewGads] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [settings, assocs, props] = await Promise.all([
          api.get<Settings>("/api/settings"),
          api.get<{ data: AssociateBrief[] }>("/api/associates?limit=1000").catch(() => ({ data: [] })),
          api.get<{ data: PropertyBrief[] }>("/api/properties?limit=2000").catch(() => ({ data: [] })),
        ]);
        setFb(typeof settings["tracking.fb"] === "string" ? settings["tracking.fb"] as string : "");
        setGads(typeof settings["tracking.gads"] === "string" ? settings["tracking.gads"] as string : "");
        setVideo(typeof settings["lp.video"] === "string" ? settings["lp.video"] as string : "");
        setTrackingMap(parseTrackingMap(settings["lp.tracking.byCorretorImovel"]));
        setAssociates(assocs.data ?? []);
        setProperties(props.data ?? []);
      } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    })();
  }, [showToast]);

  async function saveAll() {
    setLoading(true);
    try {
      await Promise.all([
        api.patch("/api/settings/tracking.fb", { value: fb }),
        api.patch("/api/settings/tracking.gads", { value: gads }),
        api.patch("/api/settings/lp.video", { value: video }),
      ]);
      showToast("Configurações padrão salvas");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setLoading(false); }
  }

  async function persistTrackingMap(next: LpTrackingMap) {
    setSavingOverride(true);
    try {
      await api.patch("/api/settings/lp.tracking.byCorretorImovel", { value: next });
      setTrackingMap(next);
      showToast("Overrides salvos");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSavingOverride(false); }
  }

  function addOverride() {
    if (!newCorretor || !newImovel) { showToast("Escolha corretor e imóvel"); return; }
    if (!newFb.trim() && !newGads.trim()) { showToast("Preencha FB e/ou Google Ads"); return; }
    const next: LpTrackingMap = JSON.parse(JSON.stringify(trackingMap));
    if (!next[newCorretor]) next[newCorretor] = {};
    if (!next[newCorretor].byImovel) next[newCorretor].byImovel = {};
    next[newCorretor].byImovel![newImovel] = {
      ...(newFb.trim() ? { fb: newFb.trim() } : {}),
      ...(newGads.trim() ? { gads: newGads.trim() } : {}),
    };
    void persistTrackingMap(next);
    setNewCorretor(""); setNewImovel(""); setNewFb(""); setNewGads("");
  }

  function removeOverride(corretorId: string, imovelKey: string) {
    if (!confirm("Remover esse override?")) return;
    const next: LpTrackingMap = JSON.parse(JSON.stringify(trackingMap));
    if (next[corretorId]?.byImovel) {
      delete next[corretorId].byImovel![imovelKey];
      if (Object.keys(next[corretorId].byImovel ?? {}).length === 0) delete next[corretorId];
    }
    void persistTrackingMap(next);
  }

  const overrideRows = useMemo(() => {
    const out: Array<{ corretorId: string; corretor: string; imovelKey: string; imovelLabel: string; fb?: string; gads?: string }> = [];
    for (const [cid, blob] of Object.entries(trackingMap)) {
      const corretor = associates.find((a) => a.id === cid || a.user?.id === cid)?.user?.name ?? cid;
      for (const [ik, val] of Object.entries(blob.byImovel ?? {})) {
        const p = properties.find((pp) => pp.code === ik || pp.id === ik);
        const imovelLabel = p ? `${p.code ?? p.id} · ${p.title ?? ""}`.trim() : ik;
        out.push({ corretorId: cid, corretor, imovelKey: ik, imovelLabel, fb: val.fb, gads: val.gads });
      }
    }
    return out.sort((a, b) => a.corretor.localeCompare(b.corretor));
  }, [trackingMap, associates, properties]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Landing Pages"
        description="Tracking pixels padrão + vídeo de boas-vindas + overrides por par corretor×imóvel (cascata: imóvel → corretor → sistema)"
      />

      <section className="card p-5 mb-4">
        <h2 className="font-bold mb-3">Tracking padrão (todos os corretores)</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Facebook Pixel ID" value={fb} onChange={(e) => setFb(e.target.value)} placeholder="000000000000000" />
          <Field label="Google Ads conversion ID" value={gads} onChange={(e) => setGads(e.target.value)} placeholder="AW-XXXXXXXXX" />
        </div>
      </section>

      <section className="card p-5 mb-4">
        <h2 className="font-bold mb-3">Vídeo de boas-vindas (LP pública)</h2>
        <Field
          label="URL ou caminho relativo"
          value={video}
          onChange={(e) => setVideo(e.target.value)}
          placeholder="/videos/hero-lp.mp4"
          hint="O vídeo do hero da LP institucional. Deixe vazio pra usar o padrão"
        />
      </section>

      <div className="text-right mb-6">
        <Button variant="gold" onClick={saveAll} loading={loading}>
          <SaveIcon size={14} /> Salvar padrão
        </Button>
      </div>

      {/* OVERRIDES POR CORRETOR × IMÓVEL */}
      <section className="card p-5">
        <h2 className="font-bold mb-1">Overrides por corretor × imóvel</h2>
        <p className="text-xs text-sand-100/65 mb-4">
          Quando configurado, o pixel/conversion do par <em>corretor × imóvel</em> sobrescreve o padrão acima.
          Cascata: <strong>imóvel → corretor → sistema</strong>. Use pra rodar ads dedicados.
        </p>

        {/* Form de novo override */}
        <div className="border hairline rounded p-3 mb-4 bg-app-subtle/30">
          <p className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-sand-100/55 mb-2">Adicionar override</p>
          <div className="grid md:grid-cols-2 gap-2 mb-2">
            <select className="field-input text-sm" value={newCorretor} onChange={(e) => setNewCorretor(e.target.value)}>
              <option value="">Corretor…</option>
              {associates.map((a) => (
                <option key={a.id} value={a.id}>{a.user?.name ?? a.id}</option>
              ))}
            </select>
            <select className="field-input text-sm" value={newImovel} onChange={(e) => setNewImovel(e.target.value)}>
              <option value="">Imóvel…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.code ?? p.id}>{(p.code ?? p.id)} · {p.title ?? ""}</option>
              ))}
            </select>
          </div>
          <div className="grid md:grid-cols-2 gap-2 mb-2">
            <input type="text" className="field-input text-sm" value={newFb} onChange={(e) => setNewFb(e.target.value)} placeholder="Facebook Pixel ID (opcional)" />
            <input type="text" className="field-input text-sm" value={newGads} onChange={(e) => setNewGads(e.target.value)} placeholder="Google Ads conv. ID (opcional)" />
          </div>
          <div className="text-right">
            <Button variant="outline" onClick={addOverride} disabled={savingOverride} style={{ padding: ".4rem .9rem", fontSize: ".75rem" }}>
              <Plus size={13} /> Adicionar
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
              <tr>
                <th className="text-left p-2">Corretor</th>
                <th className="text-left p-2">Imóvel</th>
                <th className="text-left p-2">FB Pixel</th>
                <th className="text-left p-2">Google Ads</th>
                <th className="text-right p-2"></th>
              </tr>
            </thead>
            <tbody>
              {overrideRows.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-xs text-sand-100/55">Nenhum override configurado. Todos usam o padrão acima.</td></tr>
              ) : overrideRows.map((row) => (
                <tr key={`${row.corretorId}|${row.imovelKey}`} className="border-t hairline">
                  <td className="p-2 text-xs">{row.corretor}</td>
                  <td className="p-2 text-xs">{row.imovelLabel}</td>
                  <td className="p-2 text-xs font-mono">{row.fb ?? "—"}</td>
                  <td className="p-2 text-xs font-mono">{row.gads ?? "—"}</td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeOverride(row.corretorId, row.imovelKey)}
                      disabled={savingOverride}
                      className="text-red-300 hover:text-red-200 disabled:opacity-50"
                      title="Remover override"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
