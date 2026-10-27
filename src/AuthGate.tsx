import { createContext, useContext, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  ArrowRight,
  BarChart3,
  Check,
  Cloud,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { configureAuth, parsePublicConfig } from "./auth-client";
import type { PublicConfig } from "./auth-client";
import "./auth.css";

interface WorkspaceAuth {
  enabled: boolean;
  user: User | null;
  signOut: () => Promise<void>;
}

const WorkspaceAuthContext = createContext<WorkspaceAuth>({
  enabled: false,
  user: null,
  signOut: async () => {},
});

export const useWorkspaceAuth = () => useContext(WorkspaceAuthContext);

export function accountName(user: User | null): string {
  const metadataName = user?.user_metadata?.full_name;
  return typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim()
    : user?.email || "Sua conta";
}

export function WorkspaceAccount({ onProfileOpen, displayName, avatar }: { onProfileOpen?: () => void; displayName?: string; avatar?: ReactNode } = {}) {
  const { enabled, user, signOut } = useWorkspaceAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!enabled) return null;
  const logout = async () => {
    setBusy(true);
    setError("");
    try {
      await signOut();
    } catch {
      setError("Não foi possível sair. Tente novamente.");
      setBusy(false);
    }
  };
  return (
    <div className="auth-session">
      {onProfileOpen ? <button type="button" className="auth-profile-button" onClick={onProfileOpen} aria-label="Abrir meu perfil" title="Meu perfil">
        {avatar}<span className="auth-user" title={user?.email || undefined}>{displayName || accountName(user)}</span>
      </button> : <span className="auth-user" title={user?.email || undefined}>{displayName || accountName(user)}</span>}
      <button
        className="auth-signout"
        onClick={() => void logout()}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="spinner" size={15} />
        ) : (
          <LogOut size={15} />
        )}
        Sair
      </button>
      {error && (
        <span className="auth-signout-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Vox CRM">
        <div className="auth-brand">
          <span className="auth-brand-icon">
            <BarChart3 size={27} />
          </span>
          <span className="auth-brand-name">
            vox<span>crm</span>
          </span>
        </div>
        <div className="auth-story-copy">
          <span className="auth-story-kicker">
            RELACIONAMENTOS QUE GERAM RESULTADOS
          </span>
          <h1 className="auth-story-title">
            Boas conexões.
            <br />
            Grandes possibilidades.
          </h1>
          <p className="auth-story-description">
            Seus contatos, negócios e próximos passos em um espaço feito para
            dar clareza à sua operação.
          </p>
          <div className="auth-highlights">
            <div className="auth-highlight">
              <BarChart3 size={19} />
              <span>Seu funil, do primeiro contato ao negócio ganho.</span>
            </div>
            <div className="auth-highlight">
              <Users size={19} />
              <span>Relacionamentos organizados, sempre por perto.</span>
            </div>
            <div className="auth-highlight">
              <Cloud size={19} />
              <span>Informações disponíveis entre seus dispositivos.</span>
            </div>
          </div>
        </div>
        <p className="auth-story-footer">
          <ShieldCheck size={16} />
          Seu workspace. Sua conta. Seus dados.
        </p>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  );
}

function authMessage(message: string) {
  const value = message.toLowerCase();
  if (value.includes("invalid login credentials"))
    return "E-mail ou senha incorretos.";
  if (value.includes("email not confirmed"))
    return "Confirme seu e-mail antes de entrar. Confira a caixa de entrada e o spam.";
  if (value.includes("user already registered"))
    return "Este e-mail já tem uma conta. Use a opção Entrar.";
  if (value.includes("signup") && value.includes("disabled"))
    return "O cadastro de novas contas está desativado neste workspace.";
  if (value.includes("rate limit") || value.includes("too many"))
    return "Foram feitas muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (
    value.includes("password") &&
    (value.includes("weak") || value.includes("characters"))
  )
    return "Escolha uma senha mais forte, com pelo menos 8 caracteres.";
  if (value.includes("fetch") || value.includes("network"))
    return "Não foi possível conectar ao serviço de acesso. Confira sua conexão e tente novamente.";
  return "Não foi possível concluir o acesso. Confira seus dados e tente novamente.";
}

