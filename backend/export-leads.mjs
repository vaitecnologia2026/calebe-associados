import "dotenv/config";
import fs from "node:fs";
import { db } from "./src/db.js";
import { decrypt } from "./src/crypto.js";

const PERLEAD = `
  WITH perlead AS (
    SELECT c."leadId",
           bool_or(c."lastInboundAt" IS NOT NULL) AS respondeu,
           bool_or(EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId"=c.id AND m."messageStatus" IN ('delivered','read'))) AS entregou,
           max(c."lastInboundAt") AS last_in
    FROM "Conversation" c GROUP BY c."leadId"
  )`;

const csvField = (v) => '"' + String(v ?? "").replace(/"/g,'""') + '"';
const fmtDate = (d) => d ? new Date(d).toISOString().slice(0,16).replace("T"," ") : "";

async function exportSeg(file, whereClause){
  const rows = await db.$queryRawUnsafe(`
    ${PERLEAD}
    SELECT l.id, l.name, l."phoneEncrypted" AS enc, l."phoneMasked" AS masked,
           l.status::text AS status, l.origin::text AS origem,
           l."createdAt" AS criado, l."assignedAt" AS distribuido, p.last_in AS ultresp,
           u.name AS corretor
    FROM perlead p
    JOIN "Lead" l ON l.id = p."leadId"
    LEFT JOIN "Associate" a ON a.id = l."assignedToId"
    LEFT JOIN "User" u ON u.id = a."userId"
    WHERE ${whereClause}
    ORDER BY u.name NULLS LAST, l."assignedAt"`);
  const head = ["Nome","Telefone","Corretor","Status","Origem","Criado","Distribuido","UltimaResposta"];
  const lines = ["﻿" + head.join(";")];
  let ok=0, fail=0;
  for (const r of rows){
    let phone = "";
    try { phone = decrypt(r.enc) || ""; } catch { phone = ""; }
    if (phone) ok++; else { fail++; phone = r.masked || ""; }
    lines.push([r.name, phone, r.corretor, r.status, r.origem, fmtDate(r.criado), fmtDate(r.distribuido), fmtDate(r.ultresp)].map(csvField).join(";"));
  }
  fs.writeFileSync(file, lines.join("\n"));
  console.log(`${file}: ${rows.length} linhas · tel decifrado=${ok} · fallback mascarado=${fail}`);
}

await exportSeg("/root/leads-export/leads_responderam_3103.csv", "p.respondeu");
await exportSeg("/root/leads-export/leads_entregou_calado_7197.csv", "(p.entregou AND NOT p.respondeu)");
await db.$disconnect();
