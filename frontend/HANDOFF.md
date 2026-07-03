# Calebe — Developer Handoff (Frontend Corretor / Chat Lead)

> **DESIGN-006 · gerado pelo squad-design (ui-engineer + dan-mall)**
> Escopo: app do corretor (React recuperado de sourcemap) + trabalho desta rodada
> (Chat Lead v2 mobile, mural de Avisos, filtros de Imóveis, Dashboard v2, selo da
> janela 24h da Meta). Não há Figma — a "fonte de verdade" é o código em produção.

---

## 0. ⚠️ GOTCHAS CRÍTICOS (leia antes de tocar em CSS)

| # | Regra | Por quê |
|---|---|---|
| 0.1 | **O build NÃO roda Tailwind JIT.** `src/styles/globals.css` é um **snapshot estático** do CSS compilado em produção. **Classes Tailwind NOVAS não funcionam** (ex.: `h-32`, `w-32`, `gap-2.5`, `columns-2`, `ring-2`, `line-clamp-2` — saem silenciosamente sem efeito). | Já causou bugs reais (selo renderizou a 400px). |
| 0.2 | Para estilo novo use **(a) inline `style={{}}`** ou **(b) CSS real num arquivo importado** (ex.: `chat-v2.css`, que o Vite compila de verdade — inclui `@media`, `::before`, etc.). Só reutilize classes Tailwind **que já existam** no globals.css. | Único caminho confiável. |
| 0.3 | **Deploy = arquivos estáticos**, sem CI. `rsync src → build → cp index.html + assets`. Ver §7. | — |
| 0.4 | Janela de 24h da Meta: **não reimplemente a regra** — o backend já entrega `windowOpen` + `lastInboundAt`. O front só reflete. Ver §8. | Evita divergência com o composer. |
| 0.5 | Não rode `npm run build` localmente esperando JIT — a build de produção é a do servidor (`/root/calebe-frontend-src`). | — |

---

## 1. Tech stack

- **React 18 + TypeScript + Vite**
- **react-router-dom v6** (`createBrowserRouter`, `basename` por `import.meta.env.BASE_URL`)
- **zustand** (stores: `@/store/auth`, `@/store/ui`, `@/store/theme`)
- **lucide-react** (ícones) + SVGs inline (`<Ico d=… />` no chat)
- CSS: Tailwind **pré-compilado** (estático) + CSS escopado por feature (`chat-v2.css` sob `.cv2`)
- Backend: Node/Express + Prisma + PostgreSQL (PM2 `calebe-api`, cluster 4 inst., :4000)
- Servido por nginx em `app.calebe.tech` a partir de `/root/vaidavenda-calebe/public/`

---

## 2. Token map (cores / tipografia / espaçamento)

### 2.1 Tokens do Chat (`.cv2` CSS variables — `chat-v2.css`)
| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#04101F` | fundo base (navy) |
| `--bg2` | `#061B2E` | painéis / barras |
| `--panel` / `--panel2` | `#0A2236` / `#0D2A41` | cartões, hover, ativo |
| `--line` | `#15324A` | bordas / divisórias (hairline) |
| `--gold` / `--gold2` / `--gold-dim` | `#DEB96D` / `#C9A961` / `#9A7322` | dourado Calebe (CTA, ativo, destaque) |
| `--cream` / `--cream-dim` | `#F5EFE4` / `#B9C4CE` | texto principal / secundário |
| `--muted` | `#7E91A1` | texto terciário / placeholder |
| `--green` | `#25D366` | "Respondeu" / WhatsApp / sucesso |
| `--blue` | `#4AA3FF` | "Novo lead" / info |
| `--yellow` | `#F2C14E` | "Sem resposta" |
| `--red` | `#E8836B` | erro / "precisa atenção" / descartar |
| `--amber` | `#F2A93B` | aviso de janela / template |
| _(selo janela aberta)_ | `#5fcf80` texto · `#3ec46a` ponto | "Liberado" (verde delicado) |
| _(selo janela fechada)_ | `#d2a35f` | "Janela fechada" (âmbar) |

### 2.2 Classes Tailwind globais existentes (reutilizáveis)
`gold-400` `gold-300` `sand-50` `sand-100/xx` `app-canvas` `app-elevated` `app-subtle` ·
`bg-gold-gradient` · `meta-gold` · `hairline` · `card` · `field-input` `field-label` ·
`btn-base btn-gold btn-outline btn-ghost` · `pill` · `tracking-mono-xwide` `tracking-mono-wide` ·
`font-display` · `tracking-display-tight` · `divider-gold` · `StatusPill` (componente).

