import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Bug, ScrollText, MessageSquareWarning, Gauge } from "lucide-react";
import { SessionBar } from "./SessionBar";
import { Sidebar, type SidebarSection } from "./Sidebar";
import { MobileDrawer } from "./MobileDrawer";
import { AssistantChat } from "@/components/AssistantChat";

const devSections: SidebarSection[] = [
  {
    title: "Painel Dev",
    items: [
      { to: "/dev/mensagens", label: "Escala de envios", icon: MessageSquareWarning, end: true },
      { to: "/dev/feedback",  label: "Bug Reports",      icon: Bug },
      { to: "/dev/logs",      label: "Audit Logs",       icon: ScrollText },
      { to: "/dev/metrics",   label: "Métricas",         icon: Gauge },
    ],
  },
];

export function DevLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebar = <Sidebar sections={devSections} onItemClick={() => setDrawerOpen(false)} />;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <SessionBar onMenuClick={() => setDrawerOpen(true)} />
      <div className="flex-1 flex min-h-0">
        <aside className="hidden md:flex shrink-0 h-full">{sidebar}</aside>
        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>{sidebar}</MobileDrawer>
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <AssistantChat />
    </div>
  );
}
