import "dotenv/config";
import fs from "node:fs";
import { db } from "./src/db.js";
import { decrypt } from "./src/crypto.js";
const csvField = (v) => '"' + String(v ?? "").replace(/"/g,'""') + '"';
const fmtDate = (d) => d ? new Date(d).toISOString().slice(0,16).replace("T"," ") : "";
const rows = await db.$queryRawUnsafe(`
  SELECT l.id, l.name, l."phoneEncrypted" enc, l."phoneMasked" masked, l.status::text status, l.origin::text origem,
         l."createdAt" criado, l."assignedAt" distribuido, u.name corretor,
         NOT EXISTS (SELECT 1 FROM "Conversation" c JOIN "Message" m ON m."conversationId"=c.id
                     WHERE c."leadId"=l.id AND m.direction='outbound') AS zero_envio
  FROM "Lead" l
  LEFT JOIN "Associate" a ON a.id=l."assignedToId"
  LEFT JOIN "User" u ON u.id=a."userId"
  WHERE l."assignedToId" IS NOT NULL AND l."firstContactAt" IS NULL
  ORDER BY u.name NULLS LAST, l."assignedAt"`);
const head=["Nome","Telefone","Corretor","Status","Origem","Criado","Distribuido","NuncaEnviouNada"];
const lines=["﻿"+head.join(";")]; let ok=0;
for (const r of rows){ let p=""; try{p=decrypt(r.enc)||"";}catch{} if(p)ok++; else p=r.masked||"";
  lines.push([r.name,p,r.corretor,r.status,r.origem,fmtDate(r.criado),fmtDate(r.distribuido), r.zero_envio?"SIM":"nao"].map(csvField).join(";")); }
fs.writeFileSync("/root/leads-export/leads_distribuidos_nunca_chamados.csv", lines.join("\n"));
console.log(`distribuidos_nunca_chamados.csv: ${rows.length} linhas · tel decifrado=${ok}`);
await db.$disconnect();
