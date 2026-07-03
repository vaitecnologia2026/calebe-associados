// Métricas do sistema (DEV) · GET /api/_metrics
// Retorna snapshot do processo PM2 que respondeu (4 workers cluster, então
// cada call pode bater num PID diferente — usuário pode forçar refresh pra
// rotacionar). Slow queries só vêm com ?slow=1.
import { useEffect, useState } from "react";
import { RefreshCw, Cpu, MemoryStick, Database, Activity, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

interface MetricsResp {
  ok: boolean;
  pid: number;
  pm2InstanceId: number;
  nodeEnv: string;
  uptimeSec: number;
  startedAt: string;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    arrayBuffersMb: number;
  };
  eventLoop: {
    min: number; mean: number; max: number;
    p50: number; p90: number; p99: number;
    stddev: number;
  };
  cpu: {
    loadavg1m: number; loadavg5m: number; loadavg15m: number;
    cores: number;
  };
  queries: {
    total: number;
    slow: number;
    avgMs: number;
    bufferSize: number;
    threshold: number;
  };
  slowQueries?: Array<{
    sql?: string;
    durationMs?: number;
    params?: unknown;
    ts?: string;
  }>;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function loopTone(p99: number): string {
  if (p99 > 100) return "text-red-300";
  if (p99 > 50)  return "text-amber-300";
  return "text-emerald-300";
}

function memTone(used: number, total: number): string {
  const pct = total > 0 ? used / total : 0;
  if (pct > 0.85) return "text-red-300";
  if (pct > 0.65) return "text-amber-300";
  return "text-emerald-300";
}

export function DevMetrics() {
  const [data, setData] = useState<MetricsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [withSlow, setWithSlow] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<MetricsResp>(`/api/_metrics${withSlow ? "?slow=1" : ""}`);
      setData(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    void load();
    // Auto-refresh 30s
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withSlow]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Métricas do sistema"
        description="GET /api/_metrics · 4 workers PM2 cluster · cada call bate num PID aleatório"
        actions={
          <div className="flex gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 text-xs text-sand-100/65">
              <input type="checkbox" checked={withSlow} onChange={(e) => setWithSlow(e.target.checked)} />
              Slow queries
            </label>
            <Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>
          </div>
        }
      />

      {!data ? (
        <p className="card p-10 text-center text-sand-100/55">Carregando snapshot…</p>
      ) : (
        <>
          {/* Processo */}
          <section className="card p-4 mb-4">
            <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-2">Processo</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="PID" value={String(data.pid)} hint={`PM2 worker #${data.pm2InstanceId >= 0 ? data.pm2InstanceId : "?"}`} />
              <Stat label="Ambiente" value={data.nodeEnv} />
              <Stat label="Uptime" value={fmtUptime(data.uptimeSec)} hint={`desde ${new Date(data.startedAt).toLocaleString("pt-BR")}`} />
              <Stat label="CPU load (1m / 15m)" value={`${data.cpu.loadavg1m.toFixed(2)} / ${data.cpu.loadavg15m.toFixed(2)}`} hint={`${data.cpu.cores} cores`} />
            </div>
          </section>

          {/* Memória */}
          <section className="card p-4 mb-4">
            <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-2 inline-flex items-center gap-1.5">
              <MemoryStick size={12} /> Memória (deste worker)
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Stat label="RSS" value={`${data.memory.rssMb} MB`} hint="tudo o que o OS dá pro processo" />
              <Stat label="Heap usado" value={`${data.memory.heapUsedMb} MB`} hint={`${data.memory.heapTotalMb} MB alocado`} tone={memTone(data.memory.heapUsedMb, data.memory.heapTotalMb)} />
              <Stat label="External" value={`${data.memory.externalMb} MB`} hint="buffers nativos" />
              <Stat label="ArrayBuffers" value={`${data.memory.arrayBuffersMb} MB`} />
              <Stat label="Cores cluster" value={`${data.cpu.cores}`} hint="4 workers PM2" />
            </div>
          </section>

          {/* Event loop */}
          <section className="card p-4 mb-4">
            <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-2 inline-flex items-center gap-1.5">
              <Activity size={12} /> Event loop (últimos 60s)
            </p>
            <div className="grid grid-cols-2 md:grid-cols-7 gap-3 text-sm">
              <Stat label="Mean" value={`${data.eventLoop.mean} ms`} />
              <Stat label="p50" value={`${data.eventLoop.p50} ms`} />
              <Stat label="p90" value={`${data.eventLoop.p90} ms`} />
              <Stat label="p99" value={`${data.eventLoop.p99} ms`} tone={loopTone(data.eventLoop.p99)} hint=">100ms = problema" />
              <Stat label="Min" value={`${data.eventLoop.min} ms`} />
              <Stat label="Max" value={`${data.eventLoop.max} ms`} />
              <Stat label="StdDev" value={`${data.eventLoop.stddev} ms`} />
            </div>
            {data.eventLoop.p99 > 100 && (
              <p className="mt-2 text-xs text-red-300 inline-flex items-center gap-1.5">
                <AlertTriangle size={12} /> p99 alto · investigar query/handler bloqueante
              </p>
            )}
          </section>

          {/* Queries */}
          <section className="card p-4 mb-4">
            <p className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-2 inline-flex items-center gap-1.5">
              <Database size={12} /> Banco de dados
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Stat label="Queries totais" value={data.queries.total.toLocaleString("pt-BR")} />
              <Stat label="Slow queries" value={`${data.queries.slow}`} tone={data.queries.slow > 50 ? "text-amber-300" : ""} hint={`>${data.queries.threshold}ms`} />
              <Stat label="Avg" value={`${data.queries.avgMs} ms`} />
              <Stat label="Buffer" value={`${data.queries.bufferSize}`} hint="últimas slow em RAM" />
              <Stat label="Threshold" value={`${data.queries.threshold} ms`} hint="SLOW_QUERY_MS" />
            </div>

            {withSlow && data.slowQueries && data.slowQueries.length > 0 && (
              <div className="mt-3 border-t hairline pt-3">
                <p className="text-xs text-sand-100/65 mb-2">Últimas {data.slowQueries.length} slow queries:</p>
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {data.slowQueries.map((q, i) => (
                    <div key={i} className="bg-app-subtle/40 border hairline rounded p-2 text-[11px]">
                      <div className="flex justify-between items-baseline gap-2 mb-1">
                        <span className="text-amber-300 font-semibold">{q.durationMs ?? "?"} ms</span>
                        <span className="text-sand-100/45">{q.ts ? new Date(q.ts).toLocaleTimeString("pt-BR") : "—"}</span>
                      </div>
                      <pre className="text-sand-100/85 whitespace-pre-wrap break-all font-mono">{q.sql ?? "(sem SQL)"}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {withSlow && (!data.slowQueries || data.slowQueries.length === 0) && (
              <p className="mt-2 text-xs text-sand-100/55">
                Sem slow queries no buffer (pode precisar de token METRICS_TOKEN ou nenhuma query lenta foi capturada).
              </p>
            )}
          </section>

          <p className="text-xs text-sand-100/45 text-center">
            <Cpu size={11} className="inline -mt-0.5 mr-1" />
            Auto-refresh 30s · clique "Atualizar" pra rotacionar entre workers PM2 (PID muda)
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-mono-xwide text-sand-100/50">{label}</p>
      <p className={`font-bold text-base tabular-nums ${tone ?? "text-sand-50"}`}>{value}</p>
      {hint && <p className="text-[10px] text-sand-100/45 mt-0.5">{hint}</p>}
    </div>
  );
}
