import { db } from "../src/db.js";
import { enqueueLead, distributeExtra } from "../src/services/distributionEngine.js";

async function main(){
  console.log("→ Identificando leads em corretores inelegiveis...");
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);

  const semLogin = await db.lead.findMany({
    where: { assignedToId: { not: null }, assignedTo: { user: { lastLoginAt: null } } },
    select: { id: true, name: true, status: true, assignedToId: true }
  });
  const semOutbound = await db.$queryRaw`
    SELECT l.id, l.name, l.status::text AS status, l."assignedToId"
    FROM "Lead" l JOIN "Associate" a ON l."assignedToId" = a.id JOIN "User" u ON a."userId" = u.id
    WHERE u."lastLoginAt" IS NOT NULL AND a."approvedAt" < ${sevenDaysAgo}
      AND NOT EXISTS (SELECT 1 FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c.id WHERE c."associateId" = a.id AND m.direction='outbound' AND m."fromRole"='associate')
  `;
  const todos = [...semLogin, ...semOutbound];
  console.log(`  ${semLogin.length} sem login, ${semOutbound.length} sem outbound · total ${todos.length}`);
  if (!todos.length){ console.log("Nada a fazer."); process.exit(0); }

  console.log("→ Devolvendo a fila (delete antigo entry + clear assign + enqueue)...");
  let liberados = 0;
  for (const l of todos){
    try {
      await db.$transaction([
        db.distributionEntry.deleteMany({ where: { leadId: l.id } }),
        db.lead.update({ where: { id: l.id }, data: {
          assignedToId: null, assignedAt: null, firstContactAt: null,
          status: "NEW", redistributionCount: { increment: 1 }
        }})
      ]);
      await enqueueLead(l.id);
      liberados++;
    } catch (e){
      console.log(`  ⚠ falha em ${l.name}: ${e.message.slice(0,100)}`);
    }
  }
  console.log(`  ✓ ${liberados} devolvidos à fila`);

  console.log("→ Forcando distribuicao agora...");
  try {
    const r = await distributeExtra({ count: liberados });
    console.log(`  ✓ ${r.distributed} distribuidos`);
    if (Array.isArray(r.details)){
      for (const d of r.details.slice(0, 20)){
        console.log(`    → ${d.leadName || d.leadId} → ${d.associateName || d.associateId}`);
      }
    }
  } catch (e){
    console.log(`  ❌ falhou: ${e.message}`);
  }
  process.exit(0);
}
main().catch(e => { console.error("erro fatal:", e); process.exit(1); });
