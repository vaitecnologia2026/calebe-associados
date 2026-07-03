// Dashboard corretor · porte FIEL do cors-dashboard do monólito (linha 2744-2916)
// Header com pills (CRECI, segmento) + CTAs (Chat Lead, Ajuda Calebe, Suporte técnico,
// Corretor Calebe WhatsApp) + 3 cards Estrutura Premium + atalhos mobile +
// 4 KPIs clicáveis + Performance 30d + Novos leads sidebar

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck, LifeBuoy, MessageSquareHeart, MessageCircle, ArrowRight,
  MessagesSquare, Plane, Building2 as BuildingIcon, Car, UserPlus, Home as HomeIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useConversations } from "@/store/conversations";

const WA_AJUDA   = "https://wa.me/5547992069573?text=Ol%C3%A1%2C%20sou%20Corretor%20Associado%20Calebe%20e%20preciso%20de%20ajuda.";
const WA_SUPORTE = "https://wa.me/5547992117994?text=Ol%C3%A1%2C%20sou%20Corretor%20Associado%20Calebe%20e%20preciso%20de%20ajuda%20com%20a%20plataforma.";
const WA_CORRETOR_CALEBE = "https://wa.me/5547992678100";

// Backend GET /api/dashboards/associate retorna estes 4 KPIs reais (associate, leadsTotal,
// leadsDistributedToday, leadsActive, unreadNotifications). Não tem performance/visitas/comissão
// no backend ainda — esses widgets ficaram em standby até as métricas existirem.
interface AssociateStats {
  associate?: { id: string; category?: string; segment?: string; status?: string };
  leadsTotal?: number;
  leadsDistributedToday?: number;
  leadsActive?: number;
  unreadNotifications?: number;
}

