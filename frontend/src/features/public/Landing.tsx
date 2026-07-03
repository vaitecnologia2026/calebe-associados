// LP institucional Calebe · portado fielmente de
// /Users/bello/Documents/VAI/CALEBE/calebe/public/index.html linhas 2176-2470
//
// Estrutura preservada:
//   1. Hero · phone Instagram-style com vídeo + texto + CTAs
//   2. "Toda a estrutura para fechar sua venda" · 5 cards
//   3. "A operação" · 3 cards
//   4. "O que é oferecido ao corretor associado" · 4 cards
//   5. "Como funciona" · 4 etapas
//   6. "Posicionamento" · 3 colunas + CTA final + badges

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, ShieldCheck, MapPin, Lock, Car, Plane, Building2, Zap, BadgeCheck,
  Target, ClipboardCheck, Layers, Building, Scale, Headphones, Heart, MessageCircle,
  Send, MoreVertical, Volume2, VolumeX, Smartphone,
} from "lucide-react";
import { LoginModal } from "@/features/auth/LoginModal";
import { useAuth } from "@/store/auth";
import { defaultPathFor } from "@/router/guards";

const LOGO_URL = "https://d78txhfo8gp8r.cloudfront.net/calebe/arquivos/logo.png";
const APP_ANDROID_URL = "https://play.google.com/store/apps/details?id=tech.calebe.app";
const APP_IOS_URL = "https://apps.apple.com/br/app/calebe-associados/id6779335281";

