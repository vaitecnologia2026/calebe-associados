// Magic link · primeiro acesso · /primeiro-acesso?token=XXX
//   1. GET /api/auth/magic/:token → valida e retorna name + emailMasked
//   2. POST /api/auth/magic/redeem { token, password } → cria senha e abre sessão
//   3. setAuth + restoreSession + navigate pra persona certa

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Eye, EyeOff, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { api, setAuth } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { ROLE_MAP, type AuthResponse } from "@/types/auth";
import { ApiError } from "@/types/api";

const LOGO_URL = "https://d78txhfo8gp8r.cloudfront.net/calebe/arquivos/logo.png";

interface ValidationInfo {
  ok: true;
  name: string;
  firstName: string;
  emailMasked: string;
  expiresAt: string;
}

type Stage =
  | { kind: "validating" }
  | { kind: "no_token" }
  | { kind: "invalid"; reason: string }
  | { kind: "ready"; info: ValidationInfo }
  | { kind: "redeeming"; info: ValidationInfo }
  | { kind: "done" };

const ERROR_LABEL: Record<string, string> = {
  invalid_token: "Link inválido ou já expirado. Solicite um novo acesso ao administrador.",
  missing_token: "Link incompleto. Use o botão recebido no WhatsApp.",
  token_expired: "Este link expirou. Solicite um novo acesso ao administrador.",
  token_already_used: "Este link já foi usado. Faça login com a senha que você criou.",
  user_inactive: "Sua conta está inativa. Fale com o administrador.",
  validation: "A senha precisa ter pelo menos 8 caracteres.",
};

function pickError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = (err.data as { error?: string })?.error || "";
    return ERROR_LABEL[code] || `Falha ao validar (${err.status || "rede"}).`;
  }
  return "Não foi possível conectar. Tente novamente em alguns segundos.";
}

export function PrimeiroAcesso() {
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() || "";
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(() =>
    token ? { kind: "validating" } : { kind: "no_token" }
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 1. Valida token ao carregar
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await api.get<ValidationInfo>(
          `/api/auth/magic/${encodeURIComponent(token)}`,
          { skipAuth: true }
        );
        if (cancelled) return;
        setStage({ kind: "ready", info });
      } catch (err) {
        if (cancelled) return;
        setStage({ kind: "invalid", reason: pickError(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (password.length < 8) {
      setFormError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password.length > 128) {
      setFormError("A senha não pode ter mais de 128 caracteres.");
      return;
    }
    if (password !== confirm) {
      setFormError("As senhas não conferem.");
      return;
    }
    if (stage.kind !== "ready") return;
    const currentInfo = stage.info;
    setStage({ kind: "redeeming", info: currentInfo });
    try {
      const data = await api.post<AuthResponse & { firstAccess: boolean }>(
        "/api/auth/magic/redeem",
        { token, password },
        { skipAuth: true }
      );
      setAuth({ accessToken: data.accessToken, user: data.user });
      const roleEntry = ROLE_MAP[data.user.role] ?? ROLE_MAP.ASSOCIATE;
      useAuth.setState({
        user: data.user,
        accessToken: data.accessToken,
        roleEntry,
        bootStatus: "ready",
      });
      setStage({ kind: "done" });
      const dest =
        roleEntry.persona === "admin" ? "/admin" :
        roleEntry.persona === "corretor" ? "/corretor" :
        roleEntry.persona === "dev" ? "/dev" :
        roleEntry.persona === "colab" ? "/colab" : "/";
      setTimeout(() => navigate(dest, { replace: true }), 600);
    } catch (err) {
      setStage({ kind: "ready", info: currentInfo });
      setFormError(pickError(err));
    }
  }

  return (
    <div className="min-h-screen bg-app-bg text-sand-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-app-elevated/95 border hairline rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <img src={LOGO_URL} alt="Calebe Associados" className="h-9 w-auto" />
          <div className="flex-1">
            <h1 className="text-base font-semibold leading-tight">Primeiro acesso</h1>
            <p className="text-xs text-sand-100/55">Defina sua senha pra entrar no sistema</p>
          </div>
        </div>

        {stage.kind === "validating" && (
          <div className="flex items-center gap-2 text-sand-100/70 py-8 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Validando seu link…</span>
          </div>
        )}

        {stage.kind === "no_token" && (
          <div className="rounded-lg bg-danger/15 border border-danger/40 px-4 py-3 text-sm flex gap-2">
            <AlertTriangle className="h-5 w-5 text-danger shrink-0" />
            <div>
              Link incompleto. Use o botão "Acessar agora" enviado por WhatsApp.
            </div>
          </div>
        )}

        {stage.kind === "invalid" && (
          <div className="rounded-lg bg-danger/15 border border-danger/40 px-4 py-3 text-sm flex gap-2">
            <AlertTriangle className="h-5 w-5 text-danger shrink-0" />
            <div>
              <div className="font-medium mb-1">Não conseguimos validar este link</div>
              <div className="text-danger/90">{stage.reason}</div>
              <button
                type="button"
                onClick={() => navigate("/", { replace: true })}
                className="mt-3 text-sm underline text-danger hover:opacity-80"
              >
                Voltar pra página inicial
              </button>
            </div>
          </div>
        )}

        {(stage.kind === "ready" || stage.kind === "redeeming") && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-lg bg-app-subtle/60 border hairline px-4 py-3 text-sm">
              <div className="text-sand-100/80">Olá, <span className="font-semibold text-sand-50">{stage.info.firstName}</span></div>
              <div className="text-xs text-sand-100/55 mt-1">Conta: {stage.info.emailMasked}</div>
            </div>

            <div>
              <label className="block text-xs font-medium text-sand-100/70 mb-1">Nova senha</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  className="field-input pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                  autoComplete="new-password"
                  autoFocus
                  disabled={stage.kind === "redeeming"}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 px-3 text-sand-100/55 hover:text-sand-50"
                  tabIndex={-1}
                  aria-label={showPw ? "Esconder senha" : "Mostrar senha"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-sand-100/70 mb-1">Confirmar senha</label>
              <input
                type={showPw ? "text" : "password"}
                className="field-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="repita a senha"
                autoComplete="new-password"
                disabled={stage.kind === "redeeming"}
              />
            </div>

            {formError && (
              <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-xs text-danger flex gap-2">
                <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={stage.kind === "redeeming"}
              className="btn-base btn-gold w-full disabled:opacity-60 disabled:cursor-wait"
            >
              {stage.kind === "redeeming" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Criando sua senha…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" /> Criar senha e entrar
                </>
              )}
            </button>

            <p className="text-[11px] text-sand-100/45 leading-snug pt-2 border-t hairline">
              Ao criar sua senha você concorda em manter seus dados de acesso confidenciais.
              Em caso de dúvida, fale com o administrador.
            </p>
          </form>
        )}

        {stage.kind === "done" && (
          <div className="rounded-lg bg-success/15 border border-success/40 px-4 py-6 text-sm text-center">
            <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
            <div className="font-medium text-success">Senha criada. Redirecionando…</div>
          </div>
        )}
      </div>
    </div>
  );
}
