// Route guards · checa autenticação + persona/role
// Substitui as classes CSS role-* do monólito (linhas 1195-1221)

import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/store/auth";
import type { BackendRole, Persona } from "@/types/auth";

interface RequireAuthProps {
  children: ReactNode;
  persona?: Persona | Persona[];
  role?: BackendRole | BackendRole[];
}

export function RequireAuth({ children, persona, role }: RequireAuthProps) {
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const roleEntry = useAuth((s) => s.roleEntry);
  const bootStatus = useAuth((s) => s.bootStatus);

  if (bootStatus === "restoring" || bootStatus === "idle") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sand-100/55">
        Carregando…
      </div>
    );
  }

  if (!user || !roleEntry) {
    return <Navigate to="/" state={{ from: location, requestLogin: true }} replace />;
  }

  if (persona) {
    const allowed = Array.isArray(persona) ? persona : [persona];
    if (!allowed.includes(roleEntry.persona)) {
      return <Navigate to={defaultPathFor(roleEntry.persona)} replace />;
    }
  }

  if (role) {
    const allowed = Array.isArray(role) ? role : [role];
    if (!allowed.includes(user.role)) {
      return <Navigate to={defaultPathFor(roleEntry.persona)} replace />;
    }
  }

  return <>{children}</>;
}

export function defaultPathFor(persona: Persona | null | undefined): string {
  switch (persona) {
    case "admin": return "/admin";
    case "corretor": return "/corretor";
    case "colab": return "/colab";
    case "dev": return "/dev";
    default: return "/";
  }
}
