// Layout público · landing sempre em dark (ignora preferência do usuário enquanto
// na área pública pra não vazar branding em modo claro). Quando sair pra área
// autenticada, o store de tema reaplica a preferência salva.
import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useTheme } from "@/store/theme";
import { LoginModal } from "@/features/auth/LoginModal";

export function PublicLayout() {
  const theme = useTheme((s) => s.theme);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    // Força dark no enter sem mexer na preferência do user (não chama setTheme).
    const root = document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
    root.setAttribute("data-theme", "dark");
    // Cleanup: reaplica a preferência salva (light ou dark) quando sair pra /admin etc.
    return () => {
      root.classList.remove("light", "dark");
      root.classList.add(theme);
      root.setAttribute("data-theme", theme);
    };
  }, [theme]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar institucional · logo + Entrar + Cadastro */}
      <header className="bg-app-elevated/40 backdrop-blur border-b hairline">
        <div className="container-site flex items-center justify-between py-4 gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-gold-400 font-bold tracking-tight">
            <span className="w-7 h-7 rounded-sm bg-gold-gradient text-app-canvas font-display text-base flex items-center justify-center">
              C
            </span>
            <span className="text-sm md:text-base">Calebe Investimentos</span>
          </Link>

          <nav className="flex items-center gap-2 md:gap-4">
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs md:text-sm uppercase tracking-mono-wide font-semibold text-gold-300 hover:text-gold-200 transition-colors px-3 py-1.5 rounded border border-gold-400/30 hover:border-gold-400/60"
              aria-label="Entrar no sistema"
            >
              <LogIn size={13} /> Entrar no sistema
            </button>
            <Link
              to="/cadastro"
              className="text-xs md:text-sm uppercase tracking-mono-wide text-sand-100/65 hover:text-gold-400 transition-colors"
            >
              Solicitar participação
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t hairline py-6">
        <div className="container-site text-center text-xs text-sand-100/45">
          © {new Date().getFullYear()} Calebe Investimentos Imobiliários · CRECI 6131J
        </div>
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
