// Configurações · porte fiel da tela adm-config do monólito
// 2 tabs: Sistema | Mensagens & WhatsApp
// Seções (Sistema): Regras distribuição · Vídeo boas-vindas · Integração VAI ·
// Distribuição avançada · Vídeo LP · Tracking FB · Tracking GAds · Usuários

import { useEffect, useState } from "react";
import {
  Save, Eye, Plus, Settings as SettingsIcon, MessageSquare, Upload, Loader2,
  Plug, Send as SendIcon, FileText as FileTextIcon, Video as VideoIcon,
  Facebook, Search as SearchIcon, Users as UsersIcon, Check,
  Gem, Trophy, Award, Medal,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/StatusPill";

type Tab = "sistema" | "mensagens";
interface Settings { [k: string]: any; }
interface Rule {
  category: "BRONZE" | "SILVER" | "GOLD" | "DIAMOND";
  dailyQuota: number;
  percentage: number;
  priority: number;
}

const CATS_PT = ["BRONZE", "PRATA", "OURO", "DIAMANTE"] as const;
const CAT_PT_LABEL: Record<string, string> = { BRONZE: "Bronze", PRATA: "Prata", OURO: "Ouro", DIAMANTE: "Diamante" };
const CAT_ICON_MAP = { BRONZE: Medal, PRATA: Award, OURO: Trophy, DIAMANTE: Gem } as const;
const CAT_ICON_COLOR: Record<string, string> = { BRONZE: "text-orange-400", PRATA: "text-zinc-300", OURO: "text-amber-300", DIAMANTE: "text-cyan-300" };
function CatIcon({ cat, size = 12 }: { cat: keyof typeof CAT_ICON_MAP; size?: number }) {
  const Ic = CAT_ICON_MAP[cat] ?? Medal;
  return <Ic size={size} className={CAT_ICON_COLOR[cat] ?? ""} />;
}
const PT_TO_BACKEND: Record<string, "BRONZE"|"SILVER"|"GOLD"|"DIAMOND"> = {
  BRONZE: "BRONZE", PRATA: "SILVER", OURO: "GOLD", DIAMANTE: "DIAMOND",
};

export function Config() {
  const [tab, setTab] = useState<Tab>("sistema");
  const [settings, setSettings] = useState<Settings>({});
  const showToast = useUi((s) => s.showToast);

  async function loadSettings() {
    try {
      const r = await api.get<Settings>("/api/settings");
      setSettings(r ?? {});
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }
  useEffect(() => { void loadSettings(); }, []);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <span className="pill">Sistema</span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-display-tight mt-2">Configurações</h1>
      </div>

      <div className="flex items-center gap-1 mb-6 border-b hairline">
        <TabBtn active={tab === "sistema"} onClick={() => setTab("sistema")}>
          <SettingsIcon size={14} className="inline -mt-0.5 mr-1" /> Sistema
        </TabBtn>
        <TabBtn active={tab === "mensagens"} onClick={() => setTab("mensagens")}>
          <MessageSquare size={14} className="inline -mt-0.5 mr-1" /> Mensagens & WhatsApp
        </TabBtn>
      </div>

      {tab === "sistema" ? (
        <SistemaTab settings={settings} reload={loadSettings} />
      ) : (
        <MensagensTab />
      )}
    </div>
  );
}

function TabBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
        active ? "border-gold-400 text-gold-300" : "border-transparent text-sand-100/60 hover:text-sand-100/85"
      }`}
    >{children}</button>
  );
}
function SubTab({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`px-3 py-2 text-xs font-medium border-b-2 transition ${
        active ? "border-gold-400 text-gold-300" : "border-transparent text-sand-100/60 hover:text-sand-100/85"
      }`}
    >{children}</button>
  );
}

function SistemaTab({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <RegrasSimples reload={reload} />
        <VideoBoasVindas settings={settings} reload={reload} />
      </div>
      <IntegracaoVai />
      <IntegracaoIa />
      <DistribuicaoAvancada reload={reload} />
      <VideoLandingPage settings={settings} reload={reload} />
      <TrackingFb settings={settings} reload={reload} />
      <TrackingGads settings={settings} reload={reload} />
      <AcordoCalebe />
      <UsuariosSistema />
    </div>
  );
}

// Acordo Calebe ↔ Corretor · admin sobe um PDF · corretores leem em /corretor/perfil
function AcordoCalebe() {
  const showToast = useUi((s) => s.showToast);
  const [agreement, setAgreement] = useState<{ url: string; filename: string; size: number; uploadedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const a = await api.get<{ url?: string; filename?: string; size?: number; uploadedAt?: string } | null>("/api/agreement");
      setAgreement(a && a.url && a.filename ? { url: a.url, filename: a.filename, size: a.size ?? 0, uploadedAt: a.uploadedAt ?? "" } : null);
    } catch { /* silent */ } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf") { showToast("Apenas PDF"); e.target.value = ""; return; }
    if (f.size > 20 * 1024 * 1024) { showToast("Arquivo > 20MB"); e.target.value = ""; return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post("/api/agreement/upload", fd);
      showToast("Acordo publicado");
      await reload();
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`); }
    finally { setUploading(false); e.target.value = ""; }
  }

  async function onRemove() {
    if (!confirm("Remover acordo atual? Corretores deixarão de ver o link.")) return;
    try {
      await api.del("/api/agreement");
      showToast("Acordo removido");
      await reload();
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`); }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-3 inline-flex items-center gap-1.5"><FileTextIcon size={12} /> Acordo Calebe ↔ Corretor (PDF)</span>
      <p className="text-xs text-sand-100/65 mb-4">
        Sobe o PDF do acordo de associação. Todos os corretores veem em /corretor/perfil pra baixar/ler.
        Suba uma nova versão pra substituir a anterior (o arquivo antigo fica no disco como histórico).
      </p>
      {loading ? (
        <p className="text-xs text-sand-100/55">Carregando…</p>
      ) : agreement ? (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{agreement.filename}</p>
            <p className="text-[11px] text-sand-100/55">
              {(agreement.size / 1024).toFixed(0)} KB · publicado em {new Date(agreement.uploadedAt).toLocaleString("pt-BR")}
            </p>
          </div>
          <a
            href={agreement.url}
            target="_blank" rel="noopener noreferrer"
            className="btn-base btn-outline text-xs"
            style={{ padding: ".4rem .9rem" }}
          >Abrir PDF</a>
        </div>
      ) : (
        <p className="text-xs text-amber-300/85 mb-3">Nenhum acordo publicado ainda.</p>
      )}
      <div className="flex gap-2 flex-wrap">
        <label className="inline-flex">
          <input type="file" accept="application/pdf" onChange={onUpload} disabled={uploading} className="hidden" />
          <span className="btn-base btn-gold text-xs cursor-pointer" style={{ padding: ".5rem 1rem" }}>
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {agreement ? "Trocar PDF" : "Publicar PDF"}
          </span>
        </label>
        {agreement && (
          <Button variant="outline" onClick={onRemove} style={{ padding: ".5rem 1rem", fontSize: ".8rem" }}>
            Remover
          </Button>
        )}
      </div>
    </section>
  );
}

// 1 · Regras de distribuição (cotas simples)
function RegrasSimples({ reload }: { reload: () => Promise<void> }) {
  const [cotas, setCotas] = useState({ BRONZE: 1, PRATA: 2, OURO: 3, DIAMANTE: 5 });
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ rules?: Rule[] }>("/api/distribution/rules");
        if (r.rules?.length) {
          const co: any = {};
          r.rules.forEach((x) => {
            const k = x.category === "SILVER" ? "PRATA" : x.category === "GOLD" ? "OURO" : x.category === "DIAMOND" ? "DIAMANTE" : "BRONZE";
            co[k] = x.dailyQuota;
          });
          setCotas({ ...cotas, ...co });
        }
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    try {
      await Promise.all(
        (CATS_PT).map((c) => api.patch(`/api/distribution/rules/${PT_TO_BACKEND[c]}`, { dailyQuota: (cotas as any)[c] })),
      );
      showToast("Regras salvas");
      void reload();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-4 inline-block">Regras de distribuição diária</span>
      <div className="space-y-3 mt-3">
        {CATS_PT.map((c) => (
          <div key={c} className="flex items-center justify-between gap-3">
            <span className="text-sm">{CAT_PT_LABEL[c]}</span>
            <input
              type="number" min={0} max={50}
              className="field-input w-24 text-center tabular-nums"
              value={(cotas as any)[c]}
              onChange={(e) => setCotas({ ...cotas, [c]: Number(e.target.value) || 0 })}
            />
          </div>
        ))}
      </div>
      <Button variant="gold" onClick={save} loading={saving} className="w-full mt-4">
        <Save size={14} /> Salvar regras
      </Button>
    </section>
  );
}

// 2 · Vídeo de boas-vindas
function VideoBoasVindas({ settings }: { settings: Settings; reload: () => Promise<void> }) {
  const [src, setSrc] = useState<"youtube" | "mp4">("mp4");
  const [url, setUrl] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    setUrl(settings["welcome.video.url"] ?? settings["lp.video"] ?? "/midias/welcome/welcome-1777553237457-lp-30-04.mp4");
  }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await api.patch("/api/settings/welcome.video.url", { value: url });
      showToast("Vídeo salvo");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-4 inline-block">Vídeo de boas-vindas</span>
      <div className="flex gap-1 border-b hairline mb-3 -mt-2">
        <SubTab active={src === "youtube"} onClick={() => setSrc("youtube")}>YouTube</SubTab>
        <SubTab active={src === "mp4"} onClick={() => setSrc("mp4")}>Arquivo MP4 (upload)</SubTab>
      </div>
      <label className="field-label">URL do vídeo {src === "youtube" ? "(YouTube · Shorts aceita)" : ""}</label>
      <input className="field-input text-sm" value={url} onChange={(e) => setUrl(e.target.value)} />
      <p className="text-xs text-sand-100/55 mt-1">Aparece na landing page pública, antes do login.</p>
      <div className="flex gap-2 mt-3">
        <Button variant="outline" style={{ padding: ".55rem 1rem", flex: 1 }}>
          <Eye size={14} /> Pré-visualizar
        </Button>
        <Button variant="gold" onClick={save} loading={saving} style={{ padding: ".55rem 1rem", flex: 1 }}>
          <Save size={14} /> Salvar
        </Button>
      </div>

      <div className="mt-6 pt-4 border-t hairline">
        <span className="pill mb-3 inline-block">Termo vigente</span>
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-sm">Versão {settings["terms.version"] ?? "1.0.0"}</span>
          <StatusPill tone="success">ATIVO</StatusPill>
        </div>
        <Button variant="outline" className="w-full">
          <Plus size={14} /> Publicar nova versão
        </Button>
      </div>
    </section>
  );
}

// 3 · Integração VAI (WhatsApp)
function IntegracaoVai() {
  const [cfg, setCfg] = useState({ apiBaseUrl: "", channelId: "", flowSecret: "", loginEmail: "", loginPassword: "" });
  const [test, setTest] = useState({ phone: "(47) 99999-9999", name: "Teste Calebe", msg: "Teste de integração VAI · Calebe Imóveis" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [logging, setLogging] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<Record<string, any>>("/api/settings");
        setCfg({
          apiBaseUrl:    r["vai.apiBaseUrl"]    ?? "",
          channelId:     r["vai.channelId"]     ?? "",
          flowSecret:    r["vai.flowSecret"]    ?? "",
          loginEmail:    r["vai.loginEmail"]    ?? "",
          loginPassword: "",
        });
      } catch { /* silent */ }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [
        api.patch("/api/settings/vai.apiBaseUrl", { value: cfg.apiBaseUrl }),
        api.patch("/api/settings/vai.channelId",  { value: cfg.channelId }),
        api.patch("/api/settings/vai.flowSecret", { value: cfg.flowSecret }),
        api.patch("/api/settings/vai.loginEmail", { value: cfg.loginEmail }),
      ];
      if (cfg.loginPassword) promises.push(api.patch("/api/settings/vai.loginPassword", { value: cfg.loginPassword }));
      await Promise.all(promises);
      showToast("Credenciais VAI salvas");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }
  async function testLogin() {
    setLogging(true);
    try {
      const r = await api.get<{ ok?: boolean }>("/api/vai/health");
      showToast(r.ok ? "Conexão OK" : "Falha na conexão");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setLogging(false); }
  }
  async function testMessage() {
    setTesting(true);
    try {
      await api.post("/api/vai/test-message", { phone: test.phone, name: test.name, text: test.msg });
      showToast("Mensagem de teste enviada");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setTesting(false); }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-4 inline-block">Integração VAI (WhatsApp)</span>
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="API Base URL" value={cfg.apiBaseUrl} onChange={(e) => setCfg({ ...cfg, apiBaseUrl: e.target.value })} placeholder="https://api.vaicrm.com.br" />
        <Field label="Channel ID (Calebe)" value={cfg.channelId} onChange={(e) => setCfg({ ...cfg, channelId: e.target.value })} placeholder="uuid do canal" />
        <Field label="Token (X-Flow-Secret / Webhook)" value={cfg.flowSecret} onChange={(e) => setCfg({ ...cfg, flowSecret: e.target.value })} />
      </div>
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <Field label="Usuário (e-mail de login)" type="email" value={cfg.loginEmail} onChange={(e) => setCfg({ ...cfg, loginEmail: e.target.value })} />
        <Field label="Senha" type="password" value={cfg.loginPassword} onChange={(e) => setCfg({ ...cfg, loginPassword: e.target.value })} placeholder="*********  (salvo · digite pra substituir)" />
      </div>
      <p className="text-xs text-sand-100/55 mt-2">
        Credenciais ficam armazenadas no banco. O backend usa primeiro o valor do banco; se vazio, cai no <code className="text-gold-300">backend/.env</code>. Alterações aplicam automaticamente (hot-reload do token e canal).
      </p>

      <div className="mt-6 pt-4 border-t hairline">
        <h3 className="font-semibold mb-2">Envio de mensagem de teste</h3>
        <p className="text-xs text-sand-100/65 mb-3">Valida o envio real usando o mesmo fluxo do chat: reusa a conversa ativa do lead e envia a mensagem via VAI.</p>
        <div className="bg-blue-500/5 border border-blue-500/25 rounded p-3 mb-3 text-xs text-blue-100/85">
          ⓘ <strong>Pré-requisito:</strong> o número precisa já ter mandado pelo menos 1 mensagem pro WhatsApp do canal (pra aparecer como Lead no CRM). A integração VAI é via WhatsApp Web (não Meta oficial) — ela só entrega em chats que o cliente iniciou. Se o número nunca escreveu, o teste retorna erro com a instrução.
        </div>
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          <Field label="WhatsApp destino *" value={test.phone} onChange={(e) => setTest({ ...test, phone: e.target.value })} />
          <Field label="Nome do contato" value={test.name} onChange={(e) => setTest({ ...test, name: e.target.value })} />
          <div>
            <label className="field-label">Status do último envio</label>
            <p className="field-input opacity-60 text-sm">• Nenhum teste ainda</p>
          </div>
        </div>
        <label className="field-label">Mensagem</label>
        <textarea className="field-input text-sm" rows={3} value={test.msg} onChange={(e) => setTest({ ...test, msg: e.target.value })} />
        <div className="flex gap-2 mt-3 flex-wrap">
          <Button variant="outline" onClick={testLogin} loading={logging}><Plug size={13} /> Testar conexão (login)</Button>
          <Button variant="outline" onClick={testMessage} loading={testing}><SendIcon size={13} /> Enviar mensagem de teste</Button>
          <Button variant="gold" onClick={save} loading={saving}><Save size={14} /> Salvar</Button>
        </div>
      </div>
    </section>
  );
}

// 3b · Integrações & IA (Assistente IA contextual · ADMIN-only)
//      Salva ia.provider / ia.apiKey / ia.model em SystemSetting.
//      A chave nunca é devolvida pelo GET /api/settings (apiKey deveria ser segredo).
//      Para evitar leak, masco se já houver valor salvo: campo começa vazio com placeholder "(salvo)".
function IntegracaoIa() {
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [hasKeySaved, setHasKeySaved] = useState(false);
  const [status, setStatus] = useState<{ configurado: boolean; provider?: string; model?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function loadStatus() {
    try {
      const s = await api.get<{ configurado: boolean; provider?: string; model?: string }>("/api/ia/status");
      setStatus(s);
      if (s.provider) setProvider(s.provider as "anthropic" | "openai");
      if (s.model) setModel(s.model);
      setHasKeySaved(!!s.configurado);
    } catch { /* silent */ }
  }
  useEffect(() => { void loadStatus(); }, []);

  async function save() {
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [
        api.patch("/api/settings/ia.provider", { value: provider }),
        api.patch("/api/settings/ia.model",    { value: model || "" }),
      ];
      // Só envia apiKey se o usuário digitou algo · evita sobrescrever com vazio.
      if (apiKey.trim()) promises.push(api.patch("/api/settings/ia.apiKey", { value: apiKey.trim() }));
      await Promise.all(promises);
      setApiKey("");
      showToast("Configuração da IA salva");
      void loadStatus();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  const placeholderModel = provider === "anthropic" ? "claude-haiku-4-5-20251001" : "gpt-4o-mini";

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="pill inline-block">Integrações & IA (Assistente)</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${status?.configurado ? "bg-green-500/15 text-green-300" : "bg-amber-500/15 text-amber-300"}`}>
          {status?.configurado ? "IA ativa" : "Modo demo"}
        </span>
      </div>

      <p className="text-xs text-sand-100/65 mb-3">
        Quando configurada, a IA responde perguntas livres no FAB do canto inferior direito (visível apenas para administradores). Sem chave, o assistente responde em modo demo a partir do contexto real (leads, imóveis, vendas).
      </p>

      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className="field-label">Provider</label>
          <select
            className="field-input text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
          </select>
        </div>
        <Field
          label="Modelo (opcional)"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={placeholderModel}
        />
        <Field
          label="API key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKeySaved ? "*********  (salva · digite pra substituir)" : "sk-ant-... ou sk-..."}
        />
      </div>

      <p className="text-xs text-sand-100/55 mt-3">
        Default para Anthropic: <code className="text-gold-300">claude-haiku-4-5-20251001</code>. Para OpenAI: <code className="text-gold-300">gpt-4o-mini</code>.
        A chave fica armazenada na tabela <code className="text-gold-300">SystemSetting</code> (key <code className="text-gold-300">ia.apiKey</code>) e nunca é devolvida pelo backend.
      </p>

      <div className="flex gap-2 mt-4 flex-wrap">
        <Button variant="gold" onClick={save} loading={saving}>
          <Save size={14} /> Salvar configuração da IA
        </Button>
      </div>
    </section>
  );
}

