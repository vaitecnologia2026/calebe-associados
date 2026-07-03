# ENV_EXAMPLE — variáveis de ambiente do backend

> 75 variáveis. **Nunca commitar valores.** `.env` vive só no servidor. Agrupadas por função.

## Core
| Var | Função |
|---|---|
| NODE_ENV / PORT / LOG_LEVEL | runtime |
| DATABASE_URL / DIRECT_URL | Postgres principal (Prisma) |
| CHAT_DATABASE_URL | banco espelho do chat |
| DATA_ENCRYPTION_KEY | AES dos telefones de leads — **PERDER = perder acesso aos telefones** |
| CORS_ORIGIN | origem permitida do front |
| REDIS_URL | cache/filas (se ativo) |

## Auth
| Var | Função |
|---|---|
| JWT_ACCESS_SECRET / JWT_REFRESH_SECRET | assinar tokens (rotacionar = derruba sessões) |
| JWT_ACCESS_EXPIRES_IN (7d) / JWT_REFRESH_EXPIRES_IN (30d) | validade |
| SEED_DEFAULT_PASSWORD | senha inicial de seed |

## WhatsApp Cloud (Meta)
| Var | Função |
|---|---|
| WHATSAPP_CLOUD_ENABLED | liga/desliga envio Cloud (kill-switch) |
| WHATSAPP_CLOUD_TOKEN | token System User Meta |
| WHATSAPP_WABA_ID / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_GRAPH_VERSION | conta e versão |
| WHATSAPP_APP_SECRET / WHATSAPP_WEBHOOK_VERIFY_TOKEN | segurança do webhook |
| WHATSAPP_NEW_LEAD_PHONE_IDS | rodízio de números p/ lead novo (GREEN) |
| WHATSAPP_SENDABLE_PHONE_IDS | números habilitados a responder conversas |
| WHATSAPP_TEMPLATE_ALLOWLIST | templates visíveis no dropdown do corretor |
| PHONE_DAILY_LIMIT / WARMUP_NEW_PHONES | cota diária por número / aquecimento |

## Distribuição de leads
| Var | Função |
|---|---|
| LOGIN_DROP_SIZE (30; 0=desliga) / LOGIN_DROP_MAX_LEAD_LOAD (60) | drop no login |
| QUOTA_* / RATIO_* (BRONZE/SILVER/GOLD/DIAMOND) | mix por categoria |
| INATIVIDADE_MINUTOS / MAX_REDISTRIBUICOES / REACTIVATION_ENABLED | robôs (inatividade OFF por decisão) |
| LEADS_PHONE_ALLOWLIST | usuários que veem telefone sem liberação |
| HIDE_PRE_TRANSFER_HISTORY (=0) | histórico pré-transferência visível |

## Webhooks / integrações externas
| Var | Função |
|---|---|
| WEBHOOK_LEADS_SECRET | HMAC do `POST /api/webhooks/leads` (tráfego pago — sem produtor hoje) |
| VAI_* (7 vars) | integração VAI legada (fallback envio + suporte IA) |
| SUPPORT_WEBHOOK_TOKEN | rotas `/api/suporte/*` (IA de suporte) |
| DWV_TOKEN / IMOBISEC_API_TOKEN | catálogos de imóveis |
| META_PIXEL_ID / META_CAPI_TOKEN / META_CAPI_VERSION | conversões Meta |
| TWILIO_ACCOUNT_SID / AUTH_TOKEN / FROM_NUMBER | ligação mascarada |
| ANTHROPIC_API_KEY / ANTHROPIC_MODEL | assistente/coach IA |

## Push / mídia
| Var | Função |
|---|---|
| VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT | web push |
| FIREBASE_SERVICE_ACCOUNT_PATH | FCM nativo |
| MINIO_* (6 vars) | storage de mídia (fotos, áudios, docs) |
| NOTIFY_NEWLEAD_WA | template de aviso de lead p/ corretor |

## Operação
| Var | Função |
|---|---|
| RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS | rate limit (verificar aplicação — SEGURANCA #8) |
| RANKING_CUTOFF_AT | corte do ranking |
