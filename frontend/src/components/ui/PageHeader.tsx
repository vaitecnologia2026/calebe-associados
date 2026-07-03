import type { ReactNode } from "react";

interface Props {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow = "Administração", title, description, actions }: Props) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
      <div>
        {eyebrow && <p className="meta-gold">{eyebrow}</p>}
        <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight mt-1">{title}</h1>
        {description && <p className="text-sm text-sand-100/65 mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}
