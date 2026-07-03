// Sidebar com SEÇÕES (Principal · Operação · Back-office) + responsividade
// Aceita NavSection[] OR NavItem[] (compat backwards)

import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

export interface SidebarItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: ReactNode;
  highlight?: boolean;
}

export interface SidebarSection {
  title?: string; // se ausente, renderiza items sem cabeçalho
  items: SidebarItem[];
}

interface Props {
  sections?: SidebarSection[];
  items?: SidebarItem[]; // fallback sem seções
  header?: ReactNode;
  footer?: ReactNode;
  onItemClick?: () => void; // fecha drawer mobile
}

export function Sidebar({ sections, items, header, footer, onItemClick }: Props) {
  const allSections: SidebarSection[] = sections ?? (items ? [{ items }] : []);

  return (
    <nav className="w-60 lg:w-64 shrink-0 bg-app-elevated/95 md:bg-app-elevated border-r hairline h-full flex flex-col overflow-hidden">
      {header && <div className="shrink-0">{header}</div>}

      <div className="flex-1 overflow-y-auto p-3">
        {allSections.map((section, idx) => (
          <div key={idx} className={idx > 0 ? "mt-4" : ""}>
            {section.title && (
              <p className="text-[0.6rem] uppercase tracking-mono-xwide font-medium text-sand-100/45 px-3 pt-2 pb-1.5">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.end}
                    onClick={onItemClick}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                        isActive
                          ? "bg-gold-400/10 text-gold-300 border-l-2 border-gold-400 -ml-0.5"
                          : it.highlight
                          ? "text-gold-300 hover:bg-gold-400/5"
                          : "text-sand-100/70 hover:bg-app-subtle/60 hover:text-sand-50"
                      }`
                    }
                  >
                    <it.icon size={16} className="shrink-0" />
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.badge}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {footer && <div className="shrink-0 border-t hairline">{footer}</div>}
    </nav>
  );
}
