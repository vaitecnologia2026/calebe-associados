// =============================================================================
// Transcode de áudio · gravações do navegador → ogg/opus (formato WhatsApp).
//
// Extraído de routes/conversations.js em 2026-05-20 pra desacoplar do roteador.
// Comportamento idêntico ao original — função pura, sem mudanças de contrato.
//
// Por que existe: WhatsApp aceita áudio só em audio/ogg com codec opus.
// Browsers Chrome gravam webm/opus mesmo quando o blob é rotulado audio/ogg,
// e o WhatsApp rejeita silenciosamente. Forçamos o demux+remux via ffmpeg.
// =============================================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

/**
 * Transcoda um buffer de áudio pra ogg/opus.
 * @param {Buffer} buffer  · áudio bruto (qualquer container suportado pelo ffmpeg)
 * @param {string} inputMime · mime-type do input (ex: "audio/webm;codecs=opus")
 * @returns {Promise<Buffer>} · buffer ogg/opus pronto pra mandar via WhatsApp
 */
export async function transcodeAudioToOgg(buffer, inputMime){
  const id  = randomUUID();
  const ext = pickExt(inputMime);
  const inPath  = path.join(tmpdir(), `wa-audio-${id}-in${ext}`);
  const outPath = path.join(tmpdir(), `wa-audio-${id}-out.ogg`);

  await writeFile(inPath, buffer);
  try {
    await execFileP("ffmpeg", [
      "-y", "-loglevel", "error",
      "-i", inPath,
      "-c:a", "libopus",
      "-b:a", "64k",
      "-ar", "48000",
      "-application", "voip",
      "-f", "ogg",
      outPath
    ], { timeout: 30_000 });
    return await readFile(outPath);
  } finally {
    unlink(inPath).catch(()=>{});
    unlink(outPath).catch(()=>{});
  }
}

// ffmpeg detecta pelo conteúdo, mas extensão ajuda no demux.
function pickExt(mime){
  if (!mime) return ".bin";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mp4"))  return ".m4a";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("ogg"))  return ".ogg";
  return ".bin";
}
