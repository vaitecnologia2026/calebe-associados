// scripts/seed_push_notification_settings.mjs
// Popula PushNotificationSetting com os 24 eventos pusháveis do sistema.
// Default: isActive=true em todos. Idempotente (upsert) — preserva o estado
// (isActive) de eventos já existentes; só atualiza label/description/category.
//
// Uso:  node scripts/seed_push_notification_settings.mjs

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const EVENTS = [
  // -------- Leads --------
  { key: "lead.captured",          category: "Leads",         label: "Lead novo capturado",          description: "Lead novo entrou no sistema via webhook/funil externo (ainda sem dono). Push enviado aos administradores." },
  { key: "lead.assigned",          category: "Leads",         label: "Lead atribuído",               description: "Admin atribuiu um lead específico ao corretor." },
  { key: "lead.disputed",          category: "Leads",         label: "Lead em disputa",              description: "Lead aberto pra disputa entre os corretores top-N online." },
  { key: "lead.distributed",       category: "Leads",         label: "Lead distribuído automático",  description: "Fila automática diária atribuiu um lead ao corretor." },
  { key: "lead.distributed_extra", category: "Leads",         label: "Lead distribuído manual",      description: "Admin distribuiu lead avulso (modo \"extra\")." },
  { key: "lead.redistributed",     category: "Leads",         label: "Lead redistribuído",           description: "Worker reatribuiu o lead por inatividade do corretor (20+ min sem contato)." },
  { key: "lead.replied",           category: "Leads",         label: "Lead respondeu",               description: "Lead enviou nova mensagem no WhatsApp." },

  // -------- Vendas --------
  { key: "sale.submitted",         category: "Vendas",        label: "Venda enviada pro jurídico",   description: "Corretor submeteu venda pra análise jurídica." },
  { key: "sale.approved",          category: "Vendas",        label: "Venda aprovada",               description: "Jurídico aprovou a venda submetida pelo corretor." },

  // -------- Comissões --------
  { key: "commission.created",     category: "Comissões",     label: "Comissão criada",              description: "Comissão gerada automaticamente após aprovação da venda." },
  { key: "commission.approved",    category: "Comissões",     label: "Comissão aprovada",            description: "Admin liberou a comissão para pagamento." },
  { key: "commission.paid",        category: "Comissões",     label: "Comissão paga",                description: "Admin confirmou o pagamento da comissão." },

  // -------- Telefones --------
  { key: "phone_release.approved", category: "Telefones",     label: "Telefone liberado",            description: "Admin aprovou a liberação do telefone do lead." },
  { key: "phone_release.denied",   category: "Telefones",     label: "Liberação de telefone negada", description: "Admin negou a liberação do telefone do lead." },

  // -------- Visitas --------
  { key: "visit.scheduled",        category: "Visitas",       label: "Visita agendada",              description: "Corretor criou um novo agendamento de visita." },
  { key: "visit.confirmed",        category: "Visitas",       label: "Visita confirmada",            description: "Visita marcada como confirmada." },
  { key: "visit.done",             category: "Visitas",       label: "Visita realizada",             description: "Visita marcada como concluída." },

  // -------- Imóveis --------
  { key: "property.created",       category: "Imóveis",       label: "Imóvel cadastrado",            description: "Novo imóvel cadastrado no sistema." },
  { key: "property.approved",      category: "Imóveis",       label: "Imóvel aprovado",              description: "Admin aprovou o imóvel submetido pelo corretor." },
  { key: "property.denied",        category: "Imóveis",       label: "Imóvel reprovado",             description: "Admin reprovou o imóvel submetido pelo corretor." },

  // -------- Avisos --------
  { key: "announcement.created",   category: "Avisos",        label: "Aviso publicado",              description: "Admin publicou um novo aviso (broadcast ou segmentado)." },
  { key: "notification.custom",    category: "Avisos",        label: "Aviso direto do admin",        description: "Admin enviou um aviso/recado avulso direto para um corretor." },

  // -------- Suporte/Admin --------
  { key: "assist.requested",       category: "Suporte/Admin", label: "Pedido de suporte aberto",     description: "Corretor pediu ajuda em uma conversa — admins recebem o pedido." },
  { key: "feedback.submitted",     category: "Suporte/Admin", label: "Feedback recebido",            description: "Usuário enviou feedback ou reportou problema — admins são notificados." },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const ev of EVENTS) {
    const existing = await db.pushNotificationSetting.findUnique({ where: { key: ev.key } });

    if (!existing) {
      await db.pushNotificationSetting.create({
        data: {
          key: ev.key,
          label: ev.label,
          description: ev.description,
          category: ev.category,
          isActive: true,
        },
      });
      created += 1;
    } else {
      // Preserva isActive (decisão do admin). Atualiza só metadados.
      await db.pushNotificationSetting.update({
        where: { key: ev.key },
        data: {
          label: ev.label,
          description: ev.description,
          category: ev.category,
          updatedAt: new Date(),
        },
      });
      updated += 1;
    }
  }

  const total = await db.pushNotificationSetting.count();
  console.log(`[seed_push_notification_settings] criados=${created} atualizados=${updated} total=${total}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
