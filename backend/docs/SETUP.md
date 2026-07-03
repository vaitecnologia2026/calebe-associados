# SETUP — ambiente de desenvolvimento

> Hoje NÃO existe ambiente local completo (o time editava no servidor). Recomendado montar local assim:

## Backend

```bash
git clone git@github.com:calebe-investimentos-imobiliarios/calebe-backend.git
cd calebe-backend
npm install
# criar .env a partir de docs/ENV_EXAMPLE.md (pedir valores ao gestor; NUNCA copiar o .env de produção inteiro)
# subir um Postgres local:
docker run -d --name calebe-pg -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=calebe postgres:16
npx prisma generate
npx prisma db push          # cria o schema no banco local VAZIO (nunca contra produção)
node src/server.js          # ou: npx nodemon src/server.js
```

Mínimo pra subir: DATABASE_URL, JWT_*_SECRET, DATA_ENCRYPTION_KEY, PORT. `WHATSAPP_CLOUD_ENABLED=false` desliga envio real (essencial em dev!).

## Frontend

```bash
git clone git@github.com:calebe-investimentos-imobiliarios/calebe-frontend.git
cd calebe-frontend
npm install
npm run dev        # Vite; apontar lib/api.ts API_BASE pro backend local
npm run build      # produção
```

## Acesso ao servidor (produção)

- `ssh root@app.calebe.tech` (chave SSH — pedir ao gestor; trocar chaves na entrada do time — SEGURANCA §rotação).
- Backend em `/root/vaidavenda-calebe/backend`, front-src em `/root/calebe-frontend-src`, build servido em `/root/vaidavenda-calebe/public`.

## Regras de ouro em dev

1. `WHATSAPP_CLOUD_ENABLED=false` local — jamais disparar mensagem real de dev.
2. Nunca apontar Prisma local para o banco de produção.
3. Nunca rodar `prisma studio` no servidor (incidente 02/07 — ver SEGURANCA.md).
4. Toda mudança: commit → push → deploy (ver DEPLOY.md). Não editar direto em produção.
