# REGRAS DE NEGÓCIO — CRM Calebe

> Classificação: **CRÍTICA** (não remover) · **NECESSÁRIA** (manter) · **DUPLICADA** · **OBSOLETA** · **INCERTA** (revisão humana).
> Nenhuma regra CRÍTICA/NECESSÁRIA/INCERTA pode ser removida.

## WhatsApp / Meta

| # | Regra | Onde | Classe |
|---|---|---|---|
| 1 | **131049 NÃO blacklista lead.** É teto de marketing POR PESSOA da Meta (só afeta template MARKETING). Blacklistar lead por 131049 já causou 2 incidentes (13/06, 30/06 — revertido 01/07). Só `131026` (número inexistente → `invalid_number`) e `131050` (opt-out → `opted_out`) banem lead permanentemente. | `whatsappCloudWebhook.js` (processStatus) | **CRÍTICA** |
| 2 | **Janela de 24h**: aberta se `now - Conversation.lastInboundAt < 24h`. `lastInboundAt` gravado a CADA inbound no webhook. Mensagem livre dentro da janela NÃO sofre 131049. Fora: template aprovado. | `services/whatsappWindow.js`, webhook ~L318 | **CRÍTICA** |
| 3 | **Resposta sai pelo número em que o lead falou** (`Conversation.inboundPhoneId`). Lead novo: round-robin entre números GREEN (`WHATSAPP_NEW_LEAD_PHONE_IDS` + `data/healthy_phones.json`, cron `_ia_saude_numeros.mjs`). | `services/whatsappCloud.js` (`resolveSendPhoneId`) | **CRÍTICA** |
| 4 | **Números de suporte NUNCA enviam pra lead** (`SUPPORT_ONLY_PHONE_IDS`: 1143966188797246, 1155522184305211). Defesa em múltiplas camadas (filtros + cron + envs). | `whatsappCloud.js` | **CRÍTICA** |
| 5 | Re-engajamento cancela blacklist temporária: lead com `blacklistReason` 131049_temp* que responde é liberado automaticamente. | webhook inbound ~L324 | NECESSÁRIA |
| 6 | Rate-limit transitório no envio livre → retry no MESMO número (backoff 2,5s/7s; códigos 130429/131048/80007/133016). Trocar de número não resolve. | `whatsappCloud.js` sendText | NECESSÁRIA |
| 7 | Templates de "cadastro/registro/pendência" bloqueados comercialmente (soam falsos) → 409 `template_bloqueado`. | `whatsappCloud.js` rota send-template | NECESSÁRIA |
| 8 | Dropdown do corretor mostra só a allowlist (`WHATSAPP_TEMPLATE_ALLOWLIST`); admin bypass `?expose=1`. | idem | NECESSÁRIA |
| 9 | Auto-fill de template: `calebe_corretor_apresenta`/`corretora`/`reabordagem_v1/v2` = [corretor, lead]; `calebe_boas_vindas` = [lead, palavra-por-gênero]; default = [lead…]. | front `chat-v2-api.ts` `templateParams` + `campaignRunner.js` | NECESSÁRIA (duplicada de propósito front/worker — manter em sincronia) |
| 10 | Janela de operação 07:30–19:00 BRT para distribuição automática e notificações a corretor. | `distributionEngine.js`, `associateNotifier.js` | NECESSÁRIA |
| 11 | Fora de horário, envio do corretor gera só AVISO (pedido do gestor: virar bloqueio duro — pendência). | front chat-v2 | INCERTA (pendência de produto) |

## Leads / Distribuição

