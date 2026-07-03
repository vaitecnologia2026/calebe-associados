// =============================================================================
// Seed inicial · CRM Calebe Associados
// Cria 4 usuários oficiais + regras padrão + settings base
// =============================================================================
import { PrismaClient, Role, AssociateCategory } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();
const db = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "Calebe@2026!";

async function main(){
  console.log("🌱 Seeding · senha default:", DEFAULT_PASSWORD);

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  // ---- Usuários oficiais ----------------------------------------------------
  const users = [
    { email:"adm@calebe.com.br",        role:Role.ADMIN,     name:"Ricardo Calebe" },
    { email:"corretor@calebe.com.br",   role:Role.ASSOCIATE, name:"Juliano Martins" },
    { email:"juridico@calebe.com.br",   role:Role.LEGAL,     name:"Heloísa Drumond" },
    { email:"secretaria@calebe.com.br", role:Role.SECRETARY, name:"Aline Ribeiro" }
  ];

  for (const u of users){
    await db.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash },
      update: { name: u.name }  // não sobrescreve senha em re-seed
    });
  }

  // Associate perfil do corretor seed
  const julianoUser = await db.user.findUnique({ where: { email: "corretor@calebe.com.br" } });
  if (julianoUser){
    await db.associate.upsert({
      where: { userId: julianoUser.id },
      create: {
        userId: julianoUser.id,
        category: AssociateCategory.GOLD,
        segment: "Alto padrão",
        creci: "28541",
        creciUf: "SC",
        phone: "(47) 99412-6677",
        whatsapp: "(47) 99412-6677",
        bio: "Corretor especialista em alto padrão no litoral de SC."
      },
      update: {}
    });
  }

  // ---- Regras padrão de distribuição ----------------------------------------
  const regras = [
    { category: AssociateCategory.DIAMOND, dailyQuota: 5, percentage: 40, priority: 1 },
    { category: AssociateCategory.GOLD,    dailyQuota: 3, percentage: 30, priority: 2 },
    { category: AssociateCategory.SILVER,  dailyQuota: 2, percentage: 20, priority: 3 },
    { category: AssociateCategory.BRONZE,  dailyQuota: 1, percentage: 10, priority: 4 }
  ];
  for (const r of regras){
    await db.distributionRule.upsert({
      where: { category: r.category },
      create: r,
      update: { dailyQuota: r.dailyQuota, percentage: r.percentage, priority: r.priority }
    });
  }

  // ---- Settings base --------------------------------------------------------
  const settings = [
    { key: "inactivity.minutes",          value: 20 },
    { key: "inactivity.maxRedistributions", value: 3 },
    { key: "inactivity.active",           value: true },
    { key: "dashboard.tvRefreshSeconds",  value: 10 },
    { key: "notifications.juridicoPhone", value: "" },
    { key: "notifications.reservasPhone", value: "" },
    { key: "vai.instanceId",              value: "" },
    { key: "vai.senderPhone",             value: "" }
  ];
  for (const s of settings){
    await db.systemSetting.upsert({
      where: { key: s.key },
      create: s,
      update: {}   // não sobrescreve valores em re-seed
    });
  }

  console.log("✓ Usuários criados:", users.length);
  console.log("✓ Regras de distribuição:", regras.length);
  console.log("✓ Settings base:", settings.length);
  console.log("\n📝 Credenciais de acesso (primeiro login):");
  users.forEach(u => console.log(`   ${u.email.padEnd(30)} · ${DEFAULT_PASSWORD}`));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
