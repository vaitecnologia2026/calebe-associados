// SessionBar — top bar com avatar/dropdown estilo card flutuante
// Menu items: Perfil · Configurações · Ajuda (WhatsApp Calebe) · Reportar problema
// · Modo Claro/Escuro · Sair. Status dot (online/offline) e e-mail no header do menu.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LogOut, Menu, Sun, Moon, ChevronDown, User as UserIcon, Settings, HelpCircle, Bug,
} from "lucide-react";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";
import { ReportarProblemaModal } from "@/components/feedback/ReportarProblemaModal";

interface Props {
  onMenuClick?: () => void;
}

const WA_AJUDA = "https://wa.me/5547992069573?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20com%20o%20sistema%20Calebe.";

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function SessionBar({ onMenuClick }: Props) {
  const user = useAuth((s) => s.user);
  const roleEntry = useAuth((s) => s.roleEntry);
  const logout = useAuth((s) => s.logout);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const nav = useNavigate();

  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Fecha dropdown ao clicar fora ou Esc
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user || !roleEntry) return null;

  // URLs de Perfil/Configurações por papel
  const isAdmin = user.role === "ADMIN" || user.role === "LEGAL" || user.role === "SECRETARY";
  const perfilUrl = isAdmin ? "/admin/config" : "/corretor/perfil";
  const configUrl = isAdmin ? "/admin/config" : "/corretor/perfil";

  const go = (url: string) => () => { setOpen(false); nav(url); };

  return (
    <>
      <div className="bg-app-elevated/95 backdrop-blur border-b hairline px-3 md:px-4 py-2.5 flex items-center gap-2 sticky top-0 z-30">
        {/* Hamburger mobile · touch target 44px (Apple HIG / WCAG) */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="md:hidden text-sand-100/70 hover:text-sand-50 -ml-1.5 inline-flex items-center justify-center min-w-[44px] min-h-[44px]"
            aria-label="Menu"
          >
            <Menu size={22} />
          </button>
        )}

        <Link to="/" className="inline-flex items-center gap-2 text-gold-400 font-bold tracking-tight" translate="no">
          <span className="w-7 h-7 rounded-sm bg-gold-gradient text-app-canvas font-display text-base flex items-center justify-center">C</span>
          <span className="text-sm hidden sm:inline">Calebe</span>
        </Link>

        <div className="flex-1" />

        {/* Avatar pill clicável que abre dropdown */}
        <div className="relative">
          <button
            ref={btnRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-app-subtle/60 transition-colors"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <div className="relative w-9 h-9 rounded-lg bg-gold-gradient text-app-canvas font-bold flex items-center justify-center shrink-0" translate="no">
              {initials(user.name)}
              {/* Status dot */}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-app-elevated" aria-label="Online" />
            </div>
            <div className="hidden sm:flex flex-col items-start min-w-0 max-w-[200px]">
              <span className="text-sm font-semibold text-sand-50 truncate w-full">{user.name}</span>
              <span className="text-[0.65rem] text-sand-100/55 truncate w-full">{user.email}</span>
            </div>
            <ChevronDown size={14} className={`text-sand-100/55 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {/* Dropdown */}
          {open && (
            <div
              ref={menuRef}
              role="menu"
              className="absolute right-0 mt-2 w-[280px] rounded-xl border hairline bg-app-elevated shadow-2xl overflow-hidden z-40"
              style={{ boxShadow: "0 20px 60px rgba(0,0,0,.55), 0 4px 12px rgba(0,0,0,.35)" }}
            >
              {/* Header com avatar + nome + email + status */}
              <div className="p-4 border-b hairline">
                <div className="flex items-center gap-3">
                  <div className="relative w-11 h-11 rounded-lg bg-gold-gradient text-app-canvas font-bold flex items-center justify-center shrink-0" translate="no">
                    {initials(user.name)}
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-app-elevated" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-sand-50 truncate">{user.name}</p>
                    <p className="text-xs text-sand-100/55 truncate">{user.email}</p>
                  </div>
                </div>
                {/* Status row */}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-sand-100/75">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" /> Status
                  </span>
                  <span className="text-sand-100/55">Online</span>
                </div>
              </div>

              {/* Menu items */}
              <nav className="py-1.5">
                <MenuItem icon={<UserIcon size={15} />} label="Perfil" onClick={go(perfilUrl)} />
                <MenuItem icon={<Settings size={15} />} label="Configurações" onClick={go(configUrl)} />
                <MenuItem
                  icon={<HelpCircle size={15} />}
                  label="Ajuda"
                  onClick={() => { setOpen(false); window.open(WA_AJUDA, "_blank", "noopener,noreferrer"); }}
                />
                <MenuItem
                  icon={<Bug size={15} className="text-red-400" />}
                  label="Reportar problema"
                  onClick={() => { setOpen(false); setReportOpen(true); }}
                />
              </nav>

              <div className="border-t hairline" />

              {/* Theme + Sair */}
              <nav className="py-1.5">
                <MenuItem
                  icon={theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                  label={theme === "dark" ? "Modo Claro" : "Modo Escuro"}
                  onClick={() => { toggleTheme(); /* keep open pra ver troca */ }}
                />
                <MenuItem
                  icon={<LogOut size={15} />}
                  label="Sair"
                  destructive
                  onClick={async () => { setOpen(false); await logout(); nav("/"); }}
                />
              </nav>
            </div>
          )}
        </div>
      </div>

      <ReportarProblemaModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}

function MenuItem({ icon, label, onClick, destructive }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => void onClick()}
      className={`w-full px-4 py-2.5 inline-flex items-center gap-3 text-sm text-left transition-colors ${
        destructive
          ? "text-red-300 hover:bg-red-500/10"
          : "text-sand-100/85 hover:bg-app-subtle/60 hover:text-sand-50"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
