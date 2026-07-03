// routes/assistant.js · Assistente Claude · ADMIN (completo) e CORRETOR (limitado/só dele)
import express from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db.js";
import { decrypt } from "../crypto.js";
import { distributeExtra } from "../services/distributionEngine.js";
import { logger } from "../utils/logger.js";

const r = express.Router();
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_ADMIN = `Você é a Claude, assistente de IA do ADMIN da plataforma Calebe (vaidavenda). Ajuda a gerenciar leads, corretores e a distribuição, e PODE EXECUTAR ações (o admin liberou). Use SEMPRE as ferramentas pra ler dados reais e executar — nunca invente números. Responda em português do Brasil, direto. Confirme ações com números.`;
const SYSTEM_CORRETOR = `Você é a Claude, assistente do CORRETOR na plataforma Calebe. Você ajuda ELE com os leads DELE, desempenho dele e dicas de atendimento/venda. IMPORTANTE: você NÃO pode mudar nada na plataforma, NÃO distribui leads, NÃO altera código/config e NÃO acessa dados de outros corretores nem números globais. Use só as ferramentas disponíveis (que já trazem só os dados dele). Responda em português do Brasil, gentil e prático.`;

function safeDecrypt(enc){ try { return enc ? decrypt(enc) : null; } catch { return null; } }
function startOfToday(){ const t = new Date(); t.setHours(0,0,0,0); return t; }

