import { createBrowserRouter, Navigate } from "react-router-dom";
import { RequireAuth } from "./guards";

// Layouts
import { PublicLayout } from "@/components/layout/PublicLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { CorretorLayout } from "@/components/layout/CorretorLayout";
import { DevLayout } from "@/components/layout/DevLayout";

// Públicas
import { Landing } from "@/features/public/Landing";
import { Cadastro } from "@/features/public/Cadastro";
import { LpImovel } from "@/features/public/LpImovel";
import { LpAfiliado } from "@/features/public/LpAfiliado";
import { PrimeiroAcesso } from "@/features/public/PrimeiroAcesso";

// Admin (todas portadas)
import { AdminDashboard } from "@/features/admin/routes/Dashboard";
import { AdminDashboardV2 } from "@/features/admin/routes/DashboardV2";
import { ChatMonitor } from "@/features/admin/routes/ChatMonitor";
import { ChatMonitorV2 } from "@/features/admin/routes/ChatMonitorV2";
import { ChatHistorico } from "@/features/admin/routes/ChatHistorico";
import { Aprovacao } from "@/features/admin/routes/Aprovacao";
import { Corretores } from "@/features/admin/routes/Corretores";
import { AdminLeads } from "@/features/admin/routes/Leads";
import { Distribuicao } from "@/features/admin/routes/Distribuicao";
import { Lps } from "@/features/admin/routes/Lps";
import { Ingestao } from "@/features/admin/routes/Ingestao";
import { Tv } from "@/features/admin/routes/Tv";
import { Notificacoes as AdminNotif } from "@/features/admin/routes/Notificacoes";
import { NotificacoesConfig as AdminNotifConfig } from "@/features/admin/routes/NotificacoesConfig";
import { Imoveis as AdminImoveis } from "@/features/admin/routes/Imoveis";
import { Estrutura as AdminEstrutura } from "@/features/admin/routes/Estrutura";
import { Visitas as AdminVisitas } from "@/features/admin/routes/Visitas";
import { Vendas as AdminVendas } from "@/features/admin/routes/Vendas";
import { Juridico as AdminJuridico } from "@/features/admin/routes/Juridico";
import { Financeiro as AdminFinanceiro } from "@/features/admin/routes/Financeiro";
import { Ranking } from "@/features/admin/routes/Ranking";
import { Avisos as AdminAvisos } from "@/features/admin/routes/Avisos";
import { Config } from "@/features/admin/routes/Config";
import { Logs } from "@/features/admin/routes/Logs";
import { Analitico } from "@/features/admin/routes/Analitico";
import { Campanhas } from "@/features/admin/routes/Campanhas";
import { CommercialSupport } from "@/features/admin/routes/CommercialSupport";
import { LiberacaoTelefone } from "@/features/admin/routes/LiberacaoTelefone";
import { AdminPermutas } from "@/features/admin/routes/Permutas";
import { WhatsAppNumeros } from "@/features/admin/routes/WhatsAppNumeros";

// Corretor (todas portadas)
import { CorretorDashboard } from "@/features/corretor/routes/Dashboard";
import { CorretorDashboardV2 } from "@/features/corretor/routes/DashboardV2";
import { CorretorChat } from "@/features/corretor/routes/Chat";
import { CorretorConversa } from "@/features/corretor/routes/Conversa";
import { CorretorChatV2 } from "@/features/corretor/chat-v2/ChatV2";
import { CorretorImoveis } from "@/features/corretor/routes/Imoveis";
import { CorretorEstrutura } from "@/features/corretor/routes/Estrutura";
import { CorretorVisitas } from "@/features/corretor/routes/Visitas";
import { CorretorVendas } from "@/features/corretor/routes/Vendas";
import { CorretorJuridico } from "@/features/corretor/routes/Juridico";
import { CorretorAvisos } from "@/features/corretor/routes/Avisos";
import { CorretorNotificacoes } from "@/features/corretor/routes/Notificacoes";
import { CorretorFinanceiro } from "@/features/corretor/routes/Financeiro";
import { CorretorPerfil } from "@/features/corretor/routes/Perfil";
import { CorretorSuporte } from "@/features/corretor/routes/Suporte";
import { CorretorPermuta } from "@/features/corretor/routes/Permuta";
import { CorretorDisputas } from "@/features/corretor/routes/Disputas";

// Personas restritas
import { JuridicoKanban } from "@/features/juridico/routes/Kanban";
import { ReservasEstrutura } from "@/features/reservas/routes/Estrutura";

// Dev (perfil DEV — relatos + logs + escala de envios)
import { DevMensagens } from "@/features/dev/routes/Mensagens";
import { DevFeedback } from "@/features/dev/routes/Feedback";
import { DevLogs } from "@/features/dev/routes/Logs";
import { DevMetrics } from "@/features/dev/routes/Metrics";