### 2.3 Tipografia (chat)
| Estilo | Tamanho | Peso |
|---|---|---|
| Nome do lead (`.it-name`) | 14.5px (→13.5 no mobile) | 700 |
| Prévia (`.it-msg`) | 13px (→12 mobile, ellipsis 1 linha) | 400/600 |
| Tags (`.tag`) | 10.5px (→9.5 mobile) | 600 |
| Bolha de mensagem (`.bub`) | 14.5px | 400 |
| Selo janela (`.winbadge`) | 10.5px (12 no header `.big`) | 600 |

### 2.4 Espaçamento — **usar valores que já existem** ou inline.
Padrões do chat: item `12px 16px` (→`10px 12px` mobile), gap `12px` (→`10px`), raio `10–14px`.
Grids responsivos por **inline style** (sem media query Tailwind):
- Imóveis: `gridTemplateColumns: repeat(auto-fill, minmax(210px, 1fr))`
- Avisos (mural): `repeat(auto-fill, minmax(208px, 1fr))`

---

## 3. Inventário de componentes

### Existentes / reaproveitados
`PageHeader`, `Modal`, `StatusPill`, `Button`, `Sidebar`, `MobileDrawer`, `SessionBar`
(hambúrguer `md:hidden` que abre o drawer), `NovaVendaModal`, `SimuladorModal`, `LpLinkModal`,
`DevelopmentFolderModal`.

### Chat Lead v2 (`features/corretor/chat-v2/ChatV2.tsx` + `chat-v2.css`)
| Componente | Papel |
|---|---|
| `CorretorChatV2` | container `.cv2` → `.app` (grid `380px 1fr`) |
| `.list` | head (brand + busca), `.tabs` (Atendendo/Pendente), `.scroll` (itens), `.addbtn` |
| `.item` | `strip` + `av`(+`wa`) + `it-body`(it-top/it-prev/it-meta) + `it-accept` + **`WindowBadge`** |
| `ChatView` | `.chat-head` (back + nome + status + ligar + menu ⋮ + stages) + `.msgs-wrap` + composer |
| `WindowBadge` ⭐novo | selo da janela 24h: `open`(verde+contagem) / `closed`(âmbar) / `none`(cinza) |
| `AcceptBar` ⭐alterado | banner de lead não-aceito + **botão "Aceitar lead" embutido** (essencial no mobile) |
| `ComposerOpen` | texto + áudio (MediaRecorder) + anexo + picker de imóvel (`/`) |
| `ComposerClosed` | picker de templates (janela fechada) |
| `CallModal` / `ActionModal` / `AddLeadModal` / `DocCard` | ligação, vincular/fechamento/descartar, lead manual, anexo |

### Mural de Avisos (`features/corretor/routes/Avisos.tsx`) ⭐novo
`CorretorAvisos` (grid auto-fill) · `MuralTile` (quadrado: capa imagem/vídeo/thumb YT **ou** cartão de
texto dourado; selo NOVO; `CalebeAvatar`; overlay de Play) · `FullPost` (lightbox via `Modal`).

### Imóveis (`features/corretor/routes/Imoveis.tsx`) ⭐alterado
Barra de **Filtros por perfil** destacada (dourada) no topo + `FilterChip` (toggle) + cards de unidade
com linha de perfil (`tipo · qtos · suítes · vagas · m²`) + seção Empreendimentos abaixo.

### Dashboard v2 (`features/corretor/routes/DashboardV2.tsx`) ⭐novo (é o `/corretor` index)
Hero (fachada Calebe `/img/dash-hero.jpg` + overlay navy) · CTA Chat Lead · KPIs · Estrutura · Suporte.

---

## 4. Interações

| Elemento | Comportamento |
|---|---|
| **Selo janela 24h** | conta de `lastInbound + 24h`; `>1h` → "fecha em 23h 47min", `<1h` → "47:12" (tick 1s); reflete `c.win`; **reabre sozinho** quando chega novo inbound (polling recalcula) |
| **Aceitar lead** | 2 caminhos: botão `.it-accept` no card **ou** botão na `AcceptBar` dentro da conversa → `acceptConv()` → libera o composer |
| **Navegação mobile (single-pane)** | abrir conversa → `document.body.classList.add('cv2-viewing')` → `.list` some, `.chat` aparece; botão `.back` volta |
| **Polling (tempo real)** | lista a cada **15s**; conversa aberta a cada **8s** |
| **Composer `/`** | digitar `/` abre picker de imóveis; insere `🏠 *nome* — local / 💰 preço / 🔗 app.calebe.tech/imovel/{code}` |
| **Áudio** | `MediaRecorder` → blob → `sendAudio`; player com `audioSources()` (MIME correto p/ iOS) |
| **Template send** | `doTemplate`: 1 var → nome do lead; `calebe_corretor_apresenta` (2 vars) → `[corretor, cliente]` |
| **Mural tile → FullPost** | tap abre lightbox; **abrir = marcar como lido** (auto) |

