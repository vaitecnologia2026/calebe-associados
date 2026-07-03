import { db } from "../src/db.js";
import { enqueueLead, distributeExtra } from "../src/services/distributionEngine.js";

async function main(){
  console.log("→ Identificando DistributionEntries zumbis...");
  // Zumbi: entry state=DISTRIBUTED mas lead.assignedToId é null
  const zombies = await db.$queryRaw`
    SELECT de.id AS entry_id, de."leadId", l.name, l.status::text AS lead_status
    FROM "DistributionEntry" de
    JOIN "Lead" l ON l.id = de."leadId"
    WHERE de.state='DISTRIBUTED' AND l."assignedToId" IS NULL
  `;
  console.log(`  ${zombies.length} entries zumbis encontradas`);
  if (!zombies.length){ console.log("Nada a fazer."); process.exit(0); }

  console.log("→ Limpando entries antigas + reenqueueando...");
  let liberados = 0;
  for (const z of zombies){
    try {
      await db.distributionEntry.delete({ where: { id: z.entry_id } });
      // Garante lead status=NEW (segurança)
      await db.lead.update({
        where: { id: z.leadId },
        data: { status: "NEW", assignedToId: null, assignedAt: null, firstContactAt: null }
      });
      await enqueueLead(z.leadId);
      liberados++;
    } catch (e){
      console.log(`  ⚠ falha em ${z.name}: ${e.message.slice(0,120)}`);
    }
  }
  console.log(`  ✓ ${liberados} liberados`);

  console.log("→ Distribuindo agora...");
  try {
    const r = await distributeExtra({ count: liberados });
    console.log(`  ✓ ${r.distributed} distribuídos`);
    if (Array.isArray(r.details) && r.details.length){
      // agrupa por corretor para imprimir resumo
      const byBroker = new Map();
      for (const d of r.details){
        const k = d.associateName || d.associateId || "?";
        byBroker.set(k, (byBroker.get(k) || 0) + 1);
      }
      console.log("  Distribuição por corretor:");
      for (const [name, n] of [...byBroker.entries()].sort((a,b) => b[1]-a[1]).slice(0, 15)){
        console.log(`    → ${name}: ${n} leads`);
      }
    }
  } catch (e){ console.log(`  ❌ ${e.message}`); }

  // estado final
  const semOwner = await db.lead.count({ where: { assignedToId: null, status: "NEW" } });
  const zumbisRestantes = await db.$queryRaw`SELECT count(*)::int AS n FROM "DistributionEntry" de JOIN "Lead" l ON l.id = de."leadId" WHERE de.state='DISTRIBUTED' AND l."assignedToId" IS NULL`;
  console.log(`\n→ Estado final: ${semOwner} leads NEW na fila · ${zumbisRestantes[0].n} entries zumbis restantes`);
  process.exit(0);
}
main().catch(e => { console.error("fatal:", e); process.exit(1); });
