// Dashboard corretor v2 — "recepção premium" (redesign squad-design).
// MANTÉM 100% das funcionalidades, dados, links, navegação e paleta do Dashboard atual.
// Muda só layout/hierarquia: HERO com imagem premium + Chat Lead em destaque + KPIs
// "sistema vivo" no topo + Estrutura elegante + suporte consolidado (acaba os blocos repetidos).
// Constraint do build: usa classes Tailwind JÁ existentes + estilos inline (build sem JIT).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck, LifeBuoy, MessageSquareHeart, MessageCircle, ArrowRight,
  MessagesSquare, Plane, Building2 as BuildingIcon, Car, Home as HomeIcon,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useConversations } from "@/store/conversations";
import { useTheme } from "@/store/theme";

const WA_AJUDA   = "https://wa.me/5547992069573?text=Ol%C3%A1%2C%20sou%20Corretor%20Associado%20Calebe%20e%20preciso%20de%20ajuda.";
const WA_SUPORTE = "https://wa.me/5547992117994?text=Ol%C3%A1%2C%20sou%20Corretor%20Associado%20Calebe%20e%20preciso%20de%20ajuda%20com%20a%20plataforma.";
const WA_CORRETOR_CALEBE = "https://wa.me/5547992678100";
// fachada real da Calebe (letreiro dourado), escurecida no overlay
const HERO_BG = "/img/dash-hero.jpg";

interface AssociateStats {
  associate?: { id: string; category?: string; segment?: string; status?: string };
  leadsTotal?: number; leadsDistributedToday?: number; leadsActive?: number; unreadNotifications?: number;
  leadsAtRisk?: number; leadsAtRiskMinHoursLeft?: number | null;
  leadsAtRiskList?: { id: string; name: string; hoursLeft: number }[];
}

