// TEMP · rota de validação visual isolada (/preview-chat-v2) — REMOVER antes de produção.
// Replica EXATAMENTE a estrutura do CorretorLayout (mesmas classes/flex) com um shell
// fake (sem auth), só pra conferir o encaixe/altura/escopo-CSS do chat dentro do layout.
// Sem login, a lista dá 401 → mostra a barra de erro + estado vazio, mas o "chrome"
// (lista, abas, busca, painel, composer) renderiza pra inspeção visual.
import { CorretorChatV2 } from "./ChatV2";

export function PreviewChatV2() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* fake SessionBar (56px) */}
      <div className="shrink-0 flex items-center px-5" style={{ height: 56, background: "#061B2E", borderBottom: "1px solid #15324A" }}>
        <span style={{ color: "#DEB96D", fontWeight: 800, fontFamily: "Georgia, serif", fontSize: 18 }}>Calebe</span>
        <span style={{ marginLeft: 10, color: "#7E91A1", fontSize: 12 }}>PREVIEW · /preview-chat-v2 (sem login → lista vazia)</span>
      </div>
      <div className="flex-1 flex min-h-0">
        {/* fake Sidebar (menu) */}
        <aside className="hidden md:flex shrink-0 flex-col" style={{ width: 240, background: "#04101F", borderRight: "1px solid #15324A" }}>
          {["Dashboard", "Chat Lead", "Disputas", "Imóveis", "Avisos", "Estrutura Premium", "Visitas", "Vendas", "Jurídico", "Financeiro", "Suporte", "Meu Perfil"].map((m, i) => (
            <div key={i} style={{ padding: "11px 18px", color: m === "Chat Lead" ? "#DEB96D" : "#B9C4CE", fontSize: 13.5, fontWeight: m === "Chat Lead" ? 700 : 500, background: m === "Chat Lead" ? "rgba(222,185,109,.1)" : "transparent" }}>{m}</div>
          ))}
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto">
          <CorretorChatV2 />
        </main>
      </div>
    </div>
  );
}