const TOOLS_ADMIN = [
  { name: "consultar_stats", description: "Stats gerais: total de leads, distribuídos hoje, pool a distribuir, corretores aprovados, atribuídos sem contato.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "buscar_leads", description: "Busca leads por termo (nome/telefone) e/ou status. limite max 50.", input_schema: { type: "object", properties: { termo: { type: "string" }, status: { type: "string" }, limite: { type: "number" } }, required: [] } },
  { name: "performance_corretores", description: "Ranking de corretores por leads atendidos nos últimos 'dias' (max 90).", input_schema: { type: "object", properties: { dias: { type: "number" }, limite: { type: "number" } }, required: [] } },
  { name: "distribuir_leads", description: "Distribui 'quantidade' de leads novos entre corretores aprovados. Max 500.", input_schema: { type: "object", properties: { quantidade: { type: "number" } }, required: ["quantidade"] } },
  { name: "detalhe_lead", description: "Detalhe de um lead pelo id + últimas mensagens da conversa.", input_schema: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"] } },
  { name: "listar_corretores", description: "Lista corretores (default APPROVED) com a carga de leads de cada um.", input_schema: { type: "object", properties: { status: { type: "string" }, limite: { type: "number" } }, required: [] } },
  { name: "reatribuir_lead", description: "Move um lead pra um corretor específico (por id ou nome) e reseta a atribuição.", input_schema: { type: "object", properties: { leadId: { type: "string" }, corretor: { type: "string" } }, required: ["leadId", "corretor"] } },
];
const TOOLS_CORRETOR = [
  { name: "meus_leads", description: "Lista os SEUS leads (do corretor logado). Filtro opcional por status. limite max 30.", input_schema: { type: "object", properties: { status: { type: "string" }, limite: { type: "number" } }, required: [] } },
  { name: "meu_desempenho", description: "Seu desempenho nos últimos 'dias' (max 90): leads atribuídos, atendidos, sem contato.", input_schema: { type: "object", properties: { dias: { type: "number" } }, required: [] } },
  { name: "detalhe_meu_lead", description: "Detalhe de UM lead SEU (pelo id) + últimas mensagens. Só funciona se o lead for seu.", input_schema: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"] } },
];

export async function runTool(name, input, ctx){
  input = input || {}; ctx = ctx || {};
  // ---- Ferramentas ADMIN ----
  if (ctx.isAdmin){
    if (name === "consultar_stats"){
      const t = startOfToday();
      const [total, distHoje, pool, corr, semContato] = await Promise.all([
        db.lead.count(),
        db.lead.count({ where: { assignedAt: { gte: t } } }),
        db.lead.count({ where: { assignedToId: null, status: "NEW", firstContactAt: null } }),
        db.associate.count({ where: { status: "APPROVED" } }),
        db.lead.count({ where: { assignedToId: { not: null }, firstContactAt: null } }),
      ]);
      return { total_leads: total, distribuidos_hoje: distHoje, pool_a_distribuir: pool, corretores_aprovados: corr, atribuidos_sem_contato: semContato };
    }
    if (name === "buscar_leads"){
      const where = {};
      if (input.status) where.status = String(input.status).toUpperCase();
      if (input.termo) where.OR = [{ name: { contains: String(input.termo), mode: "insensitive" } }, { phoneMasked: { contains: String(input.termo) } }];
      const leads = await db.lead.findMany({ where, take: Math.min(Number(input.limite) || 10, 50), orderBy: { createdAt: "desc" }, select: { id: true, name: true, phoneEncrypted: true, status: true, assignedTo: { select: { user: { select: { name: true } } } } } });
      return leads.map(l => ({ id: l.id, nome: l.name, telefone: safeDecrypt(l.phoneEncrypted), status: l.status, corretor: l.assignedTo?.user?.name || "—" }));
    }
    if (name === "performance_corretores"){
      const dias = Math.min(Number(input.dias) || 30, 90);
      const since = new Date(Date.now() - dias * 864e5);
      const rows = await db.lead.groupBy({ by: ["assignedToId"], where: { firstContactAt: { gte: since }, assignedToId: { not: null } }, _count: { _all: true } });
      rows.sort((a, b) => b._count._all - a._count._all);
      const top = rows.slice(0, Math.min(Number(input.limite) || 10, 30));
      const assoc = await db.associate.findMany({ where: { id: { in: top.map(x => x.assignedToId) } }, select: { id: true, user: { select: { name: true } } } });
      const byId = Object.fromEntries(assoc.map(a => [a.id, a.user?.name || a.id]));
      return top.map(x => ({ corretor: byId[x.assignedToId] || x.assignedToId, leads_atendidos: x._count._all }));
    }
    if (name === "distribuir_leads"){
      const qtd = Math.max(1, Math.min(Number(input.quantidade) || 0, 500));
      const res = await distributeExtra({ count: qtd });
      return { distribuidos: res?.distributed ?? 0, pedido: qtd, fila_vazia: !!res?.queueEmpty };
    }
    if (name === "detalhe_lead"){
      return detalheLead(String(input.leadId), null);
    }
    if (name === "listar_corretores"){
      const where = { status: input.status ? String(input.status).toUpperCase() : "APPROVED" };
      const assoc = await db.associate.findMany({ where, take: Math.min(Number(input.limite) || 20, 100), select: { id: true, user: { select: { name: true } } } });
      const loadRows = await db.lead.groupBy({ by: ["assignedToId"], where: { assignedToId: { in: assoc.map(a => a.id) }, discardedAt: null }, _count: { _all: true } });
      const loadById = Object.fromEntries(loadRows.map(x => [x.assignedToId, x._count._all]));
      return assoc.map(a => ({ id: a.id, nome: a.user?.name || a.id, leads_na_carga: loadById[a.id] || 0 }));
    }
    if (name === "reatribuir_lead"){
      const leadId = String(input.leadId || ""); const alvo = String(input.corretor || "").trim();
      if (!leadId || !alvo) return { erro: "preciso do leadId e do corretor" };
      let assoc = null;
      if (/^cm[a-z0-9]+$/i.test(alvo)) assoc = await db.associate.findUnique({ where: { id: alvo }, select: { id: true, user: { select: { name: true } } } });
      if (!assoc){
        const matches = await db.associate.findMany({ where: { status: "APPROVED", user: { name: { contains: alvo, mode: "insensitive" } } }, select: { id: true, user: { select: { name: true } } }, take: 5 });
        if (matches.length === 0) return { erro: "corretor nao encontrado: " + alvo };
        if (matches.length > 1) return { erro: "varios corretores casam", opcoes: matches.map(m => ({ id: m.id, nome: m.user?.name })) };
        assoc = matches[0];
      }
      const lead = await db.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true } });
      if (!lead) return { erro: "lead nao encontrado" };
      await db.lead.update({ where: { id: leadId }, data: { assignedToId: assoc.id, assignedAt: new Date() } });
      const conv = await db.conversation.findFirst({ where: { leadId } });
      if (conv) await db.conversation.update({ where: { id: conv.id }, data: { associateId: assoc.id } });
      return { ok: true, lead: lead.name, novo_corretor: assoc.user?.name };
    }
  }
  // ---- Ferramentas CORRETOR (só os dados dele) ----
  if (!ctx.isAdmin){
    if (!ctx.associateId) return { erro: "perfil de corretor não encontrado" };
    if (name === "meus_leads"){
      const where = { assignedToId: ctx.associateId };
      if (input.status) where.status = String(input.status).toUpperCase();
      const leads = await db.lead.findMany({ where, take: Math.min(Number(input.limite) || 10, 30), orderBy: { assignedAt: "desc" }, select: { id: true, name: true, phoneMasked: true, status: true, firstContactAt: true } });
      return leads.map(l => ({ id: l.id, nome: l.name, telefone: l.phoneMasked, status: l.status, ja_contatado: !!l.firstContactAt }));
    }
    if (name === "meu_desempenho"){
      const dias = Math.min(Number(input.dias) || 30, 90);
      const since = new Date(Date.now() - dias * 864e5);
      const [atribuidos, atendidos, semContato] = await Promise.all([
        db.lead.count({ where: { assignedToId: ctx.associateId, assignedAt: { gte: since } } }),
        db.lead.count({ where: { assignedToId: ctx.associateId, firstContactAt: { gte: since } } }),
        db.lead.count({ where: { assignedToId: ctx.associateId, firstContactAt: null } }),
      ]);
      return { periodo_dias: dias, leads_atribuidos: atribuidos, leads_atendidos: atendidos, sem_contato_total: semContato };
    }
    if (name === "detalhe_meu_lead"){
      return detalheLead(String(input.leadId), ctx.associateId);
    }
  }
  return { erro: "ferramenta não disponível para o seu perfil" };
}

