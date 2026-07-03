# UX & FUNCIONALIDADE — achados (2026-07-02)

> Prioridade: P1 alto impacto · P2 médio · P3 baixo.

| Tela/Fluxo | Problema | Impacto | Correção recomendada | Prio |
|---|---|---|---|---|
| Todo o app | **Corretor precisa de F5 após cada deploy** (bundle content-hash sem version-check) — origem recorrente de "bug já corrigido continua acontecendo" | corretores reportam bugs fantasmas; suporte sobrecarregado | version-check (comparar hash do index.html a cada N min → toast "nova versão, recarregar") | **P1** |
| Chat corretor | Não há coluna/quadro "Negociando" — estágio muda por chips, mas corretor "perde de vista" o lead qualificado (origem do "lead sumiu") | percepção de perda de lead | Kanban do monitoramento (spec já escrita — ChatMonitorV2 redesign) e/ou aba por estágio no chat | **P1** |
| Mobile (PWA/app) | Senha não persiste em alguns iPhones (caso Magda); fluxo de reinstalação confuso | corretor travado fora | investigar storage do PWA + botão "esqueci a senha" self-service | **P1** |
| Admin | Duas gerações convivendo (Dashboard×DashboardV2, ChatMonitor×V2, chat-legado) sem indicação de qual usar | confusão de operação e treinamento | rotular "LEGADO" no menu; medir uso (PLANO B1) e aposentar | P2 |
| Erros de envio | Toasts hoje traduzem códigos Meta, mas balão "✗ não entregue" não diz o motivo por extenso no mobile | corretor reenvia à toa e "queima" template | tooltip/motivo no long-press mobile | P2 |
| Campanhas | Falta filtro/segmentação do bolsão (cidade, origem, idade do lead) ao criar campanha | disparo pouco segmentado = mais 131049 | filtros no criador (cidade/origem/faixa de criação) | P2 |
| Liberação de telefone | Corretor não vê status do pedido em tempo real (só quando aprovado) | ansiedade/re-pedidos | badge "pendente" na conversa | P3 |
| Importar leads (Campanhas) | textarea Nome,telefone sem validação visual por linha | erros silenciosos de formato | preview com validação linha-a-linha antes de confirmar | P3 |
| Admin Analítico | Denso para não-técnicos (jargão 131049 etc.) | gestor depende de dev p/ interpretar | glossário inline/tooltips | P3 |

## Jornadas — estado geral

- **Corretor (mobile-first):** chat v2 sólido (janela em tempo real, templates com preview, áudio, unread, aceitar→topo). Dores: F5, visibilidade de estágio, senha PWA.
- **Gestor/Admin:** cobertura ampla (aprovação→distribuição→monitoramento→campanhas→analítico). Dor: duplicação legado×v2.
- **Supervisor comercial (commercialOnly):** jornada enxuta e funcional (painel único + wa.me).
- **Suporte:** IA de CRECI/reset no WhatsApp funciona; sem painel dedicado de tickets (usa chat + feedback).
