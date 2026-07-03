// Notificações push (corretor) · usa lib/pwa.ts subscribePush
import { useEffect, useState } from "react";
import { Bell, BellOff, Download } from "lucide-react";
import { diagnose, subscribePush, promptInstall } from "@/lib/pwa";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";

export function CorretorNotificacoes() {
  const [diag, setDiag] = useState<any>(null);
  const showToast = useUi((s) => s.showToast);

  async function refresh() { setDiag(await diagnose()); }
  useEffect(() => { void refresh(); }, []);

  async function ativar() {
    const r = await subscribePush();
    if (r.ok) showToast("Notificações ativadas");
    else showToast(`Falha: ${r.reason}`);
    await refresh();
  }
  async function desativar() {
    try {
      await api.post("/api/push/unsubscribe");
      showToast("Notificações desativadas");
      await refresh();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }
  async function teste() {
    try {
      await api.post("/api/push/test");
      showToast("Push de teste disparado · cheque o dispositivo");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }
  async function install() {
    const r = await promptInstall();
    if (!r.ok) showToast(`Não foi possível instalar: ${r.reason}`);
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <PageHeader eyebrow="Configurações" title="Notificações" description="Ative push pra receber novos leads e mensagens em tempo real" />

      <section className="card p-5 mb-4">
        <div className="flex items-start gap-3 mb-4">
          {diag?.pushSubscribed ? (
            <Bell size={28} className="text-emerald-400 shrink-0" />
          ) : (
            <BellOff size={28} className="text-sand-100/35 shrink-0" />
          )}
          <div>
            <h2 className="font-bold mb-1">{diag?.pushSubscribed ? "Ativadas" : "Não ativadas"}</h2>
            <p className="text-sm text-sand-100/65">
              Permissão: <code>{diag?.notificationPermission ?? "—"}</code> · Plataforma: <code>{diag?.platform ?? "—"}</code>
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!diag?.pushSubscribed ? (
            <Button variant="gold" onClick={ativar}><Bell size={14} /> Ativar notificações</Button>
          ) : (
            <>
              <Button variant="outline" onClick={teste}>Enviar teste</Button>
              <Button variant="danger" onClick={desativar}><BellOff size={14} /> Desativar</Button>
            </>
          )}
          {diag?.installPromptAvailable && (
            <Button variant="outline" onClick={install}><Download size={14} /> Instalar app</Button>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-bold mb-3">Diagnóstico</h2>
        <dl className="grid sm:grid-cols-2 gap-2 text-sm">
          {diag && Object.entries(diag).filter(([k]) => !["ua"].includes(k)).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-1 border-b hairline">
              <dt className="text-sand-100/55">{k}</dt>
              <dd className="font-mono text-xs text-right break-all">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