// detalhe de lead · se restrictAssociateId vier, só retorna se o lead for desse corretor
async function detalheLead(leadId, restrictAssociateId){
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, phoneEncrypted: true, phoneMasked: true, status: true, assignedToId: true, assignedTo: { select: { user: { select: { name: true } } } } } });
  if (!lead) return { erro: "lead não encontrado" };
  if (restrictAssociateId && lead.assignedToId !== restrictAssociateId) return { erro: "esse lead não é seu" };
  const conv = await db.conversation.findFirst({ where: { leadId: lead.id }, select: { id: true } });
  let msgs = [];
  if (conv){
    const mm = await db.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" }, take: 8, select: { direction: true, text: true } });
    msgs = mm.reverse().map(m => ({ de: m.direction === "inbound" ? "cliente" : "corretor", texto: (m.text || "").slice(0, 200) }));
  }
  const telefone = restrictAssociateId ? lead.phoneMasked : safeDecrypt(lead.phoneEncrypted);
  return { id: lead.id, nome: lead.name, telefone, status: lead.status, corretor: lead.assignedTo?.user?.name || "—", ultimas_mensagens: msgs };
}

async function callClaude(messages, tools, system){
  const resp = await fetch(API_URL, { method: "POST", headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2048, system, tools, messages }) });
  return resp.json();
}

export async function chat(initialMessages, tools, system, ctx){
  const msgs = [...initialMessages];
  for (let round = 0; round < 8; round++){
    const resp = await callClaude(msgs, tools, system);
    if (resp.error) throw new Error(resp.error.message || "erro na API Anthropic");
    msgs.push({ role: "assistant", content: resp.content });
    const toolUses = (resp.content || []).filter(c => c.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !toolUses.length){
      const text = (resp.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
      return text || "(sem resposta)";
    }
    const results = [];
    for (const tu of toolUses){
      let result;
      try { result = await runTool(tu.name, tu.input || {}, ctx); } catch (e){ result = { erro: String(e.message || e) }; }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 12000) });
    }
    msgs.push({ role: "user", content: results });
  }
  return "Cheguei no limite de passos — pode reformular?";
}

r.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: "assistente não configurado" });
    const isAdmin = req.user.role === "ADMIN";
    let associateId = null;
    if (!isAdmin){
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      associateId = a?.id || null;
    }
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = incoming.slice(-20).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: typeof m.content === "string" ? m.content : String(m.content || "") })).filter(m => m.content);
    if (!messages.length) return res.status(400).json({ error: "sem mensagem" });
    const tools = isAdmin ? TOOLS_ADMIN : TOOLS_CORRETOR;
    const system = isAdmin ? SYSTEM_ADMIN : SYSTEM_CORRETOR;
    const reply = await chat(messages, tools, system, { isAdmin, user: req.user, associateId });
    res.json({ reply });
  } catch (e){
    logger.error({ err: e.message }, "assistant_error");
    res.status(500).json({ error: "Erro no assistente: " + e.message });
  }
});

r.get("/status", requireAuth, (req, res) => res.json({ configurado: !!API_KEY, model: MODEL, provider: "anthropic" }));

export default r;