function LoginForm({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const selectMode = (next: "login" | "signup") => {
    setMode(next);
    setError("");
    setSuccess("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (mode === "login") {
        const result = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error) throw result.error;
      } else {
        const result = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (result.error) throw result.error;
        if (!result.data.session) {
          setSuccess(
            "Confira seu e-mail para confirmar o cadastro. Depois, volte aqui e entre na sua conta.",
          );
          setPassword("");
        }
      }
    } catch (cause) {
      setError(authMessage(cause instanceof Error ? cause.message : ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-card">
      <span className="auth-kicker">BEM-VINDO AO SEU WORKSPACE</span>
      <h2 className="auth-title">
        {mode === "login"
          ? "Vamos fazer acontecer?"
          : "Comece uma boa conexão."}
      </h2>
      <p className="auth-description">
        {mode === "login"
          ? "Entre na sua conta e continue de onde parou."
          : "Crie sua conta para organizar contatos, negócios e tarefas."}
      </p>
      <div className="auth-tabs" aria-label="Acesso à conta">
        <button
          type="button"
          className={`auth-tab${mode === "login" ? " active" : ""}`}
          aria-pressed={mode === "login"}
          onClick={() => selectMode("login")}
          disabled={busy}
        >
          Entrar
        </button>
        <button
          type="button"
          className={`auth-tab${mode === "signup" ? " active" : ""}`}
          aria-pressed={mode === "signup"}
          onClick={() => selectMode("signup")}
          disabled={busy}
        >
          Criar conta
        </button>
      </div>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {mode === "signup" && (
          <label className="auth-field">
            <span>Seu nome</span>
            <span className="auth-input-wrap">
              <input
                type="text"
                name="full_name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
                disabled={busy}
              />
            </span>
          </label>
        )}
        <label className="auth-field">
          <span>E-mail</span>
          <span className="auth-input-wrap">
            <Mail className="auth-input-icon" size={17} />
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="voce@empresa.com.br"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={busy}
            />
          </span>
        </label>
        <label className="auth-field">
          <span>Senha</span>
          <span className="auth-input-wrap">
            <LockKeyhole className="auth-input-icon" size={17} />
            <input
              type={visible ? "text" : "password"}
              name="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder={
                mode === "signup" ? "Pelo menos 8 caracteres" : "Sua senha"
              }
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
            <button
              type="button"
              className="auth-password-toggle"
              aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={visible}
              onClick={() => setVisible((previous) => !previous)}
              disabled={busy}
            >
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        {error && (
          <div className="auth-feedback error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="auth-feedback success" role="status">
            <Check size={17} />
            <span>{success}</span>
          </div>
        )}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="auth-spinner" size={18} /> : null}
          <span>
            {busy
              ? "Aguarde…"
              : mode === "login"
                ? "Entrar no CRM"
                : "Criar minha conta"}
          </span>
          {!busy && <ArrowRight size={18} />}
        </button>
      </form>
      <div className="auth-divider" />
      <p className="auth-note">
        <ShieldCheck size={16} />O acesso é protegido. Seus dados ficam
        associados à sua conta.
      </p>
    </div>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const initialize = async () => {
      try {
        const response = await fetch("/api/config", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const value = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(
            typeof value?.error === "string"
              ? value.error
              : "Não foi possível carregar a configuração do CRM.",
          );
        const nextConfig = parsePublicConfig(value);
        if (!active) return;
        const nextClient = configureAuth(nextConfig);
        if (nextClient) {
          const { data: listener } = nextClient.auth.onAuthStateChange(
            (_event, nextSession) => {
              if (active) setSession(nextSession);
            },
          );
          unsubscribe = () => listener.subscription.unsubscribe();
          const result = await nextClient.auth.getSession();
          if (result.error)
            throw new Error(
              "Não foi possível recuperar sua sessão. Tente novamente.",
            );
          if (!active) return;
          setSession(result.data.session);
        } else setSession(null);
        setClient(nextClient);
        setConfig(nextConfig);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Não foi possível iniciar o CRM.",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    return () => {
      active = false;
      controller.abort();
      unsubscribe?.();
    };
  }, [attempt]);

  if (loading)
    return (
      <div className="auth-loading" role="status">
        <LoaderCircle className="auth-spinner" size={28} />
        <span>Preparando seu workspace…</span>
      </div>
    );
  if (error || !config)
    return (
      <AuthShell>
        <div className="auth-card">
          <span className="auth-config-icon">
            <Cloud size={29} />
          </span>
          <h2 className="auth-title">Estamos preparando seu espaço.</h2>
          <p className="auth-description">
            A conexão do CRM precisa estar disponível para continuar.
          </p>
          <div className="auth-feedback error" role="alert">
            {error || "A configuração da aplicação está indisponível."}
          </div>
          <button
            className="auth-retry"
            onClick={() => setAttempt((previous) => previous + 1)}
          >
            <RefreshCw size={16} />
            Tentar novamente
          </button>
        </div>
      </AuthShell>
    );
  if (config.authRequired && client && !session)
    return (
      <AuthShell>
        <LoginForm client={client} />
      </AuthShell>
    );

  const signOut = async () => {
    if (!client) return;
    const result = await client.auth.signOut({ scope: "local" });
    if (result.error) throw result.error;
    setSession(null);
  };
  return (
    <WorkspaceAuthContext.Provider
      key={config.authRequired ? session?.user.id : "sqlite"}
      value={{
        enabled: config.authRequired,
        user: session?.user || null,
        signOut,
      }}
    >
      {children}
    </WorkspaceAuthContext.Provider>
  );
}