// 4 · Distribuição avançada
function DistribuicaoAvancada({ reload }: { reload: () => Promise<void> }) {
  const [cotas, setCotas] = useState({ BRONZE: 1, PRATA: 2, OURO: 3, DIAMANTE: 5 });
  const [pct, setPct] = useState({ DIAMANTE: 40, OURO: 30, PRATA: 20, BRONZE: 10 });
  const [capData, setCapData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    (async () => {
      try {
        const [rules, queue] = await Promise.all([
          api.get<{ rules?: Rule[] }>("/api/distribution/rules"),
          api.get<any>("/api/distribution/queue"),
        ]);
        if (rules.rules?.length) {
          const co: any = {}; const pe: any = {};
          rules.rules.forEach((x) => {
            const k = x.category === "SILVER" ? "PRATA" : x.category === "GOLD" ? "OURO" : x.category === "DIAMOND" ? "DIAMANTE" : "BRONZE";
            co[k] = x.dailyQuota;
            pe[k] = x.percentage;
          });
          setCotas((c) => ({ ...c, ...co }));
          setPct((p) => ({ ...p, ...pe }));
        }
        setCapData(queue);
      } catch { /* silent */ }
    })();
  }, []);

  const total = pct.DIAMANTE + pct.OURO + pct.PRATA + pct.BRONZE;

  async function saveAll() {
    if (total !== 100) { showToast(`Soma deve ser 100% · atual ${total}%`); return; }
    setSaving(true);
    try {
      await Promise.all(
        CATS_PT.map((c) => api.patch(`/api/distribution/rules/${PT_TO_BACKEND[c]}`, { dailyQuota: (cotas as any)[c] })),
      );
      await api.patch("/api/distribution/percentages", {
        DIAMOND: pct.DIAMANTE, GOLD: pct.OURO, SILVER: pct.PRATA, BRONZE: pct.BRONZE,
      });
      showToast("Regras avançadas salvas");
      void reload();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  async function verifInat() {
    try { await api.post("/api/distribution/rebalance"); showToast("Inatividade verificada"); }
    catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }
  async function processarFila() {
    try { await api.post("/api/distribution/run"); showToast("Fila processada"); }
    catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-4 inline-block">Distribuição de leads · regras avançadas</span>
      <p className="text-xs text-sand-100/65 mb-4">
        Configure cotas diárias por categoria e o mix percentual do total de leads do dia.
        A fila auto-agenda o excesso para os próximos dias.
      </p>

      <h3 className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-3">
        1 · Cotas diárias (máx por corretor/dia)
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {CATS_PT.map((c) => (
          <div key={c}>
            <label className="text-[0.7rem] uppercase tracking-mono-wide font-medium text-sand-100/70 mb-1.5 inline-flex items-center gap-1.5">
              <CatIcon cat={c} /> {CAT_PT_LABEL[c]}
            </label>
            <input
              type="number" min={0} max={50}
              className="field-input text-center tabular-nums"
              value={(cotas as any)[c]}
              onChange={(e) => setCotas({ ...cotas, [c]: Number(e.target.value) || 0 })}
            />
          </div>
        ))}
      </div>

      <h3 className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-2">
        2 · Mix percentual (do total diário)
      </h3>
      <p className="text-xs text-sand-100/55 mb-3">
        Define que % dos leads do dia vai para cada categoria. Soma deve fechar
        {" "}<strong className={total === 100 ? "text-emerald-300" : "text-red-300"}>100%</strong>
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
        {(["DIAMANTE", "OURO", "PRATA", "BRONZE"] as const).map((c) => (
          <div key={c}>
            <label className="text-[0.7rem] uppercase tracking-mono-wide font-medium text-sand-100/70 mb-1.5 block">% {CAT_PT_LABEL[c]}</label>
            <div className="relative">
              <input
                type="number" min={0} max={100}
                className="field-input tabular-nums pr-8"
                value={pct[c]}
                onChange={(e) => setPct({ ...pct, [c]: Number(e.target.value) || 0 })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sand-100/55">%</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[0.7rem] text-sand-100/55">
        Total: <strong className={total === 100 ? "text-emerald-300" : "text-red-300"}>{total}%</strong>
      </p>

      {capData && (
        <div className="mt-5 bg-app-subtle/40 rounded p-4">
          <h3 className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55 mb-3">
            Capacidade projetada hoje
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["DIAMANTE", "OURO", "PRATA", "BRONZE"] as const).map((c) => {
              const cap = capData?.capacity?.porCat?.[c] ?? 0;
              return (
                <div key={c}>
                  <p className="text-[0.65rem] uppercase tracking-mono-wide text-sand-100/55 inline-flex items-center gap-1.5"><CatIcon cat={c} /> {CAT_PT_LABEL[c]}</p>
                  <p className="text-sm font-semibold tabular-nums">{cap} leads/dia</p>
                  <p className="text-[0.65rem] text-sand-100/55">cap. {cap}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 pt-3 border-t hairline text-[0.7rem] text-sand-100/65">
            <strong>TOTAL DIA · {capData?.capacity?.total ?? 0} leads.com</strong>
            {" · "}{capData?.capacity?.ativos ?? 0} corretores ativos
            {" · "}fila aguardando: <strong>{capData?.queue?.total ?? 0}</strong>
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-sand-100/55">Configuração ativa</span>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={verifInat} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>Verificar inatividade</Button>
          <Button variant="outline" onClick={processarFila} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>Processar fila</Button>
          <Button variant="gold" onClick={saveAll} loading={saving} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>
            <Save size={13} /> Salvar regras
          </Button>
        </div>
      </div>
    </section>
  );
}

// 5 · Vídeo Landing Page
function VideoLandingPage({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) {
  const [src, setSrc] = useState<"youtube" | "mp4">("mp4");
  const [filename, setFilename] = useState<string>("");
  const [handle, setHandle] = useState<string>("");
  const [legenda, setLegenda] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    setFilename(settings["lp.video"] ?? "hero-lp.mp4");
    setHandle(settings["lp.ig.handle"] ?? "calebe_imoveis");
    setLegenda(settings["lp.ig.legenda"] ?? "Corretor associado Calebe · rede nacional");
  }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        api.patch("/api/settings/lp.video",      { value: filename }),
        api.patch("/api/settings/lp.ig.handle",  { value: handle }),
        api.patch("/api/settings/lp.ig.legenda", { value: legenda }),
      ]);
      showToast("Configurações da LP salvas");
      void reload();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append("video", f);
      const r = await api.post<{ filename?: string; path?: string }>("/api/welcome-video/upload", fd);
      setFilename(r.filename ?? r.path ?? f.name);
      showToast("Vídeo enviado");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { e.target.value = ""; }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-3 inline-flex items-center gap-1.5"><VideoIcon size={12} /> Vídeo da landing page · Celular Instagram</span>
      <p className="text-xs text-sand-100/65 mb-4">Troque o vídeo exibido no mockup de celular do hero da LP.</p>

      <div className="flex gap-1 border-b hairline mb-4">
        <SubTab active={src === "youtube"} onClick={() => setSrc("youtube")}>YouTube</SubTab>
        <SubTab active={src === "mp4"}     onClick={() => setSrc("mp4")}>Arquivo MP4 (upload)</SubTab>
      </div>

      <label className="field-label">Arquivo de vídeo (.mp4 / .webm) *</label>
      <label className="block bg-app-subtle/60 border hairline rounded p-3 cursor-pointer hover:border-gold-400/40">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400">
            <Upload size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{filename}</p>
            <p className="text-xs text-sand-100/55">Recomendado: MP4 vertical (9:16), até 20MB, 10 a 30 segundos</p>
          </div>
        </div>
        <input type="file" accept="video/mp4,video/webm" className="hidden" onChange={onUpload} />
      </label>
      <p className="text-[0.7rem] text-sand-100/55 mt-2">ⓘ MP4 local: reproduz com autoplay sem restrições. Melhor opção para controle total da LP.</p>

      <div className="grid md:grid-cols-2 gap-3 mt-4">
        <Field label="Handle / usuário exibido" value={handle} onChange={(e) => setHandle(e.target.value)} />
        <div>
          <label className="field-label">Status</label>
          <p className="field-input text-sm opacity-90">• Vídeo ativo</p>
        </div>
      </div>
      <div className="mt-3">
        <label className="field-label">Legenda (aparece embaixo no mockup)</label>
        <input className="field-input text-sm" value={legenda} onChange={(e) => setLegenda(e.target.value)} />
      </div>
      <div className="flex gap-2 mt-4 justify-end">
        <Button variant="outline" style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>
          <Eye size={13} /> Pré-visualizar
        </Button>
        <Button variant="gold" onClick={save} loading={saving} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>
          <Save size={13} /> Salvar e aplicar
        </Button>
      </div>
    </section>
  );
}

// 6 · Tracking Facebook
function TrackingFb({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) {
  const [pixelId, setPixelId] = useState("");
  const [capi, setCapi] = useState("");
  const [applyLp, setApplyLp] = useState(true);
  const [applyApp, setApplyApp] = useState(false);
  const [events, setEvents] = useState({ PageView: true, "Lead (cadastro)": true, ViewContent: true, InitiateCheckout: false });
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    setPixelId(settings["tracking.fb"] ?? "");
    setCapi(settings["tracking.fb.capi"] ?? "");
  }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        api.patch("/api/settings/tracking.fb",      { value: pixelId }),
        api.patch("/api/settings/tracking.fb.capi", { value: capi }),
      ]);
      showToast("Facebook Pixel salvo");
      void reload();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-3 inline-flex items-center gap-1.5"><Facebook size={12} /> Tracking · Facebook Ads (Meta Pixel + Conversions API)</span>
      <p className="text-xs text-sand-100/65 mb-4">Configure o Pixel e o token da Conversions API para disparar eventos na Landing Page pública e/ou no sistema interno.</p>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Pixel ID *" value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="ex: 123456789012345" />
        <Field label="Conversions API · Token" value={capi} onChange={(e) => setCapi(e.target.value)} placeholder="EAAx... (deixe vazio p/ só Pixel)" />
      </div>
      <div className="mt-3">
        <label className="text-[0.7rem] uppercase tracking-mono-wide font-medium text-sand-100/55 mb-1.5 block">Onde aplicar</label>
        <label className="inline-flex items-center gap-2 text-sm mr-4"><input type="checkbox" checked={applyLp} onChange={(e) => setApplyLp(e.target.checked)} /> Landing Page pública</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={applyApp} onChange={(e) => setApplyApp(e.target.checked)} /> Sistema interno (corretor/admin)</label>
      </div>
      <div className="mt-3">
        <label className="text-[0.7rem] uppercase tracking-mono-wide font-medium text-sand-100/55 mb-1.5 block">Eventos rastreados</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {(Object.keys(events) as Array<keyof typeof events>).map((k) => (
            <label key={k} className="inline-flex items-center gap-2">
              <input type="checkbox" checked={events[k]} onChange={(e) => setEvents({ ...events, [k]: e.target.checked })} /> {k}
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-4 items-center justify-between">
        <p className="text-[0.7rem] text-sand-100/55">{pixelId ? "Configurado" : "• Não configurado"}</p>
        <div className="flex gap-2">
          <Button variant="outline" style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}><Plug size={13} /> Disparar teste</Button>
          <Button variant="gold" onClick={save} loading={saving} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>
            <Save size={13} /> Salvar
          </Button>
        </div>
      </div>
    </section>
  );
}

// 7 · Tracking Google Ads
function TrackingGads({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) {
  const [gtag, setGtag] = useState("");
  const [label, setLabel] = useState("");
  const [applyLp, setApplyLp] = useState(true);
  const [applyApp, setApplyApp] = useState(false);
  const [events, setEvents] = useState({ page_view: true, generate_lead: true, sign_up: true });
  const [saving, setSaving] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    setGtag(settings["tracking.gads"] ?? "");
    setLabel(settings["tracking.gads.label"] ?? "");
  }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        api.patch("/api/settings/tracking.gads",       { value: gtag }),
        api.patch("/api/settings/tracking.gads.label", { value: label }),
      ]);
      showToast("Google Ads salvo");
      void reload();
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  return (
    <section className="card p-5">
      <span className="pill mb-3 inline-flex items-center gap-1.5"><SearchIcon size={12} /> Tracking · Google Ads (gtag + Conversion)</span>
      <p className="text-xs text-sand-100/65 mb-4">Configure a tag gtag.js e o label da conversão de Lead. Aplica à Landing Page pública e/ou ao sistema interno.</p>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="ID da TAG (gtag) *" value={gtag} onChange={(e) => setGtag(e.target.value)} placeholder="AW-XXXXXXXXXX ou G-XXXXXXXXX" />
        <Field label="Conversion Label (Lead)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: AbCd-EfGh12345" />
      </div>
      <div className="mt-3">
        <label className="text-[0.7rem] uppercase tracking-mono-wide font-medium text-sand-100/55 mb-1.5 block">Onde aplicar</label>
        <label className="inline-flex items-center gap-2 text-sm mr-4"><input type="checkbox" checked={applyLp} onChange={(e) => setApplyLp(e.target.checked)} /> Landing Page pública</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={applyApp} onChange={(e) => setApplyApp(e.target.checked)} /> Sistema interno (corretor/admin)</label>
      </div>
      <div className="mt-3">
        <label className="text-[0.7rem] uppercase tracking-mono-wide font-medium text-sand-100/55 mb-1.5 block">Eventos rastreados</label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          {(Object.keys(events) as Array<keyof typeof events>).map((k) => (
            <label key={k} className="inline-flex items-center gap-2">
              <input type="checkbox" checked={events[k]} onChange={(e) => setEvents({ ...events, [k]: e.target.checked })} /> {k}
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-4 items-center justify-between">
        <p className="text-[0.7rem] text-sand-100/55">{gtag ? "Configurado" : "• Não configurado"}</p>
        <div className="flex gap-2">
          <Button variant="outline" style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}><Plug size={13} /> Disparar teste</Button>
          <Button variant="gold" onClick={save} loading={saving} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>
            <Save size={13} /> Salvar
          </Button>
        </div>
      </div>
    </section>
  );
}

// 8 · Usuários do sistema
interface SystemUser { id: string; name: string; email: string; role: string; status?: string; lastLoginAt?: string }
function UsuariosSistema() {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ data: SystemUser[] }>("/api/users?limit=200");
        setUsers(r.data ?? []);
      } catch { /* endpoint pode não existir · não quebra a tela */ }
    })();
  }, []);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <span className="pill inline-flex items-center gap-1.5"><UsersIcon size={12} /> Usuários do sistema</span>
        <Button variant="gold" onClick={() => showToast("Modal criar usuário em construção")} style={{ padding: ".5rem .9rem", fontSize: ".8rem" }}>
          <Plus size={13} /> Criar novo usuário
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Nome</th>
              <th className="text-left p-3">E-mail</th>
              <th className="text-left p-3">Perfil</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Último acesso</th>
              <th className="text-right p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-sand-100/55 italic">Nenhum usuário admin cadastrado.</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t hairline">
                <td className="p-3 font-semibold">{u.name}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3"><StatusPill tone="info">{u.role}</StatusPill></td>
                <td className="p-3">{u.status ? <StatusPill tone={u.status === "ATIVO" ? "success" : "neutral"}>{u.status}</StatusPill> : "—"}</td>
                <td className="p-3 text-xs text-sand-100/55">{u.lastLoginAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                <td className="p-3 text-right">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Tab Mensagens · placeholder estrutural
function MensagensTab() {
  return (
    <div className="card p-8 text-center text-sand-100/55">
      <MessageSquare size={36} className="mx-auto mb-3 text-sand-100/35" />
      <p className="text-sm">Templates de WhatsApp, mensagens automáticas e fluxos de aprovação.</p>
      <p className="text-xs mt-2 italic">Em construção · seção `vai.aprovacaoTemplate` do monólito.</p>
    </div>
  );
}
