// Drawer mobile com backdrop · usado em md:hidden
// Slide-in da esquerda · fecha por ESC e clique no backdrop
import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export function MobileDrawer({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 bg-navy-950/70 backdrop-blur-sm z-40 transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer · largura casa com a sidebar (w-60) pra evitar borda dupla.
          Borda direita vem do <Sidebar> que está dentro · drawer não tem border-r próprio. */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-dvh w-60 z-50 bg-app-elevated shadow-xl transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="h-full flex flex-col overflow-hidden">
          {children}
        </div>
      </aside>
    </>
  );
}
