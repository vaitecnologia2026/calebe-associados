// =============================================================================
// seed-apple-review.mjs
// -----------------------------------------------------------------------------
// Cria (ou atualiza, se já existir) a conta de revisão da Apple App Store.
// Idempotent: pode rodar 100x que sempre devolve o mesmo estado final.
//
// Como rodar (NO SERVIDOR de prod, dentro de /root/vaidavenda-calebe/backend/):
//   node seed-apple-review.mjs
//
// Como subir + rodar tudo numa linha (a partir do seu Mac):
//   scp /Users/bello/Documents/VAI/CALEBE/seed-apple-review.mjs \
//       root@187.77.251.196:/root/vaidavenda-calebe/backend/_ap.mjs && \
//   ssh root@187.77.251.196 \
//       'cd /root/vaidavenda-calebe/backend && node _ap.mjs && rm _ap.mjs'
// =============================================================================
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const EMAIL = "revisao.apple@calebe.com.br";
const PASS  = "AppleReview@2026";
const NAME  = "Apple Review";

try {
  // -- User --------------------------------------------------------------------
  const hash = await bcrypt.hash(PASS, 12);
  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: {
      passwordHash: hash,
      active: true,
      role: "ASSOCIATE",
      name: NAME,
    },
    create: {
      email: EMAIL,
      name: NAME,
      role: "ASSOCIATE",
      passwordHash: hash,
      active: true,
    },
  });

  // -- Associate (vínculo de corretor) ----------------------------------------
  // Sem @unique em userId no schema atual, então findFirst + create/update manual
  const existingAssoc = await db.associate.findFirst({ where: { userId: user.id } });
  const assoc = existingAssoc
    ? await db.associate.update({
        where: { id: existingAssoc.id },
        data: {
          status:   "APPROVED",
          category: "BRONZE",
          segment:  "Regional",
        },
      })
    : await db.associate.create({
        data: {
          userId:   user.id,
          status:   "APPROVED",
          category: "BRONZE",
          segment:  "Regional",
          phone:    "+5547999999999",
          whatsapp: "+5547999999999",
        },
      });

  console.log("------------------------------------------------------------");
  console.log("OK · conta de revisão Apple pronta");
  console.log("------------------------------------------------------------");
  console.log("URL    : https://app.calebe.tech");
  console.log("Email  :", EMAIL);
  console.log("Senha  :", PASS);
  console.log("Role   :", user.role, "· status:", assoc.status, "· categoria:", assoc.category);
  console.log("------------------------------------------------------------");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
