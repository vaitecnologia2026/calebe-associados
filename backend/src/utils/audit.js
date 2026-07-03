// Helper para gravar AuditEvent · nunca lança (se falhar, loga e segue).
import { db } from "../db.js";

export async function audit({ req, userId, action, entity, metadata }){
  try {
    await db.auditEvent.create({
      data: {
        userId: userId ?? req?.user?.id ?? null,
        actorEmail: req?.user?.email ?? null,
        action,
        entity: entity || "-",
        metadata: metadata ?? {},
        ipAddress: req?.ip?.toString().slice(0, 64),
        userAgent: req?.headers?.["user-agent"]?.slice(0, 512)
      }
    });
  } catch (e){
    // Não bloqueia o request · apenas log
    console.error("[audit] falha ao registrar:", e.message);
  }
}