### Estados (transições)
- `.tab` default→on: `background:transparent→var(--gold)`, `color:cream-dim→#04101F`.
- `.item` hover→active: `panel → panel2`.
- `.it-accept` / `.btn-gold` hover: `--gold → --gold2`.
- `.winbadge.open` ponto: `box-shadow 0 0 0 3px rgba(62,196,106,.16)` (glow sutil).
- Sem `:focus-visible` custom no chat → **pendência de acessibilidade** (ver §6).

---

## 5. Responsivo

| Breakpoint | Mudanças |
|---|---|
| Base (desktop) | `.app` grid `380px 1fr` (lista + conversa lado a lado) |
| `@media ≤820px` | **single-pane** (lista OU conversa); `.back` visível; `overflow-x:hidden` em list/scroll/item/tabs |
| `@media ≤600px` | fontes/tags compactas; avatar 48→42; abas compactas; `.it-accept` compacto; `.wbanner` quebra linha + botão Aceitar **largura total**; `padding-bottom: env(safe-area-inset-bottom)` no `.addbtn` e `.composer` |
| Layout root | `CorretorLayout`: `height:100dvh` (inline) com `h-screen`=100vh de fallback → corrige barra do navegador móvel cobrindo conteúdo |

Testar em **360 / 390 / 430px**. (⚠️ o Chrome MCP local não desce abaixo da largura mínima da janela → validar no device real.)

---

## 6. Acessibilidade (specs + pendências)

- Hambúrguer: `min-w/h 44px` (WCAG/HIG) ✓ · `aria-label="Menu"` ✓
- Dropdown SessionBar: `role=menu/menuitem`, fecha com Esc + clique-fora ✓
- Contraste: cream `#F5EFE4` sobre navy `#04101F` ≈ 15:1 ✓; verde `#5fcf80` sobre navy ≈ 7:1 ✓; **âmbar `#d2a35f` sobre navy ≈ 5.6:1** ✓
- **Pendências:** sem `:focus-visible` consistente nos itens/composer do chat; tiles do mural são `<button>` (ok) mas sem `aria-label` descritivo; player de áudio sem rótulo. → backlog.

---

## 7. Pipeline de deploy (sem CI)

```bash
# 1. sobe o src pro servidor
rsync -az /tmp/calebe-fe-work/src/ root@187.77.251.196:/root/calebe-frontend-src/src/
# 2. build (Vite, base / para prod)
ssh … 'cd /root/calebe-frontend-src && npm run build'
# 3. publica (backup + index.html + assets — NUNCA copiar .map)
ssh … 'cd /root/vaidavenda-calebe/public && cp index.html index.html.bak.$(date +%s) \
        && cp /root/calebe-frontend-src/dist/index.html index.html \
        && cp /root/calebe-frontend-src/dist/assets/*.js dist/assets/*.css assets/'
# 4. git commit no repo do front
```
- nginx serve `public/` em `/`; `/api/` e `/midias/` → :4000; SPA fallback `try_files … /index.html`.
- Cache: `index.html` = `max-age=300, must-revalidate` → usuários pegam bundle novo em ≤5 min (ou F5).
- Bundle é hasheado (`index-XXXX.js`) → trocar a referência no `index.html` invalida cache.

---

## 8. Integração WhatsApp / Meta (regra da janela + templates)

- **WABA** `910162028578816` · **phone_number_id** `1055327477675105` · **Graph** `v25.0` (env `backend/.env`).
- **Janela 24h:** abre/zera a cada **inbound do cliente**; dentro → mensagem livre; fora → só template.
  Backend entrega `windowOpen` + `lastInboundAt` em `/api/conversations`. Front: selo + `ComposerOpen`/`ComposerClosed`.
- **Templates:** criados via Graph API (`POST {WABA}/message_templates`, categoria MARKETING p/ abordagem).
  Liberação pro corretor = **`WHATSAPP_TEMPLATE_ALLOWLIST`** no `backend/.env` (filtra o dropdown) →
  `pm2 reload calebe-api --update-env`. Só aparecem se **APPROVED** na Meta.
- Regras Meta: variável **não** pode iniciar/terminar o corpo; exige `example.body_text`.
- ⚠️ MARKETING em massa sofre throttle por usuário (erro 131049). 1‑a‑1 entrega normal.

---

## 9. QA checklist (verificação da implementação)

