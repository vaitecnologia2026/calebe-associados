// =============================================================================
// SSE Hub · push de eventos em tempo real para clientes conectados.
// Mantém Map<userId, Set<res>> e Set<adminRes> para broadcast admin.
// Cluster-safe via Redis pub/sub: uma emissão em 1 worker replica em TODOS os
// workers do cluster. (O process.send do PM2 NÃO entrega entre irmãos.)
// =============================================================================
import { logger } from "../utils/logger.js";
import Redis from "ioredis";

const byUser = new Map();       // userId -> Set<res>
const admins = new Set();       // res dos users com role=ADMIN (monitoramento global)
const HEARTBEAT_MS = 25_000;    // ping pra manter conexão viva via proxies

// ---------- Barramento cross-worker via Redis pub/sub -----------------------
// PM2 cluster NAO entrega process.send entre workers irmaos. Usamos Redis
// pub/sub: cada emissao e publicada num canal e TODOS os workers (assinantes)
// entregam para suas proprias conexoes locais. Se o Redis cair, cada worker
// continua entregando localmente (sem regressao para o worker de origem).
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const SSE_CHANNEL = "calebe:ssehub";
const ORIGIN = String(process.pid);
let _pub = null;
let _sub = null;

function _mkRedis(role){
  const c = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000)
  });
  c.on("ready", () => logger.info({ role, pid: process.pid }, "SSE Redis bus pronto"));
  c.on("error", (e) => logger.warn({ role, err: e.message }, "SSE Redis erro (fallback local)"));
  return c;
}

try {
  _pub = _mkRedis("pub");
  _sub = _mkRedis("sub");
  _sub.subscribe(SSE_CHANNEL).catch((e) => logger.error({ err: e.message }, "SSE Redis subscribe falhou"));
  _sub.on("message", (chan, raw) => {
    if (chan !== SSE_CHANNEL) return;
    let msg = null;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || msg.origin === ORIGIN) return;
    if (msg.kind === "sseToUser")        _sseToUserLocal(...msg.args);
    else if (msg.kind === "sseToAdmins") _sseToAdminsLocal(...msg.args);
    else if (msg.kind === "sseToMany")   _sseToManyLocal(...msg.args);
  });
} catch (e){
  logger.error({ err: e.message }, "SSE Redis init falhou · operando so local");
}

function _replicate(kind, args){
  if (!_pub || _pub.status !== "ready") return;
  try { _pub.publish(SSE_CHANNEL, JSON.stringify({ kind, args, origin: ORIGIN })); } catch {}
}

export function sseSubscribe(res, user){
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.write(`event: ready\ndata: ${JSON.stringify({ userId: user.id, ts: Date.now() })}\n\n`);

  if (!byUser.has(user.id)) byUser.set(user.id, new Set());
  byUser.get(user.id).add(res);
  if (user.role === "ADMIN") admins.add(res);

  const beat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); }
    catch { clearInterval(beat); }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(beat);
    byUser.get(user.id)?.delete(res);
    if (!byUser.get(user.id)?.size) byUser.delete(user.id);
    admins.delete(res);
    logger.info({ userId: user.id, email: user.email, totalUsers: byUser.size }, "SSE desconectou");
  };
  res.on("close", cleanup);
  res.on("error", cleanup);

  logger.info({ userId: user.id, email: user.email, role: user.role, totalUsers: byUser.size, totalConns: [...byUser.values()].reduce((a,s)=>a+s.size,0) }, "SSE conectou");
}

function writeEvent(res, event, data){
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function _sseToUserLocal(userId, event, data){
  const set = byUser.get(userId);
  if (!set?.size) return 0;
  let n = 0;
  for (const res of set) if (writeEvent(res, event, data)) n++;
  return n;
}

function _sseToAdminsLocal(event, data){
  let n = 0;
  for (const res of admins) if (writeEvent(res, event, data)) n++;
  return n;
}

function _sseToManyLocal(userIds, event, data){
  const seen = new Set();
  let n = 0;
  for (const uid of userIds){
    if (seen.has(uid)) continue;
    seen.add(uid);
    n += _sseToUserLocal(uid, event, data);
  }
  n += _sseToAdminsLocal(event, data);
  return n;
}

export function sseToUser(userId, event, data){
  const n = _sseToUserLocal(userId, event, data);
  _replicate("sseToUser", [userId, event, data]);
  return n;
}

export function sseToAdmins(event, data){
  const n = _sseToAdminsLocal(event, data);
  _replicate("sseToAdmins", [event, data]);
  return n;
}

export function sseToMany(userIds, event, data){
  const n = _sseToManyLocal(userIds, event, data);
  _replicate("sseToMany", [userIds, event, data]);
  return n;
}

export function sseStats(){
  return {
    usersOnline: byUser.size,
    totalConns: [...byUser.values()].reduce((a, s) => a + s.size, 0),
    admins: admins.size,
    workerPid: process.pid,
    clustered: true,
    redisBus: _pub?.status === "ready"
  };
}
