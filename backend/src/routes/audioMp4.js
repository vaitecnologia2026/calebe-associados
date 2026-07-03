// =============================================================================
// /api/audio-mp4/*  · transcoda audio ogg/webm/etc para m4a (AAC-LC) sob demanda
// /api/audio-mp3/*  · variante MP3 (fallback universal pra Safari problemático)
//
// Necessario porque Safari (iOS + macOS antigos) não toca ogg/opus nativamente.
// 2026-05-15.
//
// Uso:
//   <audio>
//     <source src="/midias/inbound/audio/X.ogg" type="audio/ogg">
//     <source src="/api/audio-mp4/inbound/audio/X.ogg" type="audio/mp4">
//     <source src="/api/audio-mp3/inbound/audio/X.ogg" type="audio/mpeg">
//   </audio>
// =============================================================================
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../utils/logger.js";

const execFileP = promisify(execFile);

const MIDIAS_ROOT = path.resolve(process.cwd(), "..", "Midias");
const CACHE_ROOT_M4A = path.join(MIDIAS_ROOT, "_audio_m4a_cache");
const CACHE_ROOT_MP3 = path.join(MIDIAS_ROOT, "_audio_mp3_cache");
fs.mkdirSync(CACHE_ROOT_M4A, { recursive: true });
fs.mkdirSync(CACHE_ROOT_MP3, { recursive: true });

function safeJoinMidias(rel) {
  const abs = path.resolve(MIDIAS_ROOT, rel);
  if (!abs.startsWith(MIDIAS_ROOT)) throw new Error("path_traversal");
  return abs;
}

// 2026-05-15 · Range request handler · Safari Mobile/Desktop manda Range: bytes=0-1
// pra sondar suporte; se servidor responder 200 com Accept-Ranges presente
// (contradição), Safari trava o player. Responder 206 honrando o byte range.
function serveFileWithRange(req, res, absPath, contentType, cacheMaxAge){
  const stat = fs.statSync(absPath);
  const size = stat.size;
  const rangeHeader = req.headers.range;

  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", `public, max-age=${cacheMaxAge}`);
  res.setHeader("Last-Modified", stat.mtime.toUTCString());

  if (rangeHeader){
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (m){
      let start = m[1] === "" ? null : Number(m[1]);
      let end   = m[2] === "" ? null : Number(m[2]);
      if (start === null && end !== null){
        start = Math.max(0, size - end);
        end   = size - 1;
      } else {
        if (start === null) start = 0;
        if (end   === null || end >= size) end = size - 1;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start >= 0 && end < size){
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", String(end - start + 1));
        return fs.createReadStream(absPath, { start, end }).pipe(res);
      }
      res.status(416);
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.end();
    }
  }

  res.status(200);
  res.setHeader("Content-Length", String(size));
  return fs.createReadStream(absPath).pipe(res);
}

// Comandos de transcode · 2026-05-16 · Safari Mac/iOS tinha problema mesmo com
// AAC m4a "correto" (Range OK, faststart OK, moov no início). Suspeita: AAC mono
// 48k do encoder nativo ffmpeg às vezes confunde o player. Solução: forçar perfil
// AAC-LC, sample-rate 44100, stereo · alinhar com o que Safari espera no rest do
// stack iOS. MP3 segue como fallback universalmente compatível.
function ffmpegArgsM4A(src, dst){
  return [
    "-y", "-i", src,
    "-vn",
    "-c:a", "aac",
    "-profile:a", "aac_low",
    "-b:a", "96k",
    "-ar", "44100",
    "-ac", "2",
    "-movflags", "+faststart",
    "-f", "mp4",
    dst
  ];
}
function ffmpegArgsMP3(src, dst){
  return [
    "-y", "-i", src,
    "-vn",
    "-c:a", "libmp3lame",
    "-b:a", "96k",
    "-ar", "44100",
    "-ac", "2",
    "-write_xing", "1",
    "-id3v2_version", "3",
    "-f", "mp3",
    dst
  ];
}

