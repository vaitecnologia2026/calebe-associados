// Portado do ROLE_MAP do index.html monolítico (linha 9191-9196)

export type BackendRole = "ADMIN" | "ASSOCIATE" | "LEGAL" | "SECRETARY" | "DEV";
export type Persona = "admin" | "corretor" | "colab" | "dev";
export type UiRole = "admin" | "corretor" | "juridico" | "secretaria" | "dev";

export interface User {
  id: string;
  name: string;
  email: string;
  role: BackendRole;
  commercialSupportAccess?: boolean; // 2026-06-16 · acesso ao módulo Ajuda Comercial
  commercialOnly?: boolean; // 2026-06-18 · trava: só vê a tela Ajuda Comercial
  associate?: {
    id: string;
    phone?: string;
    whatsapp?: string;
    bio?: string;
    photoUrl?: string;
    creci?: string;
    creciUf?: string;
    segment?: string;
    category?: "BRONZE" | "SILVER" | "GOLD" | "DIAMOND";
    phoneAlertActive?: boolean;
    cpf?: string;
    rg?: string;
    address?: string;
    bankData?: string;
    pixKey?: string;
  };
}

export interface AuthResponse {
  accessToken: string;
  // 2026-06-25 · refreshToken também devolvido no body como fallback ao cookie
  // httpOnly `rt`. Frontend guarda em localStorage e manda no body se o cookie
  // for dropado (Safari ITP, WKWebView, modo privado, PWA standalone).
  refreshToken?: string;
  user: User;
}

export interface RoleMapEntry {
  role: UiRole;
  label: string;
  persona: Persona;
}

export const ROLE_MAP: Record<BackendRole, RoleMapEntry> = {
  ADMIN:     { role: "admin",      label: "Administração", persona: "admin" },
  ASSOCIATE: { role: "corretor",   label: "Corretor",      persona: "corretor" },
  LEGAL:     { role: "juridico",   label: "Jurídico",      persona: "admin" },
  SECRETARY: { role: "secretaria", label: "Secretaria",    persona: "colab" },
  DEV:       { role: "dev",        label: "Dev",           persona: "dev" },
};
