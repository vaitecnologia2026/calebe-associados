// =============================================================================
// Criptografia simétrica AES-256-GCM para dados sensíveis.
// - Telefone real do lead (phoneEncrypted Bytes)
// - Dados de cliente em vendas (clientDataEncrypted Bytes)
// - Tokens/credenciais armazenados (apiTokenEncrypted Bytes)
//
// Formato: Buffer = iv(12) || authTag(16) || ciphertext
// =============================================================================
import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual, createHmac } from "node:crypto";

function getKey(){
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY não configurada");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY deve ter 32 bytes (base64)");
  return key;
}

export function encrypt(plain){
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);  // 12 + 16 + N
}

export function decrypt(buf){
  if (!buf || buf.length < 28) throw new Error("Buffer cifrado inválido");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// Hash SHA-256 (para dedup, idempotência, hash de refresh token)
export function sha256Hex(str){
  return createHash("sha256").update(String(str)).digest("hex");
}

// HMAC com timingSafeEqual para validação de webhooks
export function verifyHmac(rawBody, receivedSig, secret){
  if (!receivedSig || !secret) return false;
  // Aceita "sha256=xxx" ou só o hex
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = receivedSig.startsWith("sha256=") ? receivedSig.slice(7) : receivedSig;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
  } catch { return false; }
}

// Normaliza telefone BR para E.164 (apenas dígitos + 55)
export function normalizePhone(tel){
  const digits = String(tel || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
}

// Máscara PT-BR: (47) 9****-**34
export function maskPhone(tel){
  const digits = String(tel || "").replace(/\D/g, "");
  if (digits.length < 10) return "—";
  const last4 = digits.slice(-4);
  const last2 = last4.slice(-2);
  const ddd = digits.length >= 12 ? digits.slice(2, 4) : digits.slice(0, 2);
  return `(${ddd}) 9****-**${last2}`;
}

// Variantes de hash de telefone para dedup (resolve bug do "9" do celular BR).
// Retorna 1 ou 2 hashes: o telefone normalizado + a versão alternativa (com/sem 9)
// quando aplicável a celular brasileiro (DDD + 1º dígito 9).
export function phoneHashVariants(phoneNorm){
  const out = new Set();
  if (!phoneNorm) return [];
  out.add(sha256Hex(phoneNorm));
  // 13 dígitos com 9 prefix → também tenta sem o 9 (12 dígitos)
  if (phoneNorm.length === 13 && phoneNorm.startsWith("55") && phoneNorm[4] === "9"){
    const ddd = parseInt(phoneNorm.slice(2, 4), 10);
    if (ddd >= 11 && ddd <= 99){
      out.add(sha256Hex(phoneNorm.slice(0, 4) + phoneNorm.slice(5)));
    }
  }
  // 12 dígitos sem 9 prefix → também tenta com o 9 (13 dígitos)
  if (phoneNorm.length === 12 && phoneNorm.startsWith("55")){
    const ddd = parseInt(phoneNorm.slice(2, 4), 10);
    if (ddd >= 11 && ddd <= 99){
      out.add(sha256Hex(phoneNorm.slice(0, 4) + "9" + phoneNorm.slice(4)));
    }
  }
  return Array.from(out);
}