export const router = createBrowserRouter([
  // Magic link · primeiro acesso · full-screen (sem PublicLayout)
  { path: "/primeiro-acesso", element: <PrimeiroAcesso /> },
  // LP do imóvel · full-screen (SEM a barra de sistema do PublicLayout) · é o que o lead vê
  { path: "/imovel/:codigo", element: <LpImovel /> },
  {
    element: <PublicLayout />,
    children: [
      { path: "/",                element: <Landing /> },
      { path: "/cadastro",        element: <Cadastro /> },
      { path: "/c/:slug",         element: <LpAfiliado /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <RequireAuth persona="admin">
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true,             element: <AdminDashboardV2 /> },
      { path: "dashboard-legado", element: <AdminDashboard /> },
      { path: "dashboard-novo",  element: <AdminDashboardV2 /> },
      { path: "aprovacao",       element: <Aprovacao /> },
      { path: "corretores",      element: <Corretores /> },
      { path: "permutas",        element: <AdminPermutas /> },
      { path: "leads",           element: <AdminLeads /> },
      { path: "distribuicao",    element: <Distribuicao /> },
      { path: "lps",             element: <Lps /> },
      { path: "ingestao",        element: <Ingestao /> },
      { path: "tv",              element: <Tv /> },
      { path: "chat-monitor",    element: <ChatMonitor /> },
      { path: "chat-monitor-v2", element: <ChatMonitorV2 /> },
      { path: "chat-historico",  element: <ChatHistorico /> },
      { path: "notificacoes",    element: <AdminNotif /> },
      { path: "notificacoes-config", element: <AdminNotifConfig /> },
      { path: "imoveis",         element: <AdminImoveis /> },
      { path: "estrutura",       element: <AdminEstrutura /> },
      { path: "visitas",         element: <AdminVisitas /> },
      { path: "vendas",          element: <AdminVendas /> },
      { path: "juridico",        element: <AdminJuridico /> },
      { path: "liberacao-telefone", element: <LiberacaoTelefone /> },
      { path: "financeiro",      element: <AdminFinanceiro /> },
      { path: "ranking",         element: <Ranking /> },
      { path: "avisos",          element: <AdminAvisos /> },
      { path: "config",          element: <Config /> },
      { path: "logs",            element: <Logs /> },
      { path: "analitico",       element: <Analitico /> },
      { path: "campanhas",       element: <Campanhas /> },
      { path: "ajuda-comercial", element: <CommercialSupport /> },
      { path: "whatsapp-numeros", element: <WhatsAppNumeros /> },
    ],
  },
  {
    path: "/corretor",
    element: (
      <RequireAuth persona="corretor">
        <CorretorLayout />
      </RequireAuth>
    ),
    children: [
      { index: true,           element: <CorretorDashboardV2 /> },
      { path: "dashboard-legado", element: <CorretorDashboard /> },
      { path: "dashboard-novo", element: <CorretorDashboardV2 /> },
      { path: "leads",         element: <Navigate to="/corretor/chat" replace /> },
      { path: "chat",          element: <CorretorChatV2 /> },
      { path: "chat/conv/:convId", element: <CorretorChatV2 /> },
      { path: "chat-legado",   element: <CorretorChat /> },
      { path: "chat-legado/conv/:convId", element: <CorretorConversa /> },
      { path: "imoveis",       element: <CorretorImoveis /> },
      { path: "permuta",       element: <CorretorPermuta /> },
      { path: "estrutura",     element: <CorretorEstrutura /> },
      { path: "visitas",       element: <CorretorVisitas /> },
      { path: "vendas",        element: <CorretorVendas /> },
      { path: "juridico",      element: <CorretorJuridico /> },
      { path: "avisos",        element: <CorretorAvisos /> },
      { path: "notificacoes",  element: <CorretorNotificacoes /> },
      { path: "financeiro",    element: <CorretorFinanceiro /> },
      { path: "perfil",        element: <CorretorPerfil /> },
      { path: "suporte",       element: <CorretorSuporte /> },
      { path: "disputas",      element: <CorretorDisputas /> },
    ],
  },
  {
    path: "/juridico",
    element: (
      <RequireAuth role="LEGAL">
        <AdminLayout />
      </RequireAuth>
    ),
    children: [{ index: true, element: <JuridicoKanban /> }],
  },
  {
    path: "/colab",
    element: (
      <RequireAuth role="SECRETARY">
        <AdminLayout />
      </RequireAuth>
    ),
    children: [{ index: true, element: <ReservasEstrutura /> }],
  },
  {
    path: "/dev",
    element: (
      <RequireAuth role="DEV">
        <DevLayout />
      </RequireAuth>
    ),
    children: [
      { index: true,        element: <Navigate to="mensagens" replace /> },
      { path: "mensagens",  element: <DevMensagens /> },
      { path: "feedback",   element: <DevFeedback /> },
      { path: "logs",       element: <DevLogs /> },
      { path: "metrics",    element: <DevMetrics /> },
    ],
  },
], { basename: (import.meta.env.BASE_URL || "/").replace(/\/+$/, "") || "/" });