| # | Regra | Onde | Classe |
|---|---|---|---|
| 12 | **Transferir lead JÁ ATRIBUÍDO exige senha operacional** (obter com gestor) + log em `LeadTransferLog`. Nenhuma instrução cancela esta regra. Atribuir lead LIVRE não exige. | `routes/leads.js` | **CRÍTICA** |
| 13 | Drop no login: corretor APPROVED ganha 30 leads/dia (`lastBulkDropAt` claim atômico), teto de carga 60, assign-only (SEM template automático — 30×N estourava 131049). | `services/loginLeadDrop.js` | NECESSÁRIA |
| 14 | Pool distribuível = livre + NEW + `noWhatsApp=false` + telefone + não-descartado (+ `origin<>MANUAL` no drop automático). | idem + engine | NECESSÁRIA |
| 15 | **Reatribuiu conversa → resetar `accepted:false, acceptedAt:null`** — senão lead "some" (cai em Atendendo do novo dono). Vale pra QUALQUER script novo. | scripts `_distribuir_*.mjs` | **CRÍTICA** |
| 16 | `noWhatsApp=true` → fora de distribuição e de templates. | pool + send-template | **CRÍTICA** |
| 17 | Robô de redistribuição por inatividade DESLIGADO a pedido do admin (06/2026). Não religar sem aprovação. | `server.js` (comentado) | INCERTA (decisão de negócio) |
| 18 | Captação LP: inbound de número desconhecido no WhatsApp oficial CRIA lead (nome=perfil); `#CRECI<n>` na 1ª msg credita ao corretor APPROVED; sem código → bolsão. | webhook `if(!lead)` | NECESSÁRIA |
| 19 | Import de planilha marca `origin=IMPORT` + campanha "Cliente Calebe (lista antiga)". | `routes/webhooks.js` | NECESSÁRIA |

## Privacidade / Acesso

| # | Regra | Onde | Classe |
|---|---|---|---|
| 20 | **Telefone real do lead é mascarado** por padrão; revela com `Conversation.phoneReleased` (fluxo pedido→aprovação) ou `Associate.autoReleasePhone` ou admin/allowlist. | `phoneRelease.js`, `conversations.js` L392 | **CRÍTICA** (LGPD) |
| 21 | `Message.hiddenAt` é INTENCIONAL (ocultar mensagem sem apagar). Não "corrigir". | schema/rotas | **CRÍTICA** |
| 22 | `HIDE_PRE_TRANSFER_HISTORY=0` — histórico pré-transferência VISÍVEL (cortar escondia contexto; banner dá o aviso). | env + conversations | NECESSÁRIA |
| 23 | `commercialOnly=true` → UI trava usuário no painel Ajuda Comercial. Ressalva: gate técnico é ADMIN (least-privilege pendente). | `AdminLayout.tsx`, auth | NECESSÁRIA |
| 24 | Sem emoji de sistema em UI de cliente — ícones SVG de traço (padrão da casa). | front | NECESSÁRIA (estilo) |

## Campanhas (módulo 07/2026)

| # | Regra | Onde | Classe |
|---|---|---|---|
| 25 | Bolsão da campanha exclui NEGOTIATING/CLOSING/CLOSED e "em atendimento ativo" (accepted + msg <2d). | `routes/campaigns.js` | NECESSÁRIA |
| 26 | Runner: claim atômico por recipient (`FOR UPDATE SKIP LOCKED` → status `sending`) — nunca envia 2×; pausável; retoma no boot. | `campaignRunner.js` | **CRÍTICA** |
| 27 | Número RED selecionado → bloqueia disparo (front). Qualidade oficial via Graph `phone_numbers.quality_rating` (cache 5min). | `Campanhas.tsx` + `getPhoneNumbersQuality` | NECESSÁRIA |
| 28 | Resposta de lead a disparo marca `CampaignRecipient=responded` (gatilho da futura roleta). | webhook inbound | NECESSÁRIA |

## Observações de duplicação (consolidáveis com validação)

- Preview de janela/erro do chat existe em ChatV2 e Chat legado (rota `chat-legado`) — candidato a consolidação quando o legado for aposentado (👁).
- Lógica de params de template duplicada por design (front + runner) — se mudar uma, mudar a outra.
