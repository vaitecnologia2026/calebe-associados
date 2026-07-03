// =============================================================================
// Importação de leads · CSV/XLSX
// - Parse robusto (vírgula ou ponto-e-vírgula para CSV; sheet 0 para XLSX)
// - Normaliza telefone · calcula hash · detecta duplicatas
// - Cria Lead + DistributionEntry (enfileira na distribuição)
// =============================================================================
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { db } from "../db.js";
import { encrypt, sha256Hex, normalizePhone, maskPhone } from "../crypto.js";
import { enqueueLead, distributeToday } from "./distributionEngine.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";

function parseFile(buffer, filename){
  const ext = (filename || "").toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls"){
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }
  // CSV: detecta delimitador olhando APENAS o header (primeira linha).
  // Heuristica anterior ("txt.includes(';')") falhava quando algum campo de
  // dados continha ';', forcando o parser a tratar arquivo virgula como 1 coluna.
  const txt = buffer.toString("utf8");
  const headerLine = txt.split(/\r?\n/, 1)[0] || "";
  const sep = headerLine.includes(";") ? ";" : ",";
  return parseCsv(txt, { columns: true, skip_empty_lines: true, trim: true, delimiter: sep });
}

// Mapeia valores com aliases típicos do cliente
function pick(row, ...keys){
  for (const k of keys){
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

const MAX_ROWS_PER_IMPORT = 1000;
const PROGRESS_UPDATE_EVERY = 10;  // atualiza o registro a cada N linhas

export async function processImport({ importId, buffer, filename, createdBy }){
  const rawRows = parseFile(buffer, filename);
  if (rawRows.length > MAX_ROWS_PER_IMPORT){
    await db.leadImport.update({
      where: { id: importId },
      data: {
        totalRows: rawRows.length, status: "ERROR",
        processedAt: new Date(),
        errorLog: { totalErrors: 1, sample: [{ line: 0, reason: `excedido limite de ${MAX_ROWS_PER_IMPORT} leads por importação (${rawRows.length} linhas)` }] }
      }
    });
    return { valid: 0, invalid: 0, duplicates: 0, total: rawRows.length, error: "row_limit_exceeded" };
  }
  const rows = rawRows;
  await db.leadImport.update({
    where: { id: importId },
    data: { totalRows: rows.length, status: "PROCESSING", validRows: 0, invalidRows: 0, duplicateRows: 0 }
  });

  let valid = 0, invalid = 0, duplicates = 0;
  const errors = [];
  const queuedLeadIds = [];

  for (const [idx, row] of rows.entries()){
    try {
      const nome  = pick(row, "nome", "name", "cliente");
      const tel   = pick(row, "telefone", "phone", "whatsapp");
      const seg   = pick(row, "segmento", "segment", "oferta", "Oferta") || "Regional";
      const fonte = pick(row, "fonte", "source", "origem") || "Importação";
      const city  = pick(row, "cidade", "city");
      if (!nome || !tel){ invalid++; errors.push({ line: idx+2, reason: "nome/telefone ausentes" }); }
      else {
        const phoneNorm = normalizePhone(tel);
        if (phoneNorm.length < 10){ invalid++; errors.push({ line: idx+2, reason: "telefone inválido" }); }
        else {
          const phoneHash = sha256Hex(phoneNorm);
          const existing = await db.lead.findUnique({ where: { phoneHash }, select: { id: true } });
          if (existing){ duplicates++; }
          else {
            const lead = await db.lead.create({
              data: {
                name: nome,
                phoneEncrypted: encrypt(phoneNorm),
                phoneHash,
                phoneMasked: maskPhone(phoneNorm),
                source: fonte,
                origin: "IMPORT",
                segment: seg,
                city: city || null
              }
            });
            await enqueueLead(lead.id);
            queuedLeadIds.push(lead.id);
            valid++;
          }
        }
      }
    } catch (e){
      invalid++;
      errors.push({ line: idx+2, reason: e.message });
      logger.warn({ err: e }, "import row failed");
    }
    // Atualiza progresso periodicamente para o frontend conseguir polar
    if ((idx + 1) % PROGRESS_UPDATE_EVERY === 0){
      await db.leadImport.update({
        where: { id: importId },
        data: { validRows: valid, invalidRows: invalid, duplicateRows: duplicates }
      }).catch(() => {});
    }
  }

  await db.leadImport.update({
    where: { id: importId },
    data: {
      status: valid > 0 ? "DISTRIBUTED" : "ERROR",
      validRows: valid,
      invalidRows: invalid,
      duplicateRows: duplicates,
      processedAt: new Date(),
      errorLog: errors.length ? { sample: errors.slice(0,50), totalErrors: errors.length } : null
    }
  });

  await audit({
    userId: createdBy,
    action: "LEADS_IMPORTED",
    entity: `Import:${importId}`,
    metadata: { valid, invalid, duplicates, total: rows.length }
  });

  // Dispara a roleta imediatamente · evita esperar o worker (2 min).
  // Falhas aqui não afetam o resultado da importação; o worker pega no próximo tick.
  let distributedNow = 0;
  if (valid > 0){
    try {
      const r = await distributeToday();
      distributedNow = r?.total || 0;
      logger.info({ importId, enfileirados: valid, distribuidos: distributedNow, reagendados: r?.reagendados?.length || 0 }, "import · roleta disparada após enqueue");
    } catch (e){
      logger.warn({ err: e.message, importId }, "import · falha ao disparar distributeToday (worker pegará)");
    }
  }

  return { valid, invalid, duplicates, total: rows.length, distributedNow };
}
