import { useState, useEffect } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { trackRoute } from "@/lib/trackRoute";
import {
  LayoutDashboard, UserCheck, Users, Target, Shuffle, DownloadCloud, Tv, MessagesSquare, Radar,
  Building2, Package, MapPin, ShoppingBag, Scale, Wallet, TrendingUp, Megaphone,
  Settings, ScrollText, PhoneCall, History, BarChart3, HeartHandshake, Smartphone, Bell,
} from "lucide-react";
import { useAuth } from "@/store/auth";
import { SessionBar } from "./SessionBar";
import { Sidebar, type SidebarSection } from "./Sidebar";
import { MobileDrawer } from "./MobileDrawer";
import { AssistantChat } from "@/components/AssistantChat";

// 3 seções espelhando o monólito (linha 3585-3608)
const adminSections: SidebarSection[] = [
  {
    title: "Principal",
    items: [
      { to: "/admin",             label: "Dashboard",          icon: LayoutDashboard, end: true },
      { to: "/admin/aprovacao",   label: "Aprovação",          icon: UserCheck },
      { to: "/admin/corretores",  label: "Corretores",         icon: Users },
      { to: "/admin/permutas",    label: "Permutas",           icon: Package },
      { to: "/admin/leads",       label: "Leads",              icon: Target },
      { to: "/admin/distribuicao",label: "Distribuição",       icon: Shuffle },
      { to: "/admin/ingestao",    label: "Ingestão",           icon: DownloadCloud },
      { to: "/admin/tv",          label: "Painel TV",          icon: Tv },
      { to: "/admin/chat-monitor",label: "Monitoramento chat", icon: MessagesSquare },
      { to: "/admin/chat-monitor-v2", label: "Central de Operações", icon: Radar },
      { to: "/admin/chat-historico", label: "Histórico de chat", icon: History },
      { to: "/admin/analitico",       label: "Analítico da Base",   icon: BarChart3 },
      { to: "/admin/campanhas",       label: "Campanhas",           icon: Megaphone },
      { to: "/admin/whatsapp-numeros", label: "Números WhatsApp",   icon: Smartphone },
      // 2026-06-02 · removido "Notificações" — push nativo via Play Store / App Store
    ],
  },
  {
    title: "Operação",
    items: [
      { to: "/admin/imoveis",     label: "Imóveis",           icon: Building2 },
      { to: "/admin/estrutura",   label: "Estrutura Premium", icon: Package },
      { to: "/admin/visitas",     label: "Visitas",           icon: MapPin },
      { to: "/admin/vendas",      label: "Vendas",            icon: ShoppingBag },
    ],
  },
  {
    title: "Back-office",
    items: [
      { to: "/admin/juridico",    label: "Jurídico",       icon: Scale },
      { to: "/admin/liberacao-telefone", label: "Liberação de telefone", icon: PhoneCall },
      { to: "/admin/financeiro",  label: "Financeiro",     icon: Wallet },
      { to: "/admin/ranking",     label: "Ranking",        icon: TrendingUp },
      { to: "/admin/avisos",      label: "Avisos",         icon: Megaphone },
      { to: "/admin/notificacoes-config", label: "Configuração de Notificações", icon: Bell },
      { to: "/admin/config",      label: "Configurações",  icon: Settings },
      { to: "/admin/logs",        label: "Auditoria",      icon: ScrollText },
    ],
  },
];

export function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  useEffect(() => { trackRoute(loc.pathname); }, [loc.pathname]);
  // 2026-06-18 · usuário "commercialOnly" (ex.: ajudacomercial@) só enxerga a tela
  // Ajuda Comercial — sem menu, sem outras telas. Trava no layout (front); a API do
  // módulo já é gated por commercialSupportAccess.
  const commercialOnly = (user as any)?.commercialOnly === true;
  // 2026-07-03 · Ajuda Comercial no menu: TODO admin (e DEV). Trava da flag removida (Elison).
  const canCommercial = user?.role === "DEV" || user?.role === "ADMIN";

  // Rotas permitidas para commercialOnly (além de ajuda-comercial)
  const commercialAllowedRoutes = [
    "/admin/ajuda-comercial",
    "/admin/corretores",
    "/admin/chat-monitor",
    "/admin/chat-monitor-v2",
  ];
  const isAllowedForCommercial = commercialAllowedRoutes.some(r => loc.pathname.startsWith(r));

  const sections: SidebarSection[] = commercialOnly
    ? [{
        title: "Operações Comerciais",
        items: [
          { to: "/admin/ajuda-comercial",  label: "Ajuda Comercial",      icon: HeartHandshake },
          { to: "/admin/corretores",        label: "Corretores",           icon: Users },
          { to: "/admin/chat-monitor-v2",   label: "Central de Operações", icon: Radar },
          { to: "/admin/chat-monitor",      label: "Monitoramento Chat",   icon: MessagesSquare },
        ],
      }]
    : canCommercial
      ? adminSections.map((sec) => sec.title === "Principal"
          ? { ...sec, items: [...sec.items, { to: "/admin/ajuda-comercial", label: "Ajuda Comercial", icon: HeartHandshake }] }
          : sec)
      : adminSections;

  // Trava: commercialOnly só acessa as rotas permitidas acima.
  if (commercialOnly && !isAllowedForCommercial) {
    return <Navigate to="/admin/ajuda-comercial" replace />;
  }

  const sidebarContent = (
    <Sidebar sections={sections} onItemClick={() => setDrawerOpen(false)} />
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <SessionBar onMenuClick={() => setDrawerOpen(true)} />

      <div className="flex-1 flex min-h-0">
        <aside className="hidden md:flex shrink-0 h-full">
          {sidebarContent}
        </aside>

        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          {sidebarContent}
        </MobileDrawer>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* Assistente IA (renderiza apenas se user.role === "ADMIN") · oculto p/ commercialOnly */}
      {!commercialOnly && <AssistantChat />}
    </div>
  );
}
