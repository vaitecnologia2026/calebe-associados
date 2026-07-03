import "dotenv/config";
import { db } from "./src/db.js";
import { enqueueLead } from "./src/services/distributionEngine.js";

const LIMIT = Number(process.argv[2] || 0); // 0 = todos
const WHERE = `l."assignedToId" IS NOT NULL AND COALESCE(l."noWhatsApp",false)=false
  AND EXISTS (SELECT 1 FROM "Conversation" c WHERE c."leadId"=l.id
    AND (c."lastInboundAt" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId"=c.id AND m."messageStatus" IN ('delivered','read'))))`;

const sql = `SELECT l.id FROM "Lead" l WHERE ${WHERE} ORDER BY l."assignedAt" ${LIMIT ? "LIMIT " + LIMIT : ""}`;
const ids = (await db.$queryRawUnsafe(sql)).map(r => r.id);
console.log(`Reciclando ${ids.length} leads (LIMIT=${LIMIT || "todos"})`);
let done = 0, enq = 0;
for (const id of ids){
  await db.lead.update({ where: { id }, data: {
    assignedToId: null, assignedAt: null, firstContactAt: null,
    status: "NEW", redistributionCount: 0, lastRedistributionAt: null
  }});
  const d = await enqueueLead(id);
  if (d) enq++;
  if (++done % 200 === 0) console.log(`  ${done}/${ids.length} (enfileirados ${enq})`);
}
console.log(`PRONTO · reset=${done} · enfileirados=${enq}`);
await db.$disconnect();
