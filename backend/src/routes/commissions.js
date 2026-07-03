import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { backfillMissingCommissions } from "../services/commissionService.js";
import { sendPushToUser } from "../services/push.js";

const r = Router();

// =============================================================================
// Upload de comprovante de pagamento: <root>/Pagamentos Comissoes/<commId>/<uuid>-<arquivo>
// URL público: /pagamentos-comissoes/<commId>/<uuid>-<arquivo>
// =============================================================================
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const COMISSOES_DIR = path.join(PROJECT_ROOT, "Pagamentos Comissoes");
try { fs.mkdirSync(COMISSOES_DIR, { recursive: true }); } catch {}

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(COMISSOES_DIR, req.params.id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || "").replace(/[^\w.\- ]/g, "_").replace(/\s+/g, "_").slice(0, 120);
      cb(null, `${randomUUID()}-${safe}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(application\/pdf|image\/)/.test(file.mimetype || "");
    cb(ok ? null : new Error("Formato não aceito · apenas PDF ou imagem"), ok);
  }
});

// Encode/decode do URL do comprovante dentro do campo `notes` (evita migration)
// Formato: "__RECEIPT__=<url>\n<notas reais>"
const RECEIPT_PREFIX = "__RECEIPT__=";
function splitNotes(notes){
  if (!notes) return { receiptUrl: null, notes: "" };
  if (!notes.startsWith(RECEIPT_PREFIX)) return { receiptUrl: null, notes };
  const nl = notes.indexOf("\n");
  if (nl === -1) return { receiptUrl: notes.slice(RECEIPT_PREFIX.length), notes: "" };
  return { receiptUrl: notes.slice(RECEIPT_PREFIX.length, nl), notes: notes.slice(nl + 1) };
}
function mergeNotes(receiptUrl, rawNotes){
  if (!receiptUrl) return rawNotes || null;
  return `${RECEIPT_PREFIX}${receiptUrl}\n${rawNotes || ""}`;
}

// Frontend historicamente lê grossAmount/netAmount · DB tem grossValue/netValue.
function serializeCommission(c){
  const { receiptUrl, notes } = splitNotes(c.notes);
  return {
    ...c,
    grossAmount: c.grossValue,
    netAmount: c.netValue,
    receiptUrl,
    notes  // nota limpa (sem o prefixo)
  };
}

r.get("/", requireAuth, async (req, res, next) => {
  try {
    let where = {};
    if (req.user.role === "ASSOCIATE"){
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      where = { associateId: a?.id };
    }
    if (req.query.status) where.status = req.query.status;
    const data = await db.commission.findMany({
      where, orderBy: { createdAt: "desc" }, take: 200,
      include: { sale: { select: { code:true } }, associate: { select: { user: { select: { name:true } } } } }
    });
    res.json({ data: data.map(serializeCommission) });
  } catch (e){ next(e); }
});

r.patch("/:id/status", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const status = z.enum(["pending","approved","paid"]).parse(req.body.status);
    const data = { status };
    if (status === "paid") data.paidAt = new Date();
    const c = await db.commission.update({
      where: { id: req.params.id },
      data,
      include: { sale: { include: { associate: { select: { userId: true } } } } }
    });
    await audit({ req, action: "COMMISSION_STATUS_CHANGED", entity: `Commission:${c.id}`, metadata: { status } });
    // Push pro corretor: comissão mudou de status. Eventos separados por status.
    const userId = c.sale?.associate?.userId;
    if (userId && status === "approved") {
      sendPushToUser(userId, {
        eventKey: "commission.approved",
        kind: "commission_approved",
        title: "✅ Comissão aprovada",
        body: `Comissão liberada pra pagamento`,
        url: `/?screen=cors-comissoes&commission=${c.id}`,
        tag: `commission-${c.id}`,
      }).catch(()=>{});
    } else if (userId && status === "paid") {
      sendPushToUser(userId, {
        eventKey: "commission.paid",
        kind: "commission_paid",
        title: "💵 Comissão paga",
        body: `Comissão foi paga`,
        url: `/?screen=cors-comissoes&commission=${c.id}`,
        tag: `commission-${c.id}`,
      }).catch(()=>{});
    }
    res.json({ id: c.id, status: c.status });
  } catch (e){ next(e); }
});

// Confirmar pagamento com upload do comprovante · multipart/form-data
// campos: comprovante (file), dataPag (YYYY-MM-DD), paymentMethod (string), notes (string)
r.post("/:id/pay", requireAuth, requireRole("ADMIN"), (req, res, next) => {
  receiptUpload.single("comprovante")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "upload_failed", message: err.message });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "no_file" });
    try {
      const paymentSchema = z.object({
        dataPag: z.string().optional(),
        paymentMethod: z.string().max(40).optional(),
        notes: z.string().max(2000).optional()
      });
      const body = paymentSchema.parse(req.body);
      const existing = await db.commission.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "not_found" });
      const receiptUrl = `/pagamentos-comissoes/${req.params.id}/${file.filename}`;
      const paidAt = body.dataPag ? new Date(body.dataPag + "T12:00:00Z") : new Date();
      const c = await db.commission.update({
        where: { id: req.params.id },
        data: {
          status: "paid",
          paidAt,
          paymentMethod: body.paymentMethod || null,
          notes: mergeNotes(receiptUrl, body.notes)
        },
        include: { sale: { include: { associate: { select: { userId: true } } } } }
      });
      await audit({ req, action: "COMMISSION_PAID", entity: `Commission:${c.id}`, metadata: { receiptUrl, paymentMethod: body.paymentMethod } });
      // Push pro corretor: comissão paga via upload de comprovante.
      if (c.sale?.associate?.userId) {
        sendPushToUser(c.sale.associate.userId, {
          eventKey: "commission.paid",
          kind: "commission_paid",
          title: "💵 Comissão paga",
          body: `Comissão foi paga e comprovante anexado`,
          url: `/?screen=cors-comissoes&commission=${c.id}`,
          tag: `commission-${c.id}`,
        }).catch(()=>{});
      }
      res.status(201).json(serializeCommission(c));
    } catch (e){
      // Remove arquivo órfão se falhar após upload
      try { fs.unlinkSync(file.path); } catch {}
      next(e);
    }
  });
});

// Backfill no boot · cria Commission pras vendas APPROVED existentes sem registro
(async () => {
  try {
    const r = await backfillMissingCommissions();
    if (r?.created) console.log(`[commissions] backfill: ${r.created}/${r.checked} criadas`);
  } catch {}
})();

export default r;