- [ ] **Mobile 360/390/430:** hambúrguer visível abre o menu; sem rolagem horizontal; "Adicionar lead manual" acima da barra do navegador.
- [ ] **Aceitar:** botão aparece no card (pendente) **e** na conversa aberta; ao aceitar, o composer aparece.
- [ ] **Selo janela:** verde com contagem quando aberto; "Janela 24h fechada" após 24h; "Sem resposta" se nunca respondeu; reabre ao chegar novo inbound.
- [ ] **Composer:** texto/áudio/anexo/`/`-imóvel funcionam quando janela aberta; templates aparecem quando fechada.
- [ ] **Templates:** os allowlistados + APPROVED aparecem no dropdown; `calebe_corretor_apresenta` renderiza `{corretor}`+`{cliente}` certo.
- [ ] **Mural Avisos:** grade responsiva; vídeo/imagem/texto renderizam; abrir post marca lido; lightbox fecha.
- [ ] **Imóveis:** filtro no topo (dourado) filtra (cidade/tipo/preço/dorm/suíte); sem duplicar "m²".
- [ ] **Dashboard:** `/corretor` abre a recepção premium (hero fachada); CTA Chat Lead navega.
- [ ] **Regressão:** áudio toca no celular; sessão não cai; deploy não copiou `.map`.

---

## 10. Handoff estruturado (YAML)

```yaml
handoff:
  creators: [ui-engineer, dan-mall]
  tech_stack: "React 18 + Vite + react-router v6 + zustand + lucide-react"
  design_system: "Calebe (navy #04101F + dourado #DEB96D) — Tailwind pré-compilado + chat-v2.css escopado (.cv2)"
  critical_constraint: "Build SEM Tailwind JIT — classes novas não funcionam; usar inline style ou CSS real importado"
  components:
    existing: [PageHeader, Modal, StatusPill, Button, Sidebar, MobileDrawer, SessionBar, NovaVendaModal]
    variants_needed: [AcceptBar (com botão Aceitar embutido), Imoveis (barra de filtros no topo)]
    new_required: [WindowBadge, FilterChip, MuralTile, FullPost, CalebeAvatar, DashboardV2]
  token_map:
    colors:
      - { design_value: "#DEB96D", token: "--gold", usage: "CTA, aba ativa, destaque" }
      - { design_value: "#04101F", token: "--bg", usage: "fundo navy base" }
      - { design_value: "#5fcf80", token: "winbadge.open", usage: "Liberado (verde delicado)" }
      - { design_value: "#d2a35f", token: "winbadge.closed", usage: "Janela fechada (âmbar)" }
      - { design_value: "#25D366", token: "--green", usage: "Respondeu / sucesso" }
      - { design_value: "#4AA3FF", token: "--blue", usage: "Novo lead" }
    typography:
      - { design_style: "nome do lead", token: ".it-name 14.5/700 (13.5 mobile)" }
      - { design_style: "selo janela", token: ".winbadge 10.5/600" }
    spacing:
      - { design_value: "12px 16px", token: ".item padding (10px 12px mobile)" }
      - { design_value: "auto-fill minmax(208/210px)", token: "grids Mural/Imóveis (inline)" }
  interactions:
    state_transitions:
      - { element: ".tab", states: "default → on (bg gold, texto navy)" }
      - { element: ".it-accept/.btn-gold", states: "hover: gold → gold2" }
    micro_interactions:
      - { trigger: "tick do selo", animation: "contagem regressiva", duration: "1000ms", easing: "—" }
      - { trigger: "selo aberto", animation: "glow do ponto", duration: "—", easing: "box-shadow estático" }
    keyboard:
      tab_order: ["hambúrguer", "busca", "abas", "itens", "composer", "enviar"]
      shortcuts: ["Enter: envia (fora do picker)", "Esc: limpa /-picker / fecha dropdown"]
  responsive:
    breakpoints: ["820px (single-pane)", "600px (compactação celular)"]
    adaptations:
      - { breakpoint: "820px", changes: ["lista OU conversa", "back button", "overflow-x:hidden"] }
      - { breakpoint: "600px", changes: ["fontes -1px", "avatar 42", "Aceitar largura total", "safe-area-inset"] }
      - { breakpoint: "root", changes: ["100dvh com fallback 100vh"] }
  assets:
    icons: ["lucide-react", "SVG inline <Ico>"]
    images: ["/img/dash-hero.jpg (fachada)", "/img/selo-calebe.png", "thumbs YT img.youtube.com/vi/{id}/hqdefault.jpg"]
    fonts: ["Plus Jakarta Sans (chat)", "display Tailwind global"]
  dev_review_notes:
    - "Tailwind JIT desligado é a regra #1 — toda nova UI por inline/CSS real"
    - "Janela 24h: backend é a fonte (windowOpen) — front só reflete + conta"
    - "Aceitar precisa estar DENTRO da conversa (mobile esconde a lista)"
    - "Deploy manual: nunca copiar .map; sempre backup do index.html"
  qa_checklist: ["ver §9"]
```

---

_Revisão dev: pendências de acessibilidade (`:focus-visible`, aria-labels) e validação mobile em
device real (tooling não renderiza < largura mínima de janela). Prioridade de implementação já em
produção; este doc serve para manutenção/extensão._