export function CorretorDashboard() {
  const user = useAuth((s) => s.user);
  const conversations = useConversations((s) => s.list);
  const fetchList = useConversations((s) => s.fetchList);
  const nav = useNavigate();
  const [stats, setStats] = useState<AssociateStats>({});

  useEffect(() => { void fetchList(); }, [fetchList]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<AssociateStats>("/api/dashboards/associate").catch(() => ({} as AssociateStats));
        setStats(r ?? {});
      } catch { /* silent */ }
    })();
  }, []);

  const ativas = conversations.filter((c) => {
    const s = c.status;
    return s !== "perdido" && s !== "fechado" && s !== "descartado";
  }).length;

  // Conversas mexidas nas últimas 24h pra alimentar a sidebar "Conversas recentes"
  const novosLeads = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return conversations
      .filter((c) => {
        const at = c.lastMessageAt ?? c.createdAt;
        return at ? new Date(at).getTime() >= cutoff : false;
      })
      .sort((a, b) => {
        const aT = new Date(a.lastMessageAt ?? a.createdAt ?? 0).getTime();
        const bT = new Date(b.lastMessageAt ?? b.createdAt ?? 0).getTime();
        return bT - aT;
      });
  }, [conversations]);

  const associate = user?.associate as any;
  const primeiroNome = user?.name?.split(" ")[0] ?? "—";
  const segmento = associate?.segment ?? associate?.category;
  const chatCount = ativas;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header · saudação + pills + botões WhatsApp */}
      <header className="mb-6 md:mb-8 flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="meta-gold">Bem-vindo</p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight mt-1">
            Olá, <span className="text-gold-400">{primeiroNome}</span>.
          </h1>
          <p className="text-sand-100/65 mt-2 max-w-xl text-sm">
            Sua operação Calebe hoje. Use os recursos exclusivos abaixo para alavancar suas vendas.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-gold-400/10 text-gold-300 border border-gold-400/30 font-semibold tracking-wide">
            <BadgeCheck size={13} /> {user?.name}
          </span>
          {segmento && (
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-app-subtle/60 text-sand-100/75 border hairline font-semibold tracking-wide">
              {segmento}
            </span>
          )}
          <a
            href={WA_SUPORTE} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-bold uppercase tracking-mono-wide"
            style={{ background: "linear-gradient(135deg,#DC2626,#B91C1C)", color: "#fff" }}
            title="Problema na plataforma? Suporte Técnico"
          >
            <LifeBuoy size={13} /> Suporte técnico
          </a>
          <a
            href={WA_AJUDA} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-bold uppercase tracking-mono-wide"
            style={{ background: "linear-gradient(135deg,#DEB96D,#C9A961)", color: "#04101F" }}
            title="PROPOSTA FIRME FALA COM CALEBE · WhatsApp"
          >
            <MessageSquareHeart size={13} /> PROPOSTA FIRME FALA COM CALEBE
          </a>
        </div>
      </header>

      {/* Atalho grande · Chat Lead */}
      <button
        onClick={() => nav("/corretor/chat")}
        className="card w-full p-5 md:p-6 mb-3 flex items-center gap-4 text-left group hover:border-gold-400/60 transition-all"
        style={{
          background: "linear-gradient(135deg, rgba(201,169,97,.2), rgba(201,169,97,.05))",
          borderColor: "rgba(201,169,97,.55)",
          boxShadow: "0 4px 16px rgba(201,169,97,.2)",
        }}
      >
        <div
          className="h-14 w-14 rounded flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#DEB96D,#C9A961)", color: "#04101F", boxShadow: "0 4px 14px rgba(201,169,97,.5)" }}
        >
          <MessagesSquare size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.65rem] uppercase tracking-mono-label font-bold text-gold-300 mb-1">Atalho rápido</p>
          <p className="text-base md:text-lg font-bold text-sand-50 leading-tight">
            Chat Lead · {chatCount} conversa{chatCount === 1 ? "" : "s"}
          </p>
          <p className="text-xs md:text-sm text-sand-100/70 mt-1">Toque para abrir todos os seus leads e responder direto.</p>
        </div>
        <span
          className="hidden md:inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-mono-xwide px-3 py-2 rounded shrink-0"
          style={{ background: "linear-gradient(135deg,#DEB96D,#C9A961)", color: "#04101F" }}
        >
          <ArrowRight size={13} /> Abrir
        </span>
        <ArrowRight size={22} className="md:hidden text-gold-300 group-hover:translate-x-1 transition-transform shrink-0" />
      </button>

      {/* Banner Acordo · backend ainda não expõe agreementUrl no /associate endpoint */}

      {/* Cards CTA grandes · 3 stacked */}
      <a
        href={WA_AJUDA} target="_blank" rel="noreferrer"
        className="card p-5 md:p-6 mb-3 flex items-center gap-4 group hover:border-gold-400/50 transition-colors"
        style={{ textDecoration: "none" }}
      >
        <div
          className="h-14 w-14 rounded flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#DEB96D,#C9A961)", color: "#04101F", boxShadow: "0 4px 14px rgba(201,169,97,.4)" }}
        >
          <MessageSquareHeart size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.65rem] uppercase tracking-mono-label font-bold text-gold-400 mb-1">Fale com o Calebe</p>
          <p className="text-base md:text-lg font-bold text-sand-50 leading-tight">Precisa de ajuda? Estamos aqui pra você.</p>
          <p className="text-xs md:text-sm text-sand-100/70 mt-1">Dúvidas, leads, atendimento · WhatsApp direto com o time Calebe.</p>
        </div>
        <span
          className="hidden md:inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-mono-xwide px-3 py-2 rounded shrink-0"
          style={{ background: "linear-gradient(135deg,#DEB96D,#C9A961)", color: "#04101F" }}
        >
          <MessageCircle size={13} /> Abrir WhatsApp
        </span>
      </a>

      <a
        href={WA_SUPORTE} target="_blank" rel="noreferrer"
        className="card p-5 md:p-6 mb-3 flex items-center gap-4 group"
        style={{ textDecoration: "none" }}
      >
        <div
          className="h-14 w-14 rounded flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#DC2626,#B91C1C)", color: "#FFF", boxShadow: "0 4px 14px rgba(220,38,38,.45)" }}
        >
          <LifeBuoy size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.65rem] uppercase tracking-mono-label font-bold mb-1" style={{ color: "#FCA5A5" }}>Problema na plataforma?</p>
          <p className="text-base md:text-lg font-bold text-sand-50 leading-tight">Suporte técnico · use ESTE canal pra erros do sistema</p>
          <p className="text-xs md:text-sm text-sand-100/70 mt-1">
            App travou, áudio não envia, lead não chegou, etc · NÃO use a PROPOSTA FIRME FALA COM CALEBE pra isso.
          </p>
        </div>
        <span
          className="hidden md:inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-mono-xwide px-3 py-2 rounded shrink-0"
          style={{ background: "linear-gradient(135deg,#DC2626,#B91C1C)", color: "#FFF" }}
        >
          <MessageCircle size={13} /> Chamar suporte
        </span>
      </a>

      <a
        href={WA_CORRETOR_CALEBE} target="_blank" rel="noreferrer"
        className="card p-5 md:p-6 mb-6 flex items-center gap-4 group hover:border-emerald-400/40"
        style={{ textDecoration: "none" }}
      >
        <div
          className="h-14 w-14 rounded flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#25D366,#128C7E)", color: "#FFF", boxShadow: "0 4px 14px rgba(37,211,102,.4)" }}
        >
          <MessageCircle size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.65rem] uppercase tracking-mono-label font-bold mb-1" style={{ color: "#86EFAC" }}>Atendimento direto</p>
          <p className="text-base md:text-lg font-bold text-sand-50 leading-tight">SUPORTE CORRETOR CALEBE</p>
          <p className="text-xs md:text-sm text-sand-100/70 mt-1">Toque pra abrir o WhatsApp · (47) 99267-8100.</p>
        </div>
        <span
          className="hidden md:inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-mono-xwide px-3 py-2 rounded shrink-0"
          style={{ background: "linear-gradient(135deg,#25D366,#128C7E)", color: "#FFF" }}
        >
          <MessageCircle size={13} /> WhatsApp
        </span>
      </a>

      {/* Estrutura exclusiva Calebe · 3 cards */}
      <section className="mb-10">
        <div className="flex items-end justify-between mb-5">
          <h2 className="text-lg md:text-xl font-bold tracking-[-0.02em]">
            Estrutura <span className="text-gold-400">exclusiva</span> Calebe
          </h2>
          <button
            className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1.5"
            onClick={() => nav("/corretor/estrutura")}
          >
            Ver histórico <ArrowRight size={13} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
          {[
            { tipo: "aviao", icon: Plane, title: "Reservar Avião", desc: "Traslado aéreo para visitas estratégicas" },
            { tipo: "apartamento", icon: BuildingIcon, title: "Reservar Apartamento", desc: "Apoio e hospedagem durante atendimentos" },
            { tipo: "veiculo", icon: Car, title: "Reservar Veículo", desc: "Motorista ou carro para receber o cliente" },
          ].map(({ tipo, icon: Icon, title, desc }) => (
            <button
              key={tipo}
              onClick={() => nav(`/corretor/estrutura?tipo=${tipo}`)}
              className="group relative overflow-hidden card p-6 md:p-7 text-left hover:border-gold-400/50 transition-all"
            >
              <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gold-400/10 blur-3xl group-hover:bg-gold-400/20 transition-colors" />
              <div className="relative z-10">
                <div className="h-14 w-14 rounded border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400 mb-5 group-hover:border-gold-400/60 transition-colors">
                  <Icon size={28} />
                </div>
                <h3 className="text-lg md:text-xl font-extrabold tracking-[-0.02em]">{title}</h3>
                <p className="text-sm text-sand-100/60 mt-2 mb-5 leading-relaxed">{desc}</p>
                <span className="inline-flex items-center gap-1.5 text-[0.7rem] uppercase tracking-mono-xwide font-semibold text-gold-300">
                  Solicitar <ArrowRight size={13} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Atalhos mobile-only · 3 cards */}
      <section className="md:hidden grid grid-cols-3 gap-3 mb-5">
        <ShortcutMobile onClick={() => nav("/corretor/chat")} icon={MessagesSquare} iconBg="bg-gold-400/15" iconBorder="border-gold-400/30" iconColor="text-gold-300" label="Chat" />
        <ShortcutMobile onClick={() => nav("/corretor/chat")} icon={UserPlus} iconBg="bg-emerald-500/15" iconBorder="border-emerald-500/30" iconColor="text-emerald-300" label="Novos leads" />
        <ShortcutMobile onClick={() => nav("/corretor/imoveis")} icon={HomeIcon} iconBg="bg-blue-500/15" iconBorder="border-blue-500/30" iconColor="text-blue-300" label="Imóveis" />
      </section>

      {/* 4 KPIs + Novos leads (derivados das conversas) */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiClick onClick={() => nav("/corretor/chat")} label="Leads hoje" value={stats.leadsDistributedToday ?? 0} hint="distribuídos pra você" />
            <KpiClick onClick={() => nav("/corretor/chat")} label="Em conversa" value={ativas} />
            <KpiClick onClick={() => nav("/corretor/chat")} label="Leads ativos" value={stats.leadsActive ?? 0} hint="em qualificação/negociação" />
            <KpiClick onClick={() => nav("/corretor/notificacoes")} label="Notificações" value={stats.unreadNotifications ?? 0} hint="não lidas" />
          </div>
        </div>

        <div className="card p-5">
          <span className="pill mb-3 inline-block">Conversas recentes</span>
          {novosLeads.length === 0 ? (
            <p className="text-sm text-sand-100/55 italic mt-3">Nenhuma conversa nas últimas 24h.</p>
          ) : (
            <ul className="divide-y hairline mt-3">
              {novosLeads.slice(0, 8).map((c) => (
                <li key={c.id} className="py-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{c.lead?.name ?? "—"}</p>
                    <p className="text-[0.7rem] text-sand-100/55 truncate">{c.lead?.origin ?? "—"}</p>
                  </div>
                  <span className="text-[0.65rem] text-sand-100/45 shrink-0">{c.lastMessageAt?.slice(11, 16) ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function ShortcutMobile({ onClick, icon: Icon, iconBg, iconBorder, iconColor, label }: any) {
  return (
    <button
      onClick={onClick}
      className="card p-4 flex flex-col items-center gap-1.5 hover:border-gold-400/50 transition-colors active:scale-95"
      style={{ minHeight: 96 }}
    >
      <div className={`h-11 w-11 rounded-full ${iconBg} border ${iconBorder} flex items-center justify-center ${iconColor}`}>
        <Icon size={20} />
      </div>
      <p className="text-[0.72rem] font-bold uppercase tracking-mono-wide text-sand-50">{label}</p>
    </button>
  );
}

function KpiClick({ onClick, label, value, hint }: { onClick: () => void; label: string; value: any; hint?: string }) {
  return (
    <button
      onClick={onClick}
      className="card p-4 text-left hover:border-gold-400/40 transition-colors active:scale-[0.97]"
    >
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">{label}</p>
      <p className="text-2xl md:text-[2rem] font-display font-light tracking-[-0.03em] mt-1 leading-tight">{value}</p>
      {hint && <p className="text-xs text-sand-100/55 mt-1 truncate">{hint}</p>}
    </button>
  );
}

