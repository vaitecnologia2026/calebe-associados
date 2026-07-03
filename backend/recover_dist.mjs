import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const PER = 10;
const hoje = new Date(); hoje.setHours(0,0,0,0);
const DISTRIB = `"assignedToId" IS NULL AND status='NEW' AND "noWhatsApp"=false AND "phoneEncrypted" IS NOT NULL`;

// 1) recupera QUENTES (descartados distribuíveis que já responderam)
const warm = await db.$executeRawUnsafe(`
  UPDATE "Lead" SET "discardedAt"=NULL, "discardReason"=NULL, "updatedAt"=NOW()
  WHERE ${DISTRIB} AND "discardedAt" IS NOT NULL
    AND id IN (SELECT c."leadId" FROM "Conversation" c WHERE c."lastInboundAt" IS NOT NULL)
`);
console.log(`✅ recuperados QUENTES (responderam): ${warm}`);

// 2) recupera FRIOS da limpeza_meta (até 740, os que ainda estão descartados após passo 1)
const cold = await db.$executeRawUnsafe(`
  WITH c AS (
    SELECT id FROM "Lead"
    WHERE ${DISTRIB} AND "discardedAt" IS NOT NULL AND "discardReason"='limpeza_meta_2026-06-18'
    ORDER BY "createdAt" DESC LIMIT 740
  )
  UPDATE "Lead" l SET "discardedAt"=NULL, "discardReason"=NULL, "updatedAt"=NOW()
  FROM c WHERE l.id=c.id
`);
console.log(`✅ recuperados FRIOS (limpeza_meta): ${cold}`);

const pool = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Lead" WHERE ${DISTRIB} AND "discardedAt" IS NULL`);
console.log(`Pool distribuível agora: ${pool[0].n}`);

// 3) distribui 10 pra cada corretor ativo HOJE (neediest primeiro), priorizando lead QUENTE
const corr = await db.$queryRawUnsafe(`
  SELECT a.id, u.name,
    (SELECT COUNT(*)::int FROM "Lead" l WHERE l."assignedToId"=a.id AND l."discardedAt" IS NULL
       AND l."noWhatsApp"=false AND l.status IN ('NEW','QUALIFYING','NEGOTIATING')) AS ativos
  FROM "Associate" a JOIN "User" u ON u.id=a."userId"
  WHERE a.status='APPROVED' AND a."lastActiveAt" >= $1
  ORDER BY ativos ASC, a."lastActiveAt" DESC
`, hoje);

let total=0, cheios=0, parciais=0, zero=0;
for (const c of corr) {
  const claimed = await db.$queryRawUnsafe(`
    WITH picked AS (
      SELECT l.id FROM "Lead" l
      LEFT JOIN LATERAL (SELECT 1 FROM "Conversation" cc WHERE cc."leadId"=l.id AND cc."lastInboundAt" IS NOT NULL LIMIT 1) q ON true
      WHERE ${DISTRIB.replace(/"assignedToId"/,'l."assignedToId"').replace('status=','l.status=').replace(/"noWhatsApp"/,'l."noWhatsApp"').replace(/"phoneEncrypted"/,'l."phoneEncrypted"')} AND l."discardedAt" IS NULL
      ORDER BY (q IS NOT NULL) DESC, l."createdAt" DESC
      LIMIT $2 FOR UPDATE SKIP LOCKED
    )
    UPDATE "Lead" l SET "assignedToId"=$1, "assignedAt"=NOW(), "updatedAt"=NOW()
    FROM picked p WHERE l.id=p.id RETURNING l.id
  `, c.id, PER);
  for (const lead of claimed) {
    const conv = await db.conversation.findFirst({ where: { leadId: lead.id } });
    if (!conv) await db.conversation.create({ data: { leadId: lead.id, associateId: c.id } });
    else if (conv.associateId !== c.id) await db.conversation.update({ where: { id: conv.id }, data: { associateId: c.id } });
  }
  total += claimed.length;
  if (claimed.length===PER) cheios++; else if (claimed.length>0) parciais++; else zero++;
}
console.log(`\n=== DISTRIBUIÇÃO ===`);
console.log(`Corretores ativos hoje: ${corr.length}`);
console.log(`Total atribuído nesta rodada: ${total} | com 10: ${cheios} | parciais: ${parciais} | sem nada: ${zero}`);
await db.$disconnect();
