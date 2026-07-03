import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
}

const sizeClass = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" };

export function Modal({ open, onClose, title, children, size = "md", closeOnBackdrop = true }: Props) {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`card w-full ${sizeClass[size]} my-4 md:my-8 p-4 md:p-6 relative max-h-[calc(100dvh-2rem)] md:max-h-[calc(100dvh-4rem)] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-xl font-bold tracking-[-0.02em]">{title}</h2>
            <button onClick={onClose} className="text-sand-100/55 hover:text-sand-50" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
        )}
        {!title && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-sand-100/55 hover:text-sand-50"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
