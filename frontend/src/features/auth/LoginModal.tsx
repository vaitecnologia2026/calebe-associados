// Modal de login · porta doLogin do monólito (linha 9363-9406)
// Login bem-sucedido → store auth, inicia SSE, redireciona pra persona

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { defaultPathFor } from "@/router/guards";
import { track } from "@/lib/tracking";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LoginModal({ open, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);

  const login = useAuth((s) => s.login);
  const loginError = useAuth((s) => s.loginError);
  const loginLoading = useAuth((s) => s.loginLoading);
  const clearLoginError = useAuth((s) => s.clearLoginError);
  const showToast = useUi((s) => s.showToast);
  const nav = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearLoginError();
    const r = await login(email, password);
    if (r.ok && r.persona) {
      track("login", { method: "credentials", persona: r.persona });
      showToast(`Login efetuado · ${email}`);
      onClose();
      nav(defaultPathFor(r.persona as any));
    }
  }

  if (showForgot) {
    return (
      <ForgotPasswordModal
        open={open}
        onClose={() => { setShowForgot(false); onClose(); }}
        onBack={() => setShowForgot(false)}
      />
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Entrar" size="sm">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="E-mail"
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Field
          label="Senha"
          type="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        {loginError && (
          <p className="text-sm text-danger">{loginError}</p>
        )}
        <Button type="submit" variant="gold" loading={loginLoading} className="w-full">
          {loginLoading ? "Autenticando…" : "Entrar"}
        </Button>
        <button
          type="button"
          className="text-sm text-gold-400 hover:text-gold-300 w-full text-center"
          onClick={() => setShowForgot(true)}
        >
          Esqueci minha senha
        </button>
      </form>
    </Modal>
  );
}

// Forgot password embutido pra não criar arquivo separado pra fluxo de 1 input
import { api } from "@/lib/api";
import { ApiError } from "@/types/api";

function ForgotPasswordModal({ open, onClose, onBack }: { open: boolean; onClose: () => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setOkMsg(null);
    setError(null);
    try {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido");
      const r = await api.post<{ message?: string }>(
        "/api/auth/forgot-password",
        { email },
        { skipAuth: true },
      );
      setOkMsg(r.message ?? "Se o e-mail estiver cadastrado, enviaremos a nova senha pelo WhatsApp.");
    } catch (e) {
      if (e instanceof Error && e.message === "E-mail inválido") setError("Verifique o formato.");
      else if (e instanceof ApiError && (e.data as { error?: string })?.error === "validation") setError("Informe um e-mail válido.");
      else setError("Não foi possível processar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Esqueci a senha" size="sm">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-sand-100/70">
          Informe seu e-mail. Se estiver cadastrado, você recebe uma nova senha pelo WhatsApp.
        </p>
        <Field
          label="E-mail"
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        {okMsg && <p className="text-sm text-success">{okMsg}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} className="flex-1">
            Voltar
          </Button>
          <Button type="submit" variant="gold" loading={loading} className="flex-1">
            Enviar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
