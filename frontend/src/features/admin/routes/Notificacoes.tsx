// Notificações push · admin · cobertura, tutoriais, testes
// GET /api/push/admin/coverage · /api/push/devices
// POST /api/push/admin/test/:userId · /api/push/admin/send-tutorial/:userId
import { useEffect, useState } from "react";
import { Send, BookOpen, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "../components/KpiCard";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";

interface Device {
  userId: string;
  userName?: string;
  email?: string;
  platform?: string;
  subscribedAt?: string;
  lastSeenAt?: string;
}
interface Coverage {
  total?: number;
  subscribed?: number;
  byPlatform?: Record<string, number>;
}

export function Notificacoes() {
  const [cov, setCov] = useState<Coverage | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const [c, d] = await Promise.all([
        api.get<Coverage>("/api/push/admin/coverage").catch(() => null),
        api.get<{ data: Device[] }>("/api/push/devices").catch(() => ({ data: [] })),
      ]);
      if (c) setCov(c);
      setDevices(d.data ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function sendTest(userId: string) {
    setBusyId(userId);
    try {
      await api.post(`/api/push/admin/test/${userId}`);
      showToast("Push de teste enviado");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setBusyId(null); }
  }
  async function sendTutorial(userId: string) {
    setBusyId(userId);
    try {
      await api.post(`/api/push/admin/send-tutorial/${userId}`);
      showToast("Tutorial enviado");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setBusyId(null); }
  }

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Notificações push"
        description="Cobertura, teste e envio de tutorial pra corretores"
        actions={
          <Button variant="outline" onClick={load} loading={loading}>
            <RefreshCw size={14} /> Atualizar
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total corretores" value={cov?.total ?? "—"} />
        <KpiCard label="Inscritos push" value={cov?.subscribed ?? "—"} accent="success" />
        <KpiCard
          label="Cobertura"
          value={cov?.total && cov?.subscribed ? `${Math.round((cov.subscribed / cov.total) * 100)}%` : "—"}
          accent="info"
        />
        <KpiCard
          label="iOS / Android"
          value={`${cov?.byPlatform?.ios ?? 0} / ${cov?.byPlatform?.android ?? 0}`}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Corretor</th>
              <th className="text-left p-3">Plataforma</th>
              <th className="text-left p-3">Inscrito</th>
              <th className="text-left p-3">Última atividade</th>
              <th className="text-right p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr><td colSpan={5} className="p-10 text-center text-sand-100/55">Nenhum dispositivo registrado.</td></tr>
            ) : devices.map((d) => (
              <tr key={d.userId} className="border-t hairline">
                <td className="p-3">
                  <p className="font-semibold">{d.userName ?? "—"}</p>
                  <p className="text-xs text-sand-100/55">{d.email ?? ""}</p>
                </td>
                <td className="p-3">
                  <StatusPill tone={d.platform === "ios" ? "info" : "neutral"}>{d.platform ?? "web"}</StatusPill>
                </td>
                <td className="p-3 text-xs text-sand-100/65">{d.subscribedAt?.slice(0, 10) ?? "—"}</td>
                <td className="p-3 text-xs text-sand-100/65">{d.lastSeenAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                <td className="p-3 text-right">
                  <div className="flex gap-1.5 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => sendTest(d.userId)}
                      loading={busyId === d.userId}
                      style={{ padding: ".4rem .7rem", fontSize: ".72rem" }}
                    >
                      <Send size={13} /> Teste
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => sendTutorial(d.userId)}
                      loading={busyId === d.userId}
                      style={{ padding: ".4rem .7rem", fontSize: ".72rem" }}
                    >
                      <BookOpen size={13} /> Tutorial
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
