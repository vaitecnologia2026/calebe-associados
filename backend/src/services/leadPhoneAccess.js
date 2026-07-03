// Allowlist (por User.id) de quem pode ver o TELEFONE real do lead além do ADMIN.
// Configurável via env LEADS_PHONE_ALLOWLIST (ids separados por vírgula), lida no boot.
// Pedido 2026-06-07: liberar contato pros corretores Carlos Eduardo Cidral e Eduardo
// Cidral sem torná-los admin (continuam ASSOCIATE, veem só os leads atribuídos a eles).
const ALLOW = new Set(
  (process.env.LEADS_PHONE_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean)
);
export function phoneAllowed(userId){ return !!userId && ALLOW.has(userId); }

// canViewPhone · REGRA CENTRAL 2026-06-29
// Apenas CORRETOR (ASSOCIATE) tem restrição. Qualquer outro perfil vê telefone completo.
// Exceção explícita: IDs na LEADS_PHONE_ALLOWLIST (corretores com liberação individual).
export function canViewPhone(user){
  if (!user) return false;
  if (user.role !== "ASSOCIATE") return true;  // ADMIN, DEV e quaisquer outros perfis
  return phoneAllowed(user.id);               // exceção por allowlist individual
}
