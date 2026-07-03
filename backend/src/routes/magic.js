// =============================================================================
// /api/auth/magic · endpoints públicos do magic link (primeiro acesso)
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { signAccessToken, issueRefreshToken, refreshCookieOptions } from "../auth/jwt.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { findUserByMagicToken, consumeMagicToken } from "../services/magicAuth.js";

const r = Router();

// GET /api/auth/magic/:token · público · valida e retorna info pra UI
r.get("/:token", async (req, res, next) => {
  try {
    const result = await findUserByMagicToken(req.params.token);
    if (result.error){
      return res.status(result.status || 400).json({ error: result.error });
    }
    const u = result.user;
    const emailMasked = String(u.email).replace(/^(.{2}).+(@.+)$/, "$1***$2");
    res.json({
      ok: true,
      name: u.name,
      firstName: (u.name || "").split(" ")[0],
      emailMasked,
      expiresAt: u.magicExpiresAt
    });
  } catch (e){ next(e); }
});

// POST /api/auth/magic/redeem · público · troca token + senha por sessão logada
const redeemSchema = z.object({
  token: z.string().min(8),
  password: z.string().min(8).max(128)
});

r.post("/redeem", async (req, res, next) => {
  try {
    const input = redeemSchema.parse(req.body);
    const check = await findUserByMagicToken(input.token);
    if (check.error){
      return res.status(check.status || 400).json({ error: check.error });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const r2 = await consumeMagicToken({ token: input.token, newPasswordHash: passwordHash });
    if (r2.error){
      return res.status(r2.status || 400).json({ error: r2.error });
    }

    if (r2.role === "ASSOCIATE"){
      await db.associate.updateMany({ where: { userId: r2.userId }, data: { lastActiveAt: new Date() } }).catch(()=>{});
    }

    const userObj = { id: r2.userId, email: r2.email, role: r2.role, name: r2.name };
    const accessToken = signAccessToken(userObj);
    const { token: refreshToken } = await issueRefreshToken({ userId: r2.userId, req });
    res.cookie("rt", refreshToken, refreshCookieOptions());

    await audit({ userId: r2.userId, req, action: "MAGIC_REDEEMED_FIRST_ACCESS", entity: `User:${r2.userId}` });
    logger.info({ userId: r2.userId, email: r2.email }, "🔓 magic_link · primeiro acesso concluído");

    res.json({ accessToken, user: userObj, firstAccess: true });
  } catch (e){ next(e); }
});

export default r;
