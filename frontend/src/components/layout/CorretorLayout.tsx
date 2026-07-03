import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { trackRoute } from "@/lib/trackRoute";
import {
  LayoutDashboard, MessagesSquare, Building2, Megaphone, Gem, CalendarCheck,
  FileCheck2, Scale, DollarSign, UserCog, LifeBuoy, Trophy,
} from "lucide-react";
import { SessionBar } from "./SessionBar";
import { Sidebar, type SidebarSection } from "./Sidebar";
import { MobileDrawer } from "./MobileDrawer";
import { Link } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { resolveBackendUrl } from "@/lib/media";

// Estrutura corretor FIEL ao monólito (linhas 2694-2731) · lista direta sem títulos de seção
// Único cluster destacado é "Diferencial Calebe" → Estrutura Premium
const corretorSections: SidebarSection[] = [
  {
    items: [
      { to: "/corretor",              label: "Dashboard",      icon: LayoutDashboard, end: true },
      { to: "/corretor/chat",         label: "Chat Lead",      icon: MessagesSquare, highlight: true },
      // 2026-06-03 · "Disputas" ocultado do menu a pedido (rota mantida, sem link)
      { to: "/corretor/imoveis",      label: "Imóveis",        icon: Building2 },
      { to: "/corretor/permuta",      label: "Permuta/Avaliação", icon: FileCheck2 },
      { to: "/corretor/avisos",       label: "Avisos",         icon: Megaphone },
      // 2026-06-02 · removido "Notificações" — push nativo via Play Store / App Store
    ],
  },
  {
    title: "Diferencial Calebe",
    items: [
      { to: "/corretor/estrutura", label: "Estrutura Premium", icon: Gem, highlight: true },
    ],
  },
  {
    items: [
      { to: "/corretor/visitas",    label: "Visitas",     icon: CalendarCheck },
      { to: "/corretor/vendas",     label: "Vendas",      icon: FileCheck2 },
      { to: "/corretor/juridico",   label: "Jurídico",    icon: Scale },
      { to: "/corretor/financeiro", label: "Financeiro",  icon: DollarSign },
      { to: "/corretor/suporte",    label: "Suporte",     icon: LifeBuoy },
      { to: "/corretor/perfil",     label: "Meu Perfil",  icon: UserCog },
    ],
  },
];

export function CorretorLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const _loc = useLocation();
  useEffect(() => { trackRoute(_loc.pathname); }, [_loc.pathname]);
  const user = useAuth((s) => s.user);
  const associate = (user?.associate as any) ?? {};
  const phoneAlertActive = !!associate.phoneAlertActive;
  const initials = (user?.name ?? "?")
    .split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?";
  const cat = associate.category ? String(associate.category).toLowerCase() : "bronze";
  const segmento = associate.segment ?? "Regional";

  // Profile footer · monólito linha 2722
  const photoUrl = resolveBackendUrl((user?.associate as any)?.photoUrl);
  const profileFooter = user ? (
    <div className="p-4 flex items-center gap-3">
      {photoUrl ? (
        <img src={photoUrl} alt={user.name} className="h-10 w-10 rounded-full object-cover border border-gold-400/40 shrink-0" />
      ) : (
        <div className="h-10 w-10 rounded-full bg-gold-gradient text-app-canvas flex items-center justify-center text-sm font-bold shrink-0" translate="no">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{user.name}</p>
        <p className="text-[0.62rem] uppercase tracking-mono-xwide text-gold-400/80 truncate">
          Categoria {cat} · {segmento}
        </p>
      </div>
    </div>
  ) : null;

  const sidebarContent = (
    <Sidebar
      sections={corretorSections}
      onItemClick={() => setDrawerOpen(false)}
      footer={profileFooter}
    />
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      <SessionBar onMenuClick={() => setDrawerOpen(true)} />

      {phoneAlertActive && (
        <div className="flex items-center justify-between gap-3 bg-amber-500 text-white px-4 py-2 text-sm font-medium shrink-0">
          <span>
            ⚠️ <strong>Ação necessária:</strong> Cadastre seu telefone ou perderá acesso em 24h.
            Vá em <strong>Meu Perfil → Dados de Contato</strong> e informe um número válido.
          </span>
          <Link
            to="/corretor/perfil"
            className="shrink-0 rounded bg-white/20 hover:bg-white/30 px-3 py-1 text-xs font-semibold transition"
          >
            Ir agora →
          </Link>
        </div>
      )}

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
    </div>
  );
}
