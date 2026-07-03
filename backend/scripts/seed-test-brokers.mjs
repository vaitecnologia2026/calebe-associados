// =============================================================================
// Seed de ambiente · limpa leads de importação + cria 50 corretores teste
// Executar no servidor: cd /root/vaidavenda-calebe/backend && node scripts/seed-test-brokers.mjs
// IDEMPOTENTE: se algum email já existir, pula sem recriar.
// =============================================================================
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const SEGMENTS = ["Alto padrão", "Investidor", "Lançamentos", "Regional"];
// Mix proporcional 40/30/20/10 (mix padrão do sistema) para 50 corretores
const CATEGORY_PLAN = [
  ...Array(20).fill("DIAMOND"),   // 40%
  ...Array(15).fill("GOLD"),      // 30%
  ...Array(10).fill("SILVER"),    // 20%
  ...Array(5).fill("BRONZE")      // 10%
];
const TEST_PASSWORD = "Teste@2026";

async function main(){
  console.log("\n════════════════════════════════════════");
  console.log("  Calebe · Seed Ambiente de Teste");
  console.log("════════════════════════════════════════\n");

  // ------- 1) LIMPEZA -------
  console.log("▶ 1/3 · Limpando leads importados");
  const before = await db.lead.count({ where: { origin: "IMPORT" } });
  const delLeads = await db.lead.deleteMany({ where: { origin: "IMPORT" } });
  console.log(`  · ${delLeads.count}/${before} leads IMPORT deletados`);
  console.log("  · (cascata automática em Conversation, DistributionEntry, RedistributionLog)");

  const delImports = await db.leadImport.deleteMany({});
  console.log(`  · ${delImports.count} registros LeadImport removidos do histórico`);

  // ------- 2) CRIAÇÃO DOS CORRETORES -------
  console.log("\n▶ 2/3 · Criando 50 corretores teste");
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  let created = 0, skipped = 0;
  const porCat = { DIAMOND:0, GOLD:0, SILVER:0, BRONZE:0 };
  const porSeg = { "Alto padrão":0, "Investidor":0, "Lançamentos":0, "Regional":0 };

  for (let i = 1; i <= 50; i++){
    const num = String(i).padStart(2, "0");
    const email = `corretor-teste-${num}@calebe.com.br`;
    const exists = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (exists){ skipped++; console.log(`  · ${email} já existe — pulado`); continue; }

    const category = CATEGORY_PLAN[i - 1];
    const segment = SEGMENTS[Math.floor(Math.random() * SEGMENTS.length)];
    const phone = `(47) 99000-${String(i).padStart(4, "0")}`;

    await db.user.create({
      data: {
        email,
        passwordHash,
        role: "ASSOCIATE",
        name: `Corretor Teste ${num}`,
        active: true,
        associate: {
          create: {
            category,
            segment,
            status: "APPROVED",
            creci: `TEST-${num}`,
            creciUf: "SC",
            phone,
            whatsapp: phone,
            approvedAt: new Date()
          }
        }
      }
    });
    porCat[category]++;
    porSeg[segment]++;
    created++;
  }
  console.log(`  · ${created} criados · ${skipped} pulados (já existiam)`);

  // ------- 3) RESUMO -------
  console.log("\n▶ 3/3 · Resumo do ambiente\n");
  const totalAssoc = await db.associate.count({ where: { status: "APPROVED" } });
  const totalLeads = await db.lead.count();
  const totalEntries = await db.distributionEntry.count({ where: { state: { in: ["PENDING","SCHEDULED"] } } });
  console.log(`  Corretores APPROVED (total no sistema):  ${totalAssoc}`);
  console.log(`    · criados agora por categoria:`);
  for (const [cat, n] of Object.entries(porCat)) console.log(`        ${cat}: ${n}`);
  console.log(`    · criados agora por segmento:`);
  for (const [seg, n] of Object.entries(porSeg)) console.log(`        ${seg}: ${n}`);
  console.log(`  Leads restantes:                         ${totalLeads}`);
  console.log(`  DistributionEntry pendentes/agendados:   ${totalEntries}`);
  console.log(`\n  Login teste: corretor-teste-01@calebe.com.br … -50 · senha: ${TEST_PASSWORD}`);
  console.log("\n════════════════════════════════════════\n");

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("ERRO:", err);
  await db.$disconnect();
  process.exit(1);
});
