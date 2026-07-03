import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { sseToAdmins } from "../services/sseHub.js";
import { sendPushToRole } from "../services/push.js";

const r = Router();

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
// Documentos jurídicos de vendas ficam em pasta dedicada — separado de mídias/docs de imóveis.
// Estrutura: <root>/Documentos Juridicos/<saleId>/<arquivo>
const SALE_DOCS_DIR = path.join(PROJECT_ROOT, "Documentos Juridicos");
try { fs.mkdirSync(SALE_DOCS_DIR, { recursive: true }); } catch {}

const saleUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(SALE_DOCS_DIR, req.params.id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || "").replace(/[^\w.\- ]/g, "_").replace(/\s+/g, "_").slice(0, 120);
      cb(null, `${randomUUID()}-${safe}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

r.get("/", requireAuth, async (req, res, next) => {
  try {
    let where = {};
    if (req.user.role === "ASSOCIATE"){
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      where = { associateId: a?.id };
    }
    if (req.query.status) where.status = req.query.status;
    const data = await db.sale.findMany({ where, take: 200, orderBy: { createdAt: "desc" }, include: { property: { select: { code:true, title:true } }, associate: { select: { user: { select: { name:true } } } } } });
    res.json({ data });
  } catch (e){ next(e); }
});

r.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const s = await db.sale.findUnique({ where: { id: req.params.id }, include: { property: true, documents: true, associate: { include: { user: true } } } });
    if (!s) return res.status(404).json({ error: "not_found" });
    // Permissão: ADMIN/LEGAL veem tudo; ASSOCIATE só as próprias
    if (!["ADMIN","LEGAL"].includes(req.user.role)){
      const mine = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (s.associateId !== mine?.id) return res.status(403).json({ error: "forbidden" });
    }
    // Descriptografa clientData para retorno (campo encriptado removido da resposta)
    const { clientDataEncrypted, ...safe } = s;
    let clientData = {};
    if (clientDataEncrypted){
      try { clientData = JSON.parse(decrypt(clientDataEncrypted) || "{}"); } catch {}
    }
    res.json({ ...safe, clientData });
  } catch (e){ next(e); }
});

const saleSchema = z.object({
  propertyId: z.string().cuid(),
  clientName: z.string().min(2),
  clientData: z.object({
    cpf:           z.string().optional(),
    rg:            z.string().optional(),
    email:         z.string().email().optional().or(z.literal("")),
    phone:         z.string().optional(),
    address:       z.string().optional(),
    neighborhood:  z.string().optional(),
    city:          z.string().optional(),
    state:         z.string().optional(),
    zip:           z.string().optional(),
    birthDate:     z.string().optional(),
    maritalStatus: z.string().optional(),
    profession:    z.string().optional(),
    nationality:   z.string().optional(),
    spouse:        z.string().optional()
  }).passthrough(),
  finalValue: z.union([z.number(), z.string()]),
  paymentConditions: z.string().optional()
});

r.post("/", requireAuth, requireRole("ASSOCIATE","ADMIN"), async (req, res, next) => {
  try {
    const data = saleSchema.parse(req.body);
    const associate = req.user.role === "ASSOCIATE"
      ? await db.associate.findUnique({ where: { userId: req.user.id } })
      : await db.associate.findFirst();  // admin precisa passar associateId em body em produção
    if (!associate) return res.status(400).json({ error: "associate_required" });
    const sale = await db.sale.create({
      data: {
        associateId: associate.id,
        propertyId: data.propertyId,
        clientName: data.clientName,
        clientDataEncrypted: encrypt(JSON.stringify(data.clientData)),
        finalValue: data.finalValue,
        paymentConditions: data.paymentConditions,
        status: "DRAFT"
      },
      include: { associate: { select: { user: { select: { name: true } } } } }
    });
    // 2026-05-12 · SSE pra TV ao vivo · confetes quando entra venda
    try {
      sseToAdmins("sale.created", {
        id: sale.id, code: sale.code, finalValue: sale.finalValue,
        clientName: sale.clientName, associateName: sale.associate?.user?.name,
        at: new Date().toISOString()
      });
    } catch {}
    res.status(201).json({ id: sale.id, code: sale.code, status: sale.status });
  } catch (e){ next(e); }
});

r.post("/:id/submit", requireAuth, async (req, res, next) => {
  try {
    const sale = await db.sale.update({
      where: { id: req.params.id },
      data: { status: "SUBMITTED", submittedAt: new Date() }
    });
    await audit({ req, action: "SALE_SUBMITTED", entity: `Sale:${sale.id}` });
    // Push pra todos os admins (jurídico): nova venda submetida pra análise.
    sendPushToRole("ADMIN", {
      eventKey: "sale.submitted",
      kind: "sale_submitted",
      title: "📋 Nova venda pra análise",
      body: `Venda ${sale.code || sale.id.slice(0, 8)} aguardando jurídico`,
      url: `/?screen=adm-juridico&sale=${sale.id}`,
      tag: `sale-${sale.id}`,
    }).catch(()=>{});
    res.json({ id: sale.id, status: sale.status });
  } catch (e){ next(e); }
});

r.post("/:id/documents", requireAuth, async (req, res, next) => {
  try {
    const { docType, fileKey } = z.object({ docType: z.string(), fileKey: z.string() }).parse(req.body);
    const d = await db.saleDocument.create({ data: { saleId: req.params.id, docType, fileKey } });
    res.status(201).json(d);
  } catch (e){ next(e); }
});

// Upload em disco de documentos da venda (Documentos/vendas/<saleId>/)
r.post("/:id/upload/documento", requireAuth, async (req, res, next) => {
  try {
    // Verifica se a venda existe e se o usuário tem permissão ANTES de processar o upload
    const sale = await db.sale.findUnique({ where: { id: req.params.id }, select: { id: true, associateId: true } });
    if (!sale) return res.status(404).json({ error: "sale_not_found" });
    if (!["ADMIN","LEGAL"].includes(req.user.role)){
      const mine = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (sale.associateId !== mine?.id) return res.status(403).json({ error: "forbidden" });
    }
  } catch (e){ return next(e); }

  saleUpload.array("files", 20)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "upload_failed", message: err.message });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no_files" });
    try {
      const out = [];
      for (const f of files){
        const url = `/documentos-juridicos/${req.params.id}/${f.filename}`;
        const docType = (f.originalname.split(".").pop() || "doc").toLowerCase();
        const created = await db.saleDocument.create({ data: { saleId: req.params.id, docType, fileKey: url } }).catch((e) => { console.warn("saleDocument create failed:", e.message); return null; });
        out.push({ id: created?.id, filename: f.filename, url, mimetype: f.mimetype, size: f.size });
      }
      res.status(201).json({ uploaded: out.length, files: out });
    } catch (e){ next(e); }
  });
});

// Migração passiva · move arquivos de Documentos/vendas/<saleId>/ (estrutura antiga)
// para Documentos Juridicos/<saleId>/ na primeira subida após deploy. Atualiza também
// os fileKey no banco pra apontar pra nova URL.
(async function migrateLegacy(){
  try {
    const legacy = path.join(PROJECT_ROOT, "Documentos", "vendas");
    if (fs.existsSync(legacy)){
      for (const saleId of fs.readdirSync(legacy)){
        const src = path.join(legacy, saleId);
        let stat; try { stat = fs.statSync(src); } catch { continue; }
        if (!stat.isDirectory()) continue;
        const dst = path.join(SALE_DOCS_DIR, saleId);
        try { fs.mkdirSync(dst, { recursive: true }); } catch {}
        for (const file of fs.readdirSync(src)){
          const dstFile = path.join(dst, file);
          if (fs.existsSync(dstFile)) continue;
          try { fs.renameSync(path.join(src, file), dstFile); } catch {}
        }
      }
    }
    // Atualiza fileKey no DB: /documentos/vendas/... → /documentos-juridicos/...
    const legacyDocs = await db.saleDocument.findMany({
      where: { fileKey: { startsWith: "/documentos/vendas/" } },
      select: { id: true, fileKey: true }
    }).catch(() => []);
    for (const d of legacyDocs){
      const newKey = d.fileKey.replace("/documentos/vendas/", "/documentos-juridicos/");
      await db.saleDocument.update({ where: { id: d.id }, data: { fileKey: newKey } }).catch(()=>{});
    }
  } catch {}
})();

r.get("/:id/documentos", requireAuth, async (req, res, next) => {
  try {
    const dir = path.join(SALE_DOCS_DIR, req.params.id);
    if (!fs.existsSync(dir)) return res.json({ data: [] });
    const files = fs.readdirSync(dir)
      .filter(n => fs.statSync(path.join(dir, n)).isFile())
      .map(n => {
        const st = fs.statSync(path.join(dir, n));
        return { filename: n, url: `/documentos-juridicos/${req.params.id}/${n}`, size: st.size, createdAt: st.birthtime };
      });
    res.json({ data: files });
  } catch (e){ next(e); }
});

export default r;