// VAI S3 bucket legado · whitelist estrita pra evitar SSRF.
const VAI_S3_HOST = "vaistorage.s3.us-east-1.amazonaws.com";
const VAI_S3_RE   = /^[a-f0-9-]{8,}\.[a-z0-9]{2,5}$/i;

// Cria um router pro tipo (m4a ou mp3).
function makeRouter({ format, ext, contentType, cacheRoot, ffmpegArgs, cacheMaxAge }){
  const router = Router();

  router.get(/.*/, async (req, res) => {
    try {
      let rel = decodeURIComponent(req.path).replace(/^\/+/, "");
      if (!rel || rel.includes("..")) return res.status(400).json({ error: "bad_path" });

      // Reject obviously non-audio extensions early. Frontend ocasionalmente monta
      // <source src="/api/audio-mp3/<path>"> para anexos que nao sao audio (jpg/png/etc)
      // como fallback; ffmpeg encerra com erro e gera 500 transcode_failed sem necessidade.
      const lower = rel.toLowerCase();
      const isAudioExt = /\.(ogg|opus|mp3|m4a|aac|wav|webm|flac|amr)(\?|$)/i.test(lower) || rel.startsWith("vai/");
      if (!isAudioExt) return res.status(415).json({ error: "not_audio" });

      // Proxy pra audios outbound legado na VAI S3.
      if (rel.startsWith("vai/")){
        const tail = rel.slice("vai/".length);
        if (!VAI_S3_RE.test(tail)) return res.status(400).json({ error: "bad_vai_id" });
        const s3Url = `https://${VAI_S3_HOST}/files/${tail}`;
        const cacheKey = `vai_${tail}.${ext}`;
        const cacheAbs = path.join(cacheRoot, cacheKey);
        if (!fs.existsSync(cacheAbs)){
          const tmpIn = path.join(cacheRoot, `tmp_${tail}`);
          try {
            const r1 = await fetch(s3Url);
            if (!r1.ok){
              logger.warn({ s3Url, status: r1.status }, `audio-${format} · falha baixar VAI S3`);
              return res.status(502).json({ error: "vai_s3_fetch_failed" });
            }
            const buf = Buffer.from(await r1.arrayBuffer());
            fs.writeFileSync(tmpIn, buf);
            await execFileP("ffmpeg", ffmpegArgs(tmpIn, cacheAbs), { timeout: 30000 });
          } catch (e){
            logger.warn({ err: e.message, s3Url }, `audio-${format} · transcode VAI S3 falhou`);
            return res.status(500).json({ error: "transcode_failed" });
          } finally {
            try { fs.unlinkSync(tmpIn); } catch {}
          }
        }
        return serveFileWithRange(req, res, cacheAbs, contentType, 2592000);
      }

      const srcAbs = safeJoinMidias(rel);
      if (!fs.existsSync(srcAbs)) return res.status(404).json({ error: "not_found" });

      const cacheKey = rel.replace(/[/\\]/g, "_") + "." + ext;
      const cacheAbs = path.join(cacheRoot, cacheKey);
      if (!fs.existsSync(cacheAbs)) {
        try {
          await execFileP("ffmpeg", ffmpegArgs(srcAbs, cacheAbs), { timeout: 30000 });
        } catch (e) {
          logger.warn({ err: e.message, src: rel, format }, `audio-${format} · transcode falhou`);
          return res.status(500).json({ error: "transcode_failed" });
        }
      }
      return serveFileWithRange(req, res, cacheAbs, contentType, cacheMaxAge);
    } catch (e) {
      logger.warn({ err: e.message, format }, `audio-${format} error`);
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

export const audioMp4Router = makeRouter({
  format: "mp4", ext: "m4a", contentType: "audio/mp4",
  cacheRoot: CACHE_ROOT_M4A, ffmpegArgs: ffmpegArgsM4A, cacheMaxAge: 3600
});
export const audioMp3Router = makeRouter({
  format: "mp3", ext: "mp3", contentType: "audio/mpeg",
  cacheRoot: CACHE_ROOT_MP3, ffmpegArgs: ffmpegArgsMP3, cacheMaxAge: 3600
});

// Default export mantém compat com import existente.
export default audioMp4Router;
