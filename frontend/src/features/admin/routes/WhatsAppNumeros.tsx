import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface NumeroWABA {
  id: string;
  numero: string;
  qualidade: "GREEN" | "YELLOW" | "RED" | string;
  status: string;
  canSend: "AVAILABLE" | "LIMITED" | "BLOCKED" | string;
  envios_hoje: number;
  envios_48h: number;
  envios_total: number;
  lidas_48h: number;
  entregues_48h: number;
  falhas_48h: number;
  throttle_48h: number;
  no_wa_48h: number;
  taxa_sucesso: number | null;
}

interface Totais {
  envios_48h: number;
  envios_hoje: number;
  lidas_48h: number;
  entregues_48h: number;
  falhas_48h: number;
  throttle_48h: number;
}

interface Resp {
  ok: boolean;
  numeros: NumeroWABA[];
  totais: Totais;
  geradoEm: string;
}

const SUPORTE_IDS = new Set(["1143966188797246", "1155522184305211"]);

function QualBadge({ q, canSend }: { q: string; canSend: string }) {
  if (q === "GREEN" && canSend === "AVAILABLE")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
        Verde
      </span>
    );
  if (q === "YELLOW" || canSend === "LIMITED")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        Amarelo
      </span>
    );
  if (q === "RED" || canSend === "BLOCKED")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
        <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
        Vermelho
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-sand-100/50">
      <span className="w-2 h-2 rounded-full bg-sand-100/30 shrink-0" />
      {q}
    </span>
  );
}

function TaxaBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-sand-100/40 text-xs">—</span>;
  const color = pct >= 50 ? "bg-emerald-500" : pct >= 25 ? "bg-amber-500" : "bg-red-500";
  const textColor = pct >= 50 ? "text-emerald-400" : pct >= 25 ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <span className={`text-xs font-medium tabular-nums w-8 shrink-0 ${textColor}`}>{pct}%</span>
      <div className="flex-1 h-1.5 rounded-full bg-sand-100/10 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function n(v: number) {
  return v.toLocaleString("pt-BR");
}

export function WhatsAppNumeros() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.get<Resp>("/api/whatsapp/numeros");
      setData(resp);
      setLastFetch(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const verdes   = data?.numeros.filter(n => n.qualidade === "GREEN" && n.canSend === "AVAILABLE").length ?? 0;
  const amarelos = data?.numeros.filter(n => n.qualidade === "YELLOW" || n.canSend === "LIMITED").length ?? 0;
  const vermelhos= data?.numeros.filter(n => n.qualidade === "RED"    || n.canSend === "BLOCKED").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-sand-100">Números WhatsApp</h1>
          <p className="text-xs text-sand-100/50 mt-0.5">
            WABA · qualidade Meta + envios das últimas 48h
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="text-xs text-sand-100/40">
              Atualizado {lastFetch.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-sand-100/15 text-sand-100/70 hover:bg-sand-100/5 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Números verdes",   value: verdes,                     icon: CheckCircle2, color: "text-emerald-400" },
            { label: "Números amarelos", value: amarelos,                   icon: AlertTriangle, color: "text-amber-400" },
            { label: "Envios hoje",      value: n(data.totais.envios_hoje), icon: Wifi,          color: "text-sand-100" },
            { label: "Envios 48h",       value: n(data.totais.envios_48h),  icon: Wifi,          color: "text-sand-100" },
            { label: "Lidas 48h",        value: n(data.totais.lidas_48h),   icon: CheckCircle2,  color: "text-emerald-400" },
            { label: "Throttle 131049",  value: n(data.totais.throttle_48h),icon: WifiOff,       color: "text-amber-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card p-4 space-y-1">
              <div className={`flex items-center gap-1.5 text-xs text-sand-100/50`}>
                <Icon size={12} className={color} />
                {label}
              </div>
              <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Estado de loading/erro */}
      {loading && !data && (
        <div className="card p-10 flex items-center justify-center gap-3 text-sand-100/50">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Consultando Meta API…</span>
        </div>
      )}

      {error && (
        <div className="card p-5 border-red-500/30 bg-red-500/10">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Tabela */}
      {data && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100/10">
                  {["Número", "Qualidade", "Hoje", "48h", "Total", "Lidas", "Entregues", "Falhas", "Throttle", "Taxa sucesso"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-sand-100/50 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.numeros
                  .slice()
                  .sort((a, b) => b.envios_48h - a.envios_48h)
                  .map(num => {
                    const isSuport = SUPORTE_IDS.has(num.id);
                    const isYellow = num.qualidade === "YELLOW" || num.canSend === "LIMITED";
                    const isRed    = num.qualidade === "RED"    || num.canSend === "BLOCKED";
                    return (
                      <tr
                        key={num.id}
                        className={`border-b border-sand-100/5 hover:bg-sand-100/3 transition-colors ${
                          isRed ? "bg-red-500/5" : isYellow ? "bg-amber-500/5" : ""
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sand-100">{num.numero}</span>
                            {isSuport && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-medium">
                                suporte
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <QualBadge q={num.qualidade} canSend={num.canSend} />
                        </td>
                        <td className="px-4 py-3 tabular-nums text-sand-100/70">{n(num.envios_hoje)}</td>
                        <td className="px-4 py-3 tabular-nums font-medium text-sand-100">{n(num.envios_48h)}</td>
                        <td className="px-4 py-3 tabular-nums text-sand-100/50">{n(num.envios_total)}</td>
                        <td className="px-4 py-3 tabular-nums text-emerald-400">{n(num.lidas_48h)}</td>
                        <td className="px-4 py-3 tabular-nums text-sand-100/70">{n(num.entregues_48h)}</td>
                        <td className="px-4 py-3 tabular-nums text-red-400/80">{n(num.falhas_48h)}</td>
                        <td className="px-4 py-3 tabular-nums text-amber-400/80">{n(num.throttle_48h)}</td>
                        <td className="px-4 py-3">
                          <TaxaBar pct={num.taxa_sucesso} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-sand-100/5 flex items-center justify-between text-xs text-sand-100/40">
            <span>{data.numeros.length} números · WABA 910162028578816</span>
            <span>Atualiza automaticamente a cada 5 minutos</span>
          </div>
        </div>
      )}
    </div>
  );
}