export function CorretorDashboardV2() {
  const user = useAuth((s) => s.user);
  const conversations = useConversations((s) => s.list);
  const fetchList = useConversations((s) => s.fetchList);
  const nav = useNavigate();
  const [stats, setStats] = useState<AssociateStats>({});

  useEffect(() => { void fetchList(); }, [fetchList]);
  useEffect(() => { (async () => { try { const r = await api.get<AssociateStats>("/api/dashboards/associate").catch(() => ({} as AssociateStats)); setStats(r ?? {}); } catch { /* */ } })(); }, []);

  const ativas = conversations.filter((c) => { const s = c.status; return s !== "perdido" && s !== "fechado" && s !== "descartado"; }).length;
  const novosLeads = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return conversations
      .filter((c) => { const at = c.lastMessageAt ?? c.createdAt; return at ? new Date(at).getTime() >= cutoff : false; })
      .sort((a, b) => new Date(b.lastMessageAt ?? b.createdAt ?? 0).getTime() - new Date(a.lastMessageAt ?? a.createdAt ?? 0).getTime());
  }, [conversations]);

  const associate = user?.associate as any;
  const primeiroNome = user?.name?.split(" ")[0] ?? "—";
  const segmento = associate?.segment ?? associate?.category;
  const { theme } = useTheme();
  const isLight = theme === "light";
  const chatCount = ativas;

  const kpis = [
    { label: "Leads hoje", value: stats.leadsDistributedToday ?? 0, hint: "distribuídos pra você", to: "/corretor/chat" },
    { label: "Em conversa", value: ativas, hint: "ativas agora", to: "/corretor/chat" },
    { label: "Leads ativos", value: stats.leadsActive ?? 0, hint: "qualificação/negociação", to: "/corretor/chat" },
    { label: "Notificações", value: stats.unreadNotifications ?? 0, hint: "não lidas", to: "/corretor/notificacoes" },
  ];

  return (
    <div>
      {/* ===================== HERO ===================== */}
      <section style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid rgba(222,185,109,.18)" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${HERO_BG})`, backgroundSize: "cover", backgroundPosition: "center 32%" }} />
        <div style={{ position: "absolute", inset: 0, background: isLight ? "linear-gradient(100deg, rgba(248,242,230,.96) 0%, rgba(248,242,230,.90) 38%, rgba(248,242,230,.75) 100%)" : "linear-gradient(100deg, rgba(4,16,31,.96) 0%, rgba(4,16,31,.88) 38%, rgba(4,16,31,.64) 100%)" }} />
        <div style={{ position: "absolute", top: -90, right: -50, width: 340, height: 340, borderRadius: "50%", background: "rgba(222,185,109,.13)", filter: "blur(90px)" }} />

        <div className="p-5 md:p-8 lg:p-10" style={{ position: "relative" }}>
          {/* suporte discreto · topo direito (desktop) */}
          <div className="hidden md:flex items-center gap-2" style={{ position: "absolute", top: 22, right: 30 }}>
            <a href={WA_SUPORTE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ background: "rgba(220,38,38,.16)", color: isLight ? "#DC2626" : "#FCA5A5", border: isLight ? "1px solid rgba(220,38,38,.5)" : "1px solid rgba(220,38,38,.4)", fontWeight: 700, textDecoration: "none" }} title="Erros do sistema"><LifeBuoy size={13} /> Suporte técnico</a>
            <a href={WA_AJUDA} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ background: "rgba(222,185,109,.16)", color: isLight ? "#8B6914" : "#DEB96D", border: isLight ? "1px solid rgba(201,169,97,.55)" : "1px solid rgba(222,185,109,.4)", fontWeight: 700, textDecoration: "none" }} title="PROPOSTA FIRME FALA COM CALEBE"><MessageSquareHeart size={13} /> PROPOSTA FIRME FALA COM CALEBE</a>
          </div>

          <p className="meta-gold">Programa Calebe</p>
          <h1 className="font-bold tracking-display-tight" style={{ fontSize: "clamp(1.9rem, 4vw, 2.9rem)", lineHeight: 1.04, marginTop: 8, color: isLight ? "#04101F" : "#F5EFE4" }}>
            Olá, <span className="text-gold-400">{primeiroNome}</span>.
          </h1>
          <p className="text-sand-100/75 mt-3" style={{ maxWidth: 540, fontSize: 14.5, lineHeight: 1.55 }}>
            Bem-vindo à sua operação Calebe. Tudo o que você precisa pra atender, fechar e crescer — em um só lugar.
          </p>

          <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 16 }}>
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-gold-400/10 text-gold-300 border border-gold-400/30 font-semibold"><BadgeCheck size={13} /> {user?.name}</span>
            {segmento && <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-app-subtle/60 text-sand-100/75 border hairline font-semibold">{segmento}</span>}
          </div>

          {/* CTA principal (Chat Lead) + secundário (Imóveis) */}
          <div className="flex flex-wrap items-stretch gap-3" style={{ marginTop: 22 }}>
            <button onClick={() => nav("/corretor/chat")} className="group flex items-center gap-4 text-left"
              style={{ background: "linear-gradient(135deg,#DEB96D,#C9A961)", color: "#04101F", borderRadius: 12, padding: "15px 18px", boxShadow: "0 10px 34px rgba(201,169,97,.35)", border: "none", cursor: "pointer", flex: "1 1 380px", maxWidth: 540 }}>
              <div style={{ height: 50, width: 50, borderRadius: 10, background: "rgba(4,16,31,.14)", display: "grid", placeItems: "center", flex: "none" }}><MessagesSquare size={26} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 800, opacity: .7 }}>Seu canal principal</p>
                <p style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.15 }}>Chat Lead · {chatCount} conversa{chatCount === 1 ? "" : "s"}</p>
                <p style={{ fontSize: 12.5, opacity: .82, marginTop: 1 }}>Abra, atenda e responda todos os seus leads.</p>
              </div>
              <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" style={{ flex: "none" }} />
            </button>
            <button onClick={() => nav("/corretor/imoveis")} className="group flex items-center gap-3"
              style={{ background: isLight ? "rgba(255,255,255,.82)" : "rgba(10,34,54,.55)", backdropFilter: "blur(6px)", color: isLight ? "#04101F" : "#F5EFE4", borderRadius: 12, padding: "15px 20px", border: "1px solid rgba(222,185,109,.3)", cursor: "pointer", flex: "0 1 auto" }}>
              <HomeIcon size={20} className="text-gold-300" />
              <div style={{ textAlign: "left" }}>
                <p style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>Imóveis</p>
                <p style={{ fontSize: 11.5, opacity: .65 }}>Catálogo + gerar LP</p>
              </div>
            </button>
          </div>

          {/* KPIs · tira "sistema vivo" */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ marginTop: 22, maxWidth: 740 }}>
            {kpis.map((k) => (
              <button key={k.label} onClick={() => nav(k.to)}
                style={{ background: isLight ? "rgba(255,255,255,.82)" : "rgba(10,34,54,.62)", backdropFilter: "blur(6px)", border: "1px solid rgba(222,185,109,.22)", borderRadius: 11, padding: "12px 14px", textAlign: "left", cursor: "pointer" }}>
                <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, color: isLight ? "rgba(4,16,31,.55)" : "rgba(245,239,228,.55)" }}>{k.label}</p>
                <p className="font-display font-light" style={{ fontSize: 27, lineHeight: 1.1, marginTop: 3, color: isLight ? "#04101F" : "#F5EFE4" }}>{k.value}</p>
                <p style={{ fontSize: 10.5, color: isLight ? "rgba(4,16,31,.45)" : "rgba(245,239,228,.48)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.hint}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== ALERTA LEADS EM RISCO ===================== */}
      {/* Aparece quando corretor tem leads que serão redistribuídos em breve */}
      {(stats.leadsAtRisk ?? 0) > 0 && (
        <div
          role="alert"
          style={{
            background: "linear-gradient(135deg, rgba(239,68,68,.18) 0%, rgba(220,38,38,.12) 100%)",
            borderTop: "1px solid rgba(239,68,68,.35)",
            borderBottom: "1px solid rgba(239,68,68,.35)",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ color: "#f87171", flexShrink: 0, animation: "pulse 2s infinite" }}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: "#fca5a5", lineHeight: 1.2 }}>
                ⚠️ {stats.leadsAtRisk} lead{(stats.leadsAtRisk ?? 0) > 1 ? "s serão redistribuídos" : " será redistribuído"}{" "}
                {stats.leadsAtRiskMinHoursLeft !== null && stats.leadsAtRiskMinHoursLeft !== undefined
                  ? `em menos de ${stats.leadsAtRiskMinHoursLeft + 1}h`
                  : "em breve"}
              </p>
              <p style={{ fontSize: 11.5, color: "rgba(252,165,165,.7)", marginTop: 2 }}>
                {stats.leadsAtRiskList && stats.leadsAtRiskList.length > 0
                  ? stats.leadsAtRiskList.map(l => l.name.split(" ")[0]).join(", ") + (stats.leadsAtRisk! > stats.leadsAtRiskList.length ? ` e mais ${stats.leadsAtRisk! - stats.leadsAtRiskList.length}…` : "")
                  : "Responda agora no Chat Lead para manter esses leads."}
                {" "}— Responda agora para não perder!
              </p>
            </div>
          </div>
          <button
            onClick={() => nav("/corretor/chat")}
            style={{
              background: "rgba(239,68,68,.85)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0
            }}
          >
            Ir para Chat Lead <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* ===================== CORPO ===================== */}
      <div className="p-4 md:p-6 lg:p-8">
        {/* Estrutura exclusiva Calebe */}
        <section className="mb-10">
          <div className="flex items-end justify-between mb-5">
            <div>
              <p className="meta-gold">Diferencial Calebe</p>
              <h2 className="text-lg md:text-xl font-bold tracking-[-0.02em] mt-1">Estrutura <span className="text-gold-400">exclusiva</span> pra fechar mais</h2>
            </div>
            <button className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1.5 shrink-0" onClick={() => nav("/corretor/estrutura")}>Ver histórico <ArrowRight size={13} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
            {[
              { tipo: "aviao", icon: Plane, title: "Reservar Avião", desc: "Traslado aéreo para visitas estratégicas" },
              { tipo: "apartamento", icon: BuildingIcon, title: "Reservar Apartamento", desc: "Apoio e hospedagem durante atendimentos" },
              { tipo: "veiculo", icon: Car, title: "Reservar Veículo", desc: "Motorista ou carro para receber o cliente" },
            ].map(({ tipo, icon: Icon, title, desc }) => (
              <button key={tipo} onClick={() => nav(`/corretor/estrutura?tipo=${tipo}`)} className="group relative overflow-hidden card p-6 md:p-7 text-left hover:border-gold-400/50 transition-all">
                <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gold-400/10 blur-3xl group-hover:bg-gold-400/20 transition-colors" />
                <div className="relative z-10">
                  <div className="h-14 w-14 rounded border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400 mb-5 group-hover:border-gold-400/60 transition-colors"><Icon size={28} /></div>
                  <h3 className="text-lg md:text-xl font-extrabold tracking-[-0.02em]">{title}</h3>
                  <p className="text-sm text-sand-100/60 mt-2 mb-5 leading-relaxed">{desc}</p>
                  <span className="inline-flex items-center gap-1.5 text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-300">Solicitar <ArrowRight size={13} /></span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Conversas recentes + Suporte consolidado */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          <div className="lg:col-span-2 card p-5 md:p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="pill">Conversas recentes · 24h</span>
              <button onClick={() => nav("/corretor/chat")} className="text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-300 inline-flex items-center gap-1">Ver tudo <ArrowRight size={12} /></button>
            </div>
            {novosLeads.length === 0 ? (
              <p className="text-sm text-sand-100/55 italic mt-3">Nenhuma conversa nas últimas 24h. Abra o Chat Lead pra começar.</p>
            ) : (
              <ul className="divide-y hairline mt-1">
                {novosLeads.slice(0, 7).map((c) => (
                  <li key={c.id} className="py-2.5 flex items-center justify-between gap-2 cursor-pointer hover:opacity-80" onClick={() => nav("/corretor/chat")}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-full flex items-center justify-center text-gold-300 shrink-0" style={{ height: 36, width: 36, background: isLight ? "rgba(222,185,109,.15)" : "linear-gradient(135deg,#123a52,#0c2438)", border: isLight ? "1px solid rgba(222,185,109,.45)" : "1px solid #1c3a52", fontSize: 13, fontWeight: 700 }}>{(c.lead?.name ?? "?").slice(0, 1).toUpperCase()}</div>
                      <div className="min-w-0"><p className="text-sm font-semibold truncate">{c.lead?.name ?? "—"}</p><p className="text-[0.7rem] text-sand-100/55 truncate">{c.lead?.origin ?? "—"}</p></div>
                    </div>
                    <span className="text-[0.65rem] text-sand-100/45 shrink-0">{c.lastMessageAt?.slice(11, 16) ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5 md:p-6">
            <span className="pill mb-3 inline-block">Suporte & atendimento</span>
            <div className="flex flex-col gap-2.5 mt-1">
              <SupportRow featured href={WA_CORRETOR_CALEBE} color="#86EFAC" bg="rgba(37,211,102,.16)" icon={MessageCircle} title="SUPORTE CORRETOR CALEBE" sub="(47) 99267-8100 · fale agora no WhatsApp" />
              <SupportRow href={WA_AJUDA} color="#DEB96D" bg="rgba(222,185,109,.12)" icon={MessageSquareHeart} title="PROPOSTA FIRME FALA COM CALEBE" sub="Dúvidas, leads, atendimento" />
              <SupportRow href={WA_SUPORTE} color="#FCA5A5" bg="rgba(220,38,38,.12)" icon={LifeBuoy} title="Suporte técnico" sub="Erros do sistema · app, áudio, leads" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SupportRow({ href, color, bg, icon: Icon, title, sub, featured }: any) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const baseBorder = isLight ? "1px solid rgba(4,16,31,.12)" : "1px solid rgba(255,255,255,.08)";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 group"
      style={{
        textDecoration: "none",
        border: featured ? "2px solid #25D366" : baseBorder,
        borderRadius: featured ? 12 : 10,
        padding: featured ? "14px 14px" : "11px 12px",
        background: featured ? "rgba(37,211,102,.10)" : "transparent",
        boxShadow: featured ? "0 0 0 4px rgba(37,211,102,.12), 0 6px 20px rgba(37,211,102,.18)" : "none",
        position: "relative",
      }}
    >
      {featured && (
        <span style={{ position: "absolute", top: -9, left: 12, background: "#25D366", color: "#04101F", fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", padding: "2px 8px", borderRadius: 999, textTransform: "uppercase" }}>
          ★ Atendimento principal
        </span>
      )}
      <div style={{ height: featured ? 46 : 40, width: featured ? 46 : 40, borderRadius: 9, background: bg, color, display: "grid", placeItems: "center", flex: "none" }}><Icon size={featured ? 23 : 20} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className={featured ? "text-base font-extrabold text-sand-50 leading-tight" : "text-sm font-bold text-sand-50 leading-tight"}>{title}</p>
        <p className={featured ? "text-xs font-semibold truncate" : "text-xs text-sand-100/60 truncate"} style={featured ? { color: isLight ? "#15803D" : "#86EFAC" } : undefined}>{sub}</p>
      </div>
      <MessageCircle size={featured ? 18 : 15} style={featured ? { color: "#25D366" } : undefined} className={featured ? "shrink-0" : "text-sand-100/40 group-hover:text-sand-100/70 transition-colors shrink-0"} />
    </a>
  );
}
