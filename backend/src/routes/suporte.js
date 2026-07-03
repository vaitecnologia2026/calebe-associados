// =============================================================================
// /api/suporte · API para o Agente IA de Suporte Técnico (VAI IA)
//
// Proteção: Bearer token via SUPPORT_WEBHOOK_TOKEN env var
// Usado pelo canal WhatsApp 9211-7994 via intenções da VAI IA
//
// Endpoints:
//   POST /identify      → busca por phone (retorno rápido) ou CRECI (+ salva phone)
//   POST /reset-access  → dispara magic link de recriar acesso
//   GET  /get-info      → status da conta, leads ativos, último login
//   POST /escalate      → loga escalada para humano
// =============================================================================
import { Router } from "express";
import { db } from "../db.js";
import { logger } from "../utils/logger.js";
import { sendMagicLinkWhatsApp } from "../services/magicAuth.js";
import { normalizePhone, maskPhone } from "../crypto.js";

const r = Router();

// ----- Auth -----------------------------------------------------------------

function requireSupportToken(req, res, next){
  const secret = process.env.SUPPORT_WEBHOOK_TOKEN;
  if (!secret) return res.status(503).json({ error: "suporte_disabled" });
  const auth = req.headers.authorization || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!given || given !== secret) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ----- Helpers --------------------------------------------------------------

function buildPhoneVariants(raw){
  const n = normalizePhone(raw);
  if (!n) return [];
  const variants = [n];
  // Normaliza dígito 9: 55XX9XXXXXXX ↔ 55XXXXXXXX
  if (n.length === 13 && n[4] === "9") variants.push(n.slice(0, 4) + n.slice(5));
  if (n.length === 12) variants.push(n.slice(0, 4) + "9" + n.slice(4));
  return [...new Set(variants)];
}

async function findAssociateByPhone(phone){
  const variants = buildPhoneVariants(phone);
  if (!variants.length) return null;
  return db.associate.findFirst({
    where: {
      OR: [
        { supportPhone: { in: variants } },
        { whatsapp:     { in: variants } },
        { phone:        { in: variants } }
      ]
    },
    include: {
      user: { select: { id: true, name: true, email: true, active: true, lastLoginAt: true } }
    }
  });
}

async function findAssociateByCreci(creci){
  const norm = String(creci).trim().toUpperCase();
  return db.associate.findFirst({
    where: { creci: { equals: norm, mode: "insensitive" } },
    include: {
      user: { select: { id: true, name: true, email: true, active: true, lastLoginAt: true } }
    }
  });
}

function formatAssociateResponse(assoc, firstContact = false){
  return {
    found:        true,
    name:         assoc.user.name,
    firstName:    assoc.user.name.split(" ")[0],
    creci:        assoc.creci || "não cadastrado",
    status:       assoc.status,
    active:       assoc.user.active,
    firstContact
  };
}

// ----- POST /identify -------------------------------------------------------
// Tenta identificar o corretor pelo phone (retorno imediato).
// Se não encontrar, tenta pelo CRECI e salva o phone para a próxima vez.
// Body: { phone?, creci? }

r.post("/identify", requireSupportToken, async (req, res, next) => {
  try {
    const { phone, creci } = req.body || {};

    if (phone){
      const assoc = await findAssociateByPhone(phone);
      if (assoc){
        logger.info({ associateId: assoc.id, phone: maskPhone(phone) }, "suporte · identificado por phone");
        return res.json(formatAssociateResponse(assoc, false));
      }
    }

    if (creci){
      const assoc = await findAssociateByCreci(creci);
      if (assoc){
        // Salva o phone pra identificação automática nas próximas conversas
        if (phone){
          const norm = normalizePhone(phone);
          if (norm){
            await db.$executeRaw`UPDATE "Associate" SET "supportPhone" = ${norm} WHERE id = ${assoc.id}`
              .catch(e => logger.warn({ err: e.message }, "suporte · save supportPhone falhou"));
          }
        }
        logger.info({ associateId: assoc.id, creci }, "suporte · identificado por CRECI");
        return res.json(formatAssociateResponse(assoc, true));
      }
    }

    return res.json({ found: false });
  } catch(e){ next(e); }
});

// ----- POST /reset-access ---------------------------------------------------
// Reenvia magic link para o corretor recriar o acesso.
// Body: { creci }

r.post("/reset-access", requireSupportToken, async (req, res, next) => {
  try {
    const { creci } = req.body || {};
    if (!creci) return res.status(400).json({ error: "creci_required" });

    const assoc = await findAssociateByCreci(creci);
    if (!assoc) return res.json({ ok: false, reason: "corretor_nao_encontrado" });
    if (!assoc.user.active) return res.json({ ok: false, reason: "conta_inativa" });
    if (assoc.status === "INACTIVE") return res.json({ ok: false, reason: "conta_bloqueada" });

    const result = await sendMagicLinkWhatsApp(assoc.user, assoc);

    if (result.ok){
      logger.info({ associateId: assoc.id, creci }, "suporte IA · magic link reenviado");
      return res.json({
        ok: true,
        message: `Link enviado para o WhatsApp cadastrado do corretor ${assoc.user.name.split(" ")[0]}.`
      });
    }

    logger.warn({ associateId: assoc.id, creci, err: result.error }, "suporte IA · magic link falhou");
    return res.json({
      ok: false,
      reason: result.error === "no_phone" ? "telefone_nao_cadastrado" : "envio_falhou"
    });
  } catch(e){ next(e); }
});

// ----- GET /get-info --------------------------------------------------------
// Retorna status detalhado da conta do corretor.
// Query: ?creci=XXXXX

r.get("/get-info", requireSupportToken, async (req, res, next) => {
  try {
    const creci = req.query.creci;
    if (!creci) return res.status(400).json({ error: "creci_required" });

    const assoc = await findAssociateByCreci(creci);
    if (!assoc) return res.json({ found: false });

    const activeLeads = await db.lead.count({
      where: {
        assignedToId: assoc.id,
        status: { in: ["NEW", "CONTACTED", "NEGOTIATING", "CLOSING"] }
      }
    });

    const lastLogin = assoc.user.lastLoginAt
      ? new Date(assoc.user.lastLoginAt).toLocaleDateString("pt-BR")
      : "nunca";

    const emailMasked = assoc.user.email
      ? assoc.user.email.replace(/(?<=.{3}).(?=.*@)/g, "*")
      : "não cadastrado";

    return res.json({
      found:       true,
      name:        assoc.user.name,
      firstName:   assoc.user.name.split(" ")[0],
      email:       emailMasked,
      status:      assoc.status,
      active:      assoc.user.active,
      lastLogin,
      leadsAtivos: activeLeads,
      categoria:   assoc.category,
      segmento:    assoc.segment
    });
  } catch(e){ next(e); }
});

// ----- POST /escalate -------------------------------------------------------
// Registra a escalada para suporte humano.
// Body: { creci?, phone?, issue, description? }

r.post("/escalate", requireSupportToken, async (req, res, next) => {
  try {
    const { creci, phone, issue, description } = req.body || {};
    logger.warn(
      { creci, phone: phone ? maskPhone(phone) : null, issue, description },
      "🆘 suporte · ESCALADO para humano"
    );
    return res.json({
      ok: true,
      message: "Anotei o seu problema e vou passar para o suporte humano agora. Em breve alguém vai entrar em contato com você pelo WhatsApp."
    });
  } catch(e){ next(e); }
});

export default r;
