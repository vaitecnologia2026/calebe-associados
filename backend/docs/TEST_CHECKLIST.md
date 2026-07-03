# TEST CHECKLIST — validação manual (não existem testes automatizados)

> Rodar os itens da área afetada ANTES de considerar qualquer mudança concluída. P0 = roda em TODO deploy.

## P0 — Smoke (5 min, todo deploy)

| # | Teste | Como | Esperado |
|---|---|---|---|
| 1 | API viva | `pm2 list`; logs 20 linhas | 4× online, sem erro |
| 2 | Login admin | login web | entra no /admin |
| 3 | Login corretor | conta de teste | entra no /corretor, leads visíveis |
| 4 | Chat carrega | abrir conversa com histórico | mensagens + status corretos |
| 5 | Envio livre (janela aberta) | mandar "teste" numa conversa com inbound <24h | ✓✓ entregue |
| 6 | Campanhas | abrir /admin/campanhas | funil + números carregam |

## P1 — Fluxos críticos (rodar quando a área for tocada)

**Auth:** refresh após expirar access; logout; magic link; role muda → re-login reflete.
**Permissões:** ASSOCIATE não acessa /admin (UI e API — testar API com token de corretor: deve dar 403); commercialOnly cai só em ajuda-comercial.
**Leads:** criar manual; mudar status (todos os estágios); transferir SEM senha → recusa; COM senha → move + LeadTransferLog.
**Importação:** planilha pequena (3 linhas, 1 duplicada) → 2 criados, 1 rejeitado por phoneHash.
**Bolsão/Distribuição:** corretor novo loga → recebe até 30 (pool permitindo); teto 60 respeitado; lead distribuído some do bolsão.
**Templates:** dropdown mostra só allowlist; template bloqueado → 409; template com 2 vars preenche corretor/lead certos (conferir preview).
**Janela 24h:** conversa sem inbound >24h → livre falha/pede template; lead responde → campo libera em tempo real (SSE) e após F5.
**Blacklist:** lead com invalid_number → template recusa 422; lead 131049 → envio PERMITIDO (regra #1!).
**Campanhas:** criar com 3 leads de teste interno → processando persiste ao recarregar; pausar/retomar; resposta marca "responderam" e abre conversa no drawer.
**Captação LP:** abrir `/c/<slug>`, mandar wa.me com #CRECI → lead criado atribuído ao corretor; sem código → lead no bolsão.
**Liberação telefone:** pedir como corretor → aprovar como admin → número real aparece.
**Ajuda Comercial:** pedir no chat → aparece no painel → ciclo até FINALIZADO → botões wa.me corretos.
**Push/Notificações:** lead novo dentro da janela 07:30–19h → corretor notificado.
**Voice:** ligação mascarada conecta e grava (usar telefones do time).
**Imóveis:** criar unidade com valor + à vista; card de anúncio baixa PNG com os dois valores.
**Financeiro/Vendas:** registrar venda → comissão calculada.
**Relatórios:** /admin/analitico números batem com queries de conferência.

## P2 — Não-funcionais

- **Mobile:** chat do corretor em viewport 390px (uso real é majoritariamente celular).
- **Responsividade:** /admin/campanhas e /admin/analitico em tablet.
- **Build:** `vite build` sem erro; bundle único referenciado no index.html; **zero `.map` em public/assets**.
- **Deploy:** checklist do DEPLOY.md.

## Evidência

Para cada rodada registrar: data, quem, commit testado, itens rodados, status (✅/❌/⚠️) e print quando ❌. Sugestão: `docs/test-runs/AAAA-MM-DD.md`.
