# scripts/ — utilitários operacionais

> Scripts `.mjs` rodados à mão (ou que já foram cron). **NÃO são parte da API.** Rodar sempre de `/root/vaidavenda-calebe/backend` com `node -r dotenv/config scripts/<x>.mjs`. Muitos MEXEM em dados de produção — leia a classificação antes.

## ⚠️ ESTADO DO CRON (auditoria 02/07)

**Todo o cron do backend foi DESLIGADO em 30/06/2026** (linhas `# [OFF ...]` no `crontab -l`). Consequências que ainda valem:

- 🔴 **`_ia_saude_numeros.mjs` (era de hora em hora) → OFF**: o `data/healthy_phones.json` (qualidade GREEN/YELLOW/RED e rodízio de números) **está congelado desde 30/06**. O código usa a qualidade oficial da Meta em algumas telas, mas o rodízio de envio depende desse arquivo (cai no `.env` se >6h). **Decisão pendente: religar** (baixo risco, melhora envio) — pedir aprovação.
- 🟡 **`_distribuir_500_diario.mjs` (9h) → OFF**: distribuição automática diária parada — contribui pro pool vazio.
- ✅ **`_ia_blacklist_131049.mjs` → OFF (MANTER OFF)**: blacklistava lead por 131049, que é ERRADO (ver REGRAS_DE_NEGOCIO #1). Não religar.

## Classificação

### ⛔ NÃO RODAR / não religar
| Script | Motivo |
|---|---|
| `_ia_blacklist_131049.mjs` | blacklista lead por 131049 (throttle de número, não do lead) — proibido |
| `limpar-demo` / qualquer `*limpeza*` / `*devolver_base*` | apagam/descartam base em massa (a "limpeza_meta" de 18/06 descartou 8.218 leads) |

### 🔴 PERIGOSO — reatribui/distribui leads (só com aprovação; SEMPRE reseta `accepted`)
`_distribuir_500_diario.mjs` · `_distribuir_559_top100.mjs` · `_distribuir_ativos.mjs` · `_reclaim_24h_top50.mjs` · `_reclaim_30min.mjs` · `_reverter_72h_inativo.mjs` · `_reativa_lost_respondeu.mjs` · `_marcelo_5frescos.mjs` · `_reativar_marcio.mjs`

> Regra crítica: qualquer reatribuição de conversa TEM que setar `accepted:false, acceptedAt:null` (senão o lead "some" da aba Pendente do novo dono).

### 🟠 SAÚDE / ENVIO (efeito colateral no WhatsApp)
`_ia_saude_numeros.mjs` (atualiza healthy_phones.json — seguro e recomendado religar) · `_resend_failed_audios.mjs` · `_resend_magic_logins.mjs` (reenvia mensagens — confere volume antes)

### 🟢 SOMENTE LEITURA / relatórios (seguros)
`_relatorio_corretores.mjs` · `_relatorio_eder_sdrs.mjs` · `_relatorio_distribuicao_diaria.mjs` · `_relatorio_diario_2pdf.mjs` · `_relatorio_pdf_diario.mjs` · `_relatorio_ia_conversas.mjs` · `_relatorio_ia_calebetech.mjs` · `_saude_report_ricardo.mjs` · `_list_settings.mjs` · `_list_templates.mjs` · `_list_wa_keys.mjs` · `_list_feedback.mjs` · `_find_*.mjs` · `_get_dev.mjs` · `_alertas_ia_responsavel.mjs` · `_avisar_logins_corretores_travados.mjs` · `_nudge_corretores_sem_login.mjs`

### 🔵 ONE-OFF já usados (manter como referência; não re-executar sem motivo)
`_aprovar_pendentes_lote.mjs` · `_create_bello_lead.mjs` · `_create_review_account.mjs` · `_recover_contacts.mjs` · `_clean_feedback.mjs` · `_check_avisos.mjs` · `_check_bello_chat.mjs` · `_dry_voice.mjs` · `reabordagem-blast.mjs` (disparo de template — PERIGOSO se cru) · demais `_*`.

## Regra de ouro
Antes de rodar qualquer script que escreve: (1) faça backup manual (`bash /usr/local/sbin/backup-postgres-calebe.sh`); (2) rode com `--dry` se o script suportar; (3) registre no `docs/CHANGELOG.md`. Na dúvida sobre o que um script faz, LEIA-O — a maioria tem cabeçalho explicando.
