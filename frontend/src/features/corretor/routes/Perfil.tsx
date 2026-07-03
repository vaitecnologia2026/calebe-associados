// Perfil do corretor — edita campos aceitos pelo PATCH /api/associates/me
// Backend zod: { phone, whatsapp, bio, photoUrl, creci, creciUf } — todos opcionais
// Upload foto: POST /api/profile-photo/upload (multipart "file"), retorna { url }
// Troca senha: POST /api/auth/change-password { currentPassword, newPassword } min 8
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Upload as UploadIcon, FileText, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { promptInstall, clearCaches, diagnose } from "@/lib/pwa";

// Apenas os campos que o backend zod aceita em PATCH /api/associates/me
interface ProfileFields {
  phone?: string;
  whatsapp?: string;
  bio?: string;
  photoUrl?: string;
  creci?: string;
  creciUf?: string;
}

interface PhotoUploadResp {
  ok: boolean;
  url: string;
  filename?: string;
}

interface AgreementInfo {
  url: string;
  filename: string;
  size: number;
  uploadedAt: string;
  uploadedBy?: string;
}

// Aliás compatível pra código legado · usa o helper centralizado de mídia.
function resolveMidiasUrl(url: string): string {
  return resolveBackendUrl(url);
}

export function CorretorPerfil() {
  const user = useAuth((s) => s.user);
  const updateUser = useAuth((s) => s.updateUser);
  const showToast = useUi((s) => s.showToast);

  const [profile, setProfile] = useState<ProfileFields>({});
  const [pwd, setPwd] = useState({ atual: "", nova: "", confirm: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [agreement, setAgreement] = useState<AgreementInfo | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const a = await api.get<AgreementInfo | null>("/api/agreement");
        setAgreement(a && typeof a === "object" && a.url ? a : null);
      } catch { /* silencioso */ } finally { setAgreementLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    // Hidrata do user store (associate vem aninhado se o /api/auth/me populou)
    const a = user.associate;
    setProfile({
      phone:    a?.phone ?? "",
      whatsapp: a?.whatsapp ?? "",
      bio:      a?.bio ?? "",
      photoUrl: a?.photoUrl ?? "",
      creci:    a?.creci ?? "",
      creciUf:  a?.creciUf ?? "",
    });
  }, [user]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      // Backend zod aceita só os 6 campos abaixo. Envia só não-vazios pra evitar PATCH no-op.
      const payload: ProfileFields = {};
      if (profile.phone?.trim())    payload.phone    = profile.phone.trim();
      if (profile.whatsapp?.trim()) payload.whatsapp = profile.whatsapp.trim();
      if (profile.bio?.trim())      payload.bio      = profile.bio.trim();
      if (profile.photoUrl?.trim()) payload.photoUrl = profile.photoUrl.trim();
      if (profile.creci?.trim())    payload.creci    = profile.creci.trim();
      if (profile.creciUf?.trim())  payload.creciUf  = profile.creciUf.trim().toUpperCase().slice(0, 2);

      const updated = await api.patch<Partial<NonNullable<typeof user>["associate"]>>("/api/associates/me", payload);
      // Sync user store → rerouting back to Perfil shows fresh data without a full session refresh
      if (updated) updateUser({ associate: { ...(user?.associate ?? {}), ...updated } as NonNullable<typeof user>["associate"] });
      showToast("Dados salvos · suas LPs já estão atualizadas");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setSavingProfile(false); }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pwd.nova !== pwd.confirm) { showToast("Nova senha e confirmação não batem"); return; }
    if (pwd.nova.length < 8) { showToast("Senha precisa de no mínimo 8 caracteres"); return; }
    if (pwd.atual === pwd.nova) { showToast("A nova senha deve ser diferente da atual"); return; }
    setSavingPwd(true);
    try {
      // Backend zod: { currentPassword, newPassword } — react antes mandava { current, next }
      await api.post("/api/auth/change-password", {
        currentPassword: pwd.atual,
        newPassword:     pwd.nova,
      });
      showToast("Senha alterada com sucesso");
      setPwd({ atual: "", nova: "", confirm: "" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Backend retorna 401 invalid_password se senha atual errada
      if (msg.includes("invalid_password")) showToast("Senha atual incorreta");
      else if (msg.includes("same_password")) showToast("A nova senha não pode ser igual à atual");
      else showToast(`Erro: ${msg}`);
    } finally { setSavingPwd(false); }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoLoading(true);
    try {
      const fd = new FormData();
      // Backend perfilUpload.single("file") — antes React mandava "photo" → 400
      fd.append("file", f);
      const r = await api.post<PhotoUploadResp>("/api/profile-photo/upload", fd);
      if (!r?.url) throw new Error("Backend não retornou URL");
      // Auto-salva photoUrl no associate pra LP atualizar imediatamente
      await api.patch("/api/associates/me", { photoUrl: r.url });
      updateUser({ associate: { ...(user?.associate ?? {}), photoUrl: r.url } as NonNullable<typeof user>["associate"] });
      setProfile((p) => ({ ...p, photoUrl: r.url }));
      showToast("Foto atualizada");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setPhotoLoading(false); e.target.value = ""; }
  }

  async function instalar() {
    const r = await promptInstall();
    if (!r.ok) showToast(`Instalar: ${r.reason}`);
  }
  async function limparCache() {
    const r = await clearCaches();
    showToast(`${r.cleared} caches removidos · F5 pra recarregar`);
  }
  async function diag() {
    const d = await diagnose();
    alert(JSON.stringify(d, null, 2));
  }

  // Resolve URL absoluta da foto pra preview (backend pode retornar relativa /midias/perfil/xxx)
  const photoFullUrl = profile.photoUrl ? resolveBackendUrl(profile.photoUrl) : "";

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <PageHeader eyebrow="Conta" title="Meu perfil" description="Dados que aparecem nas suas LPs e nas comunicações com leads" />

      {/* Foto */}
      <section className="card p-5 mb-4">
        <h2 className="font-bold mb-3">Foto de perfil</h2>
        <div className="flex items-center gap-4">
          {photoFullUrl ? (
            <img src={photoFullUrl} alt="Foto" className="h-20 w-20 rounded-full object-cover border border-gold-400/30" />
          ) : (
            <div className="h-20 w-20 rounded-full bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-300 text-xl font-bold">
              {(user?.name?.[0] ?? "?").toUpperCase()}
            </div>
          )}
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="file" accept="image/*" onChange={onPhoto} disabled={photoLoading} className="hidden" />
            <span className="btn-base btn-outline text-sm" style={{ padding: ".5rem 1rem" }}>
              {photoLoading ? <Loader2 size={14} className="animate-spin" /> : <UploadIcon size={14} />}
              {photoLoading ? "Enviando…" : "Trocar foto"}
            </span>
          </label>
        </div>
      </section>

      {/* Dados editáveis */}
      <form onSubmit={saveProfile} className="card p-5 mb-4 space-y-3">
        <h2 className="font-bold mb-1">Dados de contato</h2>
        <p className="text-xs text-sand-100/55 mb-3">Para alterar nome ou e-mail, fale com o admin Calebe.</p>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome" value={user?.name ?? ""} disabled />
          <Field label="E-mail" type="email" value={user?.email ?? ""} disabled />
          <Field label="Telefone" value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="(47) 99999-9999" />
          <Field label="WhatsApp" value={profile.whatsapp ?? ""} onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value })} placeholder="(47) 99999-9999" />
          <Field label="CRECI (número)" value={profile.creci ?? ""} onChange={(e) => setProfile({ ...profile, creci: e.target.value })} placeholder="12345" />
          <Field label="UF do CRECI" value={profile.creciUf ?? ""} onChange={(e) => setProfile({ ...profile, creciUf: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} placeholder="SC" />
        </div>

        <div>
          <label className="field-label">Bio profissional</label>
          <textarea
            className="field-input text-sm"
            rows={4}
            maxLength={2000}
            value={profile.bio ?? ""}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="Texto curto que aparece nas suas LPs e na assinatura de e-mail"
          />
          <p className="text-xs text-sand-100/55 mt-1">Máximo 2000 caracteres</p>
        </div>

        <div className="text-right">
          <Button type="submit" variant="gold" loading={savingProfile}>Salvar dados</Button>
        </div>
      </form>

      {/* Senha */}
      <form onSubmit={changePassword} className="card p-5 mb-4 space-y-3">
        <h2 className="font-bold mb-2">Trocar senha</h2>
        <Field label="Senha atual" type="password" autoComplete="current-password" value={pwd.atual} onChange={(e) => setPwd({ ...pwd, atual: e.target.value })} required />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nova senha" type="password" autoComplete="new-password" value={pwd.nova} onChange={(e) => setPwd({ ...pwd, nova: e.target.value })} required minLength={8} hint="Mínimo 8 caracteres" />
          <Field label="Confirmar nova" type="password" autoComplete="new-password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} required minLength={8} />
        </div>
        <div className="text-right">
          <Button type="submit" variant="gold" loading={savingPwd}>Alterar senha</Button>
        </div>
      </form>

      {/* Acordo Calebe ↔ Corretor */}
      <section className="card p-5 mb-4">
        <h2 className="font-bold mb-2 flex items-center gap-2">
          <FileText size={16} className="text-gold-400" /> Acordo de associação
        </h2>
        {agreementLoading ? (
          <p className="text-xs text-sand-100/55">Carregando…</p>
        ) : agreement ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{agreement.filename}</p>
              <p className="text-[11px] text-sand-100/55">
                {(agreement.size / 1024).toFixed(0)} KB · publicado em {new Date(agreement.uploadedAt).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <a
              href={resolveMidiasUrl(agreement.url)}
              target="_blank" rel="noopener noreferrer"
              className="btn-base btn-outline text-sm inline-flex items-center gap-1.5"
              style={{ padding: ".5rem 1rem" }}
            >
              <ExternalLink size={14} /> Abrir PDF
            </a>
          </div>
        ) : (
          <p className="text-xs text-sand-100/55">
            O administrador ainda não publicou o acordo. Quando publicar, você verá o PDF aqui pra ler/baixar.
          </p>
        )}
      </section>

      {/* PWA */}
      <section className="card p-5">
        <h2 className="font-bold mb-3">Aplicativo (PWA)</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={instalar}>Instalar app</Button>
          <Button variant="outline" onClick={limparCache}>Limpar cache</Button>
          <Button variant="ghost" onClick={diag}>Diagnóstico</Button>
        </div>
      </section>
    </div>
  );
}
