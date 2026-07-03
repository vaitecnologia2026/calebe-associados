# Integração VAI · WhatsApp

## Configuração (.env)

```bash
VAI_API_BASE_URL=https://api.vaicrm.com.br
VAI_API_TOKEN=seu_token_bearer
VAI_INSTANCE_ID=id_da_instancia
VAI_SENDER_PHONE=5547999999999
VAI_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

## Endpoints consumidos

Implementados em `src/services/vaiClient.js`. Paths são **placeholders** (ajustar conforme `https://api.vaicrm.com.br/docs#`):

| Função | Path esperado | Uso |
|---|---|---|
| `vaiSendMessage` | `POST /v1/messages` | Enviar mensagem do associado ao lead |
| `vaiCreateContact` | `POST /v1/contacts` | Registrar lead como contato |
| `vaiListConversations` | `GET /v1/conversations` | Sincronização |
| `vaiGetConversation` | `GET /v1/conversations/:id` | Histórico |

Todas usam `Authorization: Bearer ${VAI_API_TOKEN}`.
Wrapper `vaiSendSafe()` captura erros e não bloqueia o envio do CRM.

## Webhook da VAI (inbound)

URL: `https://seudominio.com/api/webhooks/vai`
Cadastrar no painel VAI com:
- Header de assinatura: `x-vai-signature`
- Secret: mesmo valor de `VAI_WEBHOOK_SECRET`
- Eventos: `message.received`, `message.status`, `conversation.updated`

O handler:
1. Valida HMAC-SHA256 do body
2. Grava `WebhookInboundLog` (imutável · auditoria)
3. Se for `message.received` com `conversation_id` conhecida → cria `Message` inbound

## Teste local (sem domínio público)

Túnel ngrok:
```bash
ngrok http 4000
```
Use a URL HTTPS gerada no campo webhook da VAI.

Teste envio manual:
```bash
SECRET=$VAI_WEBHOOK_SECRET
BODY='{"event":"message.received","conversation_id":"abc","from":"5547988887777","text":"Olá"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

curl -X POST http://localhost:4000/api/webhooks/vai \
  -H "Content-Type: application/json" \
  -H "x-vai-signature: $SIG" \
  -d "$BODY"
```

Resposta esperada: `200 {"ok":true}`.
No banco, `SELECT * FROM "WebhookInboundLog" WHERE source='vai' ORDER BY "createdAt" DESC LIMIT 1;` mostra `status = PROCESSED`.

## Erros comuns

| Erro | Solução |
|---|---|
| `503 vai_webhook_disabled` | `VAI_WEBHOOK_SECRET` vazio no .env |
| `401 invalid_signature` | Secret no painel VAI ≠ do servidor |
| `vai_error 401` em outbound | `VAI_API_TOKEN` inválido/expirado |
| Mensagem enviada sem chegar | Telefone sem formato E.164 (use `normalizePhone()`) |

## Boas práticas

- Rotacionar `VAI_API_TOKEN` e `VAI_WEBHOOK_SECRET` a cada 90 dias
- Monitorar `SELECT status, COUNT(*) FROM "WebhookInboundLog" GROUP BY status` — alerta se % REJECTED subir
- Rate limit do outbound: VAI pode retornar `429` · implementar backoff exponencial em produção alta
- Telefones sempre em E.164 antes de enviar
- Mascaramento do associado é feito pelo CRM, não pela VAI (regra de negócio Calebe)