export function Landing() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nav = useNavigate();

  // 2026-06-29 · Auto-redirect pro dashboard se já logado. Antes a Landing
  // renderizava os botões "Entrar / Solicitar participação" mesmo pra user
  // autenticado — no Capacitor o app sempre abre em "/" via server.url, então
  // todo open do app caía aqui e parecia que tinha sido deslogado.
  const bootStatus = useAuth((s) => s.bootStatus);
  const persona = useAuth((s) => s.roleEntry?.persona ?? null);
  useEffect(() => {
    if (bootStatus === "ready" && persona) {
      nav(defaultPathFor(persona), { replace: true });
    }
  }, [bootStatus, persona, nav]);

  function openCadastro() { nav("/cadastro"); }
  function openLogin() { setLoginOpen(true); }

  function toggleSom() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) {
      // Play se foi pausado por autoplay policies
      v.play().catch(() => { /* ignore */ });
    }
  }

  // Auto-tenta dar play (autoplay muted é permitido)
  useEffect(() => {
    videoRef.current?.play().catch(() => { /* ignore */ });
  }, []);

  // 2026-06-29 · Enquanto o restoreSession() está em curso (boot do app), NÃO
  // renderiza os botões públicos — eles aparecem por meio segundo e dão a
  // impressão de "deslogou". Mostra um loading limpo até decidir.
  if (bootStatus === "idle" || bootStatus === "restoring") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <div className="text-center">
          <img src={LOGO_URL} alt="Calebe Associados" className="h-12 w-auto mx-auto mb-4 opacity-80" />
          <p className="text-sand-100/55 text-sm">Carregando…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ═══ HERO ═══ */}
      <section className="relative">
        <div className="container-site pt-12 md:pt-20 pb-16 md:pb-24">
          <div className="grid lg:grid-cols-[auto_1fr] gap-10 lg:gap-14 xl:gap-20 items-center">
            {/* Phone */}
            <div className="lp-phone-wrap order-2 lg:order-1 justify-self-center lg:justify-self-start">
              <div className="lp-phone">
                <div className="lp-phone-screen">
                  <video
                    ref={videoRef}
                    src="https://app.calebe.tech/videos/hero-lp.mp4"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                  />
                </div>

                {/* Top overlay Instagram-style */}
                <div className="lp-ig-top">
                  <div className="lp-ig-user">
                    <div className="lp-ig-avatar">
                      <img src={LOGO_URL} alt="Calebe Imóveis" />
                    </div>
                    <span className="lp-ig-name">calebe_imoveis</span>
                    <span className="lp-ig-verified" role="img" aria-label="Conta verificada" title="Verificado">
                      <BadgeCheck size={16} />
                    </span>
                  </div>
                  <button
                    type="button"
                    className="lp-ig-sound"
                    aria-label={muted ? "Ativar som do vídeo" : "Silenciar vídeo"}
                    onClick={toggleSom}
                  >
                    {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>

                {muted && <span className="lp-sound-hint">Toque para ouvir 🔊</span>}

                <div className="lp-ig-side">
                  <div className="lp-ig-action">
                    <Heart size={24} />
                    <span className="lp-ig-action-count">24,8K</span>
                  </div>
                  <div className="lp-ig-action">
                    <MessageCircle size={24} />
                    <span className="lp-ig-action-count">312</span>
                  </div>
                  <div className="lp-ig-action">
                    <Send size={22} />
                    <span className="lp-ig-action-count">Enviar</span>
                  </div>
                  <div className="lp-ig-action">
                    <MoreVertical size={22} />
                  </div>
                </div>

                <div className="lp-ig-caption">
                  <strong>@calebe.imoveis</strong>
                  <p>Corretor associado Calebe · rede nacional</p>
                </div>
              </div>
            </div>

            {/* Texto */}
            <div className="max-w-2xl order-1 lg:order-2">
              <div className="pill mb-6">
                <BadgeCheck className="icon-sm" /> Programa Nacional Calebe · CRECI 6131J
              </div>
              <h1 className="text-3xl md:text-5xl lg:text-[3.15rem] font-bold leading-[1.08] tracking-[-0.026em] text-sand-50">
                Uma estrutura profissional para corretores que atuam no mercado{" "}
                <span className="text-gold-400">imobiliário</span>.
              </h1>
              <p className="mt-6 text-sand-100/75 text-base md:text-lg leading-relaxed">
                A Calebe Investimentos Imobiliários mantém um programa de corretores associados
                com portfólio selecionado, suporte operacional contínuo e processos padronizados.
                Operação voltada a profissionais com CRECI ativo e histórico consolidado.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
                <button className="btn-base btn-gold" onClick={openCadastro}>
                  Solicitar participação
                  <ArrowRight className="icon-sm" />
                </button>
                <button className="btn-base btn-outline" onClick={openLogin}>
                  Acessar área do corretor associado
                </button>
                <a className="btn-base btn-outline" href={APP_ANDROID_URL} target="_blank" rel="noreferrer">
                  <Smartphone className="icon-sm" />
                  Baixar app Android
                </a>
                <a className="btn-base btn-outline" href={APP_IOS_URL} target="_blank" rel="noreferrer">
                  <Smartphone className="icon-sm" />
                  Baixar app iPhone
                </a>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.7rem] uppercase tracking-mono-xwide text-sand-100/45 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="icon-sm text-gold-400/60" /> CRECI 6131J
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="icon-sm text-gold-400/60" /> Litoral de Santa Catarina
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="icon-sm text-gold-400/60" /> LGPD
                </span>
              </div>
            </div>
          </div>

          {/* Estrutura · 5 cards */}
          <div className="mt-14 md:mt-20">
            <p className="text-[0.72rem] uppercase tracking-mono-label font-semibold text-gold-400/80 mb-5 inline-flex items-center gap-3">
              <span className="w-8 h-px bg-gold-400/70" />
              Toda a estrutura para fechar sua venda
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
              {[
                { Icon: Car,        title: "Carro de luxo",            body: "Frota executiva para receber o cliente" },
                { Icon: Plane,      title: "Avião disponível",         body: "Traslado aéreo em atendimentos estratégicos" },
                { Icon: Building2,  title: "Apartamento alto padrão",  body: "Hospedagem de apoio para o cliente" },
                { Icon: Zap,        title: "Velocidade na negociação", body: "Jurídico e back-office internos" },
                { Icon: BadgeCheck, title: "Comissão garantida",       body: "Processo contratual auditável" },
              ].map(({ Icon, title, body }) => (
                <div key={title} className="card p-5 md:p-6 hover:border-gold-400/40 transition-colors">
                  <div className="h-10 w-10 rounded-sm border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400 mb-4">
                    <Icon size={18} />
                  </div>
                  <p className="text-sm md:text-[0.95rem] font-bold text-sand-50 leading-tight tracking-[-0.01em]">
                    {title}
                  </p>
                  <p className="text-xs text-sand-100/60 mt-1.5 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="divider-gold max-w-container mx-auto" />
      </section>

      {/* ═══ A OPERAÇÃO · 3 cards ═══ */}
      <section className="py-20 md:py-28">
        <div className="container-site">
          <div className="max-w-2xl mb-14">
            <p className="pill mb-5">A operação</p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.5rem] font-bold leading-[1.12] tracking-[-0.024em] text-sand-50">
              Como a Calebe conduz a rede de corretores associados.
            </h2>
            <p className="mt-5 text-sand-100/70 leading-relaxed">
              Três princípios orientam o funcionamento do programa: distribuição planejada de
              oportunidades, acompanhamento rigoroso de cada atendimento e padronização das
              etapas críticas do processo.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-4 lg:gap-5">
            {[
              { Icon: Target,         title: "Distribuição de oportunidades", body: "Oportunidades recebidas pela Calebe são alocadas conforme especialização, histórico e proximidade geográfica do corretor associado." },
              { Icon: ClipboardCheck, title: "Acompanhamento",                body: "Cada atendimento é registrado em sistema próprio, com rastreabilidade do primeiro contato à assinatura do contrato." },
              { Icon: Layers,         title: "Padronização",                  body: "Procedimentos, métodos e protocolos de comunicação alinhados ao padrão Calebe em todas as etapas do atendimento." },
            ].map(({ Icon, title, body }) => (
              <article key={title} className="card p-7 md:p-8">
                <div className="h-11 w-11 rounded-sm border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400 mb-5">
                  <Icon size={20} />
                </div>
                <h3 className="text-lg md:text-xl font-bold text-sand-50 mb-3 tracking-[-0.015em]">{title}</h3>
                <p className="text-sm md:text-[0.95rem] text-sand-100/70 leading-relaxed">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ OFERTA · 4 cards (2x2) ═══ */}
      <section className="py-20 md:py-28 border-t hairline">
        <div className="container-site">
          <div className="max-w-2xl mb-14">
            <p className="pill mb-5">O que é oferecido ao corretor associado</p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.5rem] font-bold leading-[1.12] tracking-[-0.024em] text-sand-50">
              Estrutura completa para atender com o padrão da operação.
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4 lg:gap-5">
            {[
              { Icon: Building,    title: "Portfólio selecionado", body: "Unidades curadas junto a construtoras parceiras, com foco em regiões valorizadas do litoral catarinense." },
              { Icon: Scale,       title: "Apoio jurídico",        body: "Equipe jurídica interna conduz análise, elaboração e acompanhamento contratual durante todo o processo de venda." },
              { Icon: Headphones,  title: "Suporte operacional",   body: "Secretaria, reservas e back-office à disposição do corretor associado — agendamentos, confirmações e apoio logístico quando aplicável." },
              { Icon: ShieldCheck, title: "Processo auditável",    body: "Plataforma própria com conversas registradas e rastreabilidade completa entre distribuição, atendimento e pagamento." },
            ].map(({ Icon, title, body }) => (
              <article key={title} className="card p-7 md:p-8 flex items-start gap-5">
                <div className="h-11 w-11 rounded-sm border border-gold-400/30 bg-gold-400/5 flex items-center justify-center text-gold-400 shrink-0">
                  <Icon size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-sand-50 mb-2 tracking-[-0.01em]">{title}</h3>
                  <p className="text-sand-100/70 leading-relaxed">{body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PROCESSO · 4 etapas ═══ */}
      <section className="py-20 md:py-28 border-t hairline">
        <div className="container-site">
          <div className="max-w-2xl mb-14">
            <p className="pill mb-5">Como funciona</p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.5rem] font-bold leading-[1.12] tracking-[-0.024em] text-sand-50">
              Do cadastro à atuação dentro do programa.
            </h2>
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-4 gap-8 lg:gap-10">
            {[
              { etapa: "Etapa 01", title: "Cadastro",  body: "Preenchimento com dados profissionais, CRECI e documentação complementar." },
              { etapa: "Etapa 02", title: "Análise",   body: "Validação da documentação e avaliação de perfil pela equipe Calebe." },
              { etapa: "Etapa 03", title: "Aprovação", body: "Liberação de acesso ao sistema, termo de adesão e orientações de onboarding." },
              { etapa: "Etapa 04", title: "Atuação",   body: "Recebimento de oportunidades, registro dos atendimentos e acompanhamento pelo sistema." },
            ].map(({ etapa, title, body }) => (
              <li key={etapa} className="relative pt-6 border-t hairline">
                <span className="absolute -top-px left-0 w-14 h-[2px] bg-gold-gradient" />
                <span className="text-gold-400 text-xs tracking-mono-xwide font-semibold uppercase">{etapa}</span>
                <h3 className="text-xl font-bold mt-3 mb-3 tracking-[-0.015em] text-sand-50">{title}</h3>
                <p className="text-sm text-sand-100/70 leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ═══ POSICIONAMENTO + CTA final ═══ */}
      <section className="py-20 md:py-28 border-t hairline">
        <div className="container-site">
          <div className="max-w-3xl">
            <p className="pill mb-5">Posicionamento</p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.6rem] font-bold leading-[1.1] tracking-[-0.024em] text-sand-50">
              Uma operação com <span className="text-gold-400">seleção criteriosa</span> e crescimento planejado.
            </h2>
            <div className="mt-12 grid md:grid-cols-3 gap-8 lg:gap-10">
              {[
                { tag: "Seleção",    body: "Profissionais com CRECI ativo, postura corporativa e histórico compatível com o portfólio atendido pela Calebe." },
                { tag: "Padrão",     body: "Procedimentos documentados e métricas acompanhadas internamente para garantir consistência em cada atendimento." },
                { tag: "Crescimento",body: "Expansão conduzida por demanda regional e absorção gradual de novos corretores associados, sem metas de volume." },
              ].map(({ tag, body }) => (
                <div key={tag}>
                  <p className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80 mb-2">{tag}</p>
                  <p className="text-sand-100/75 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-16 pt-12 border-t hairline">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <p className="text-sand-50 text-xl md:text-2xl font-bold tracking-[-0.018em]">
                  Interessado em integrar o programa?
                </p>
                <p className="mt-2 text-sand-100/65">
                  Análise conduzida pela equipe Calebe. Retorno em até 48 horas úteis.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <button className="btn-base btn-gold" onClick={openCadastro}>
                  Solicitar participação
                  <ArrowRight className="icon-sm" />
                </button>
                <button className="btn-base btn-outline" onClick={openLogin}>
                  Acessar área do corretor associado
                </button>
                <a className="btn-base btn-outline" href={APP_ANDROID_URL} target="_blank" rel="noreferrer">
                  <Smartphone className="icon-sm" />
                  Baixar app Android
                </a>
                <a className="btn-base btn-outline" href={APP_IOS_URL} target="_blank" rel="noreferrer">
                  <Smartphone className="icon-sm" />
                  Baixar app iPhone
                </a>
              </div>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.7rem] uppercase tracking-mono-xwide text-sand-100/45 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="icon-sm text-gold-400/60" /> CRECI 6131J
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="icon-sm text-gold-400/60" /> Dados tratados conforme LGPD
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="icon-sm text-gold-400/60" /> Litoral de Santa Catarina
              </span>
            </div>
          </div>
        </div>
      </section>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
