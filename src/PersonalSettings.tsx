import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Building2,
  Check,
  ImagePlus,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Sun,
  Trash2,
} from "lucide-react";
import { usePersonalization } from "./PersonalizationProvider";
import { uploadPersonalImage, removePersonalImage } from "./auth-client";
import { DEFAULT_PREFERENCES } from "./personalization-types";
import type {
  AccentChoice,
  BackgroundChoice,
  PersonalPreferences,
  ThemeChoice,
} from "./personalization-types";

const THEMES: {
  id: ThemeChoice;
  name: string;
  text: string;
  icon: typeof Sun;
}[] = [
  {
    id: "light",
    name: "Claro",
    text: "Leve e familiar para o seu dia a dia.",
    icon: Sun,
  },
  {
    id: "dark",
    name: "Escuro",
    text: "Uma aparência confortável com tons escuros.",
    icon: Moon,
  },
  {
    id: "system",
    name: "Seguir o dispositivo",
    text: "Acompanha a preferência do seu sistema.",
    icon: Monitor,
  },
];
const ACCENTS: { id: AccentChoice; name: string; color: string }[] = [
  { id: "teal", name: "Turquesa", color: "#119c9a" },
  { id: "blue", name: "Azul", color: "#3878d5" },
  { id: "purple", name: "Violeta", color: "#8660ca" },
  { id: "rose", name: "Rosa", color: "#c55581" },
  { id: "amber", name: "Âmbar", color: "#aa7216" },
  { id: "green", name: "Verde", color: "#27814b" },
];
const BACKGROUNDS: { id: BackgroundChoice; name: string }[] = [
  { id: "none", name: "Padrão" },
  { id: "aurora", name: "Aurora" },
  { id: "ocean", name: "Oceano" },
  { id: "sunset", name: "Pôr do sol" },
  { id: "forest", name: "Floresta" },
];

export default function PersonalSettings() {
  const {
    me,
    loading,
    error: loadError,
    refresh,
    savePreferences,
    previewPreferences,
    resetPreview,
    refreshWorkspace,
  } = usePersonalization();
  const [values, setValues] = useState<PersonalPreferences>({
    ...DEFAULT_PREFERENCES,
  });
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceSuccess, setWorkspaceSuccess] = useState("");
  const initialized = useRef<string | null>(null);
  const draftRef = useRef(values);
  draftRef.current = values;
  const previewRef = useRef(previewPreferences);
  previewRef.current = previewPreferences;
  const resetRef = useRef(resetPreview);
  resetRef.current = resetPreview;
  useEffect(() => {
    if (me && initialized.current !== me.userId) {
      setValues(me.preferences);
      setName(me.workspace.name);
      initialized.current = me.userId;
    }
  }, [me]);
  useEffect(() => () => resetRef.current(), []);
  useEffect(() => {
    if (!file) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    const next = { ...draftRef.current, backgroundUrl: url };
    draftRef.current = next;
    setValues(next);
    previewRef.current(next);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const change = (patch: Partial<PersonalPreferences>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setValues(next);
    previewPreferences(next);
    setSuccess("");
  };
  if (loading && !me)
    return (
      <div className="loading-screen" role="status">
        <LoaderCircle className="spinner" />
        <span>Carregando suas configurações…</span>
      </div>
    );
  if (!me)
    return (
      <div className="personal-card">
        <div className="p-error" role="alert">
          {loadError || "Não foi possível carregar suas configurações."}
        </div>
        <button className="btn btn-secondary" onClick={() => void refresh()}>
          <RefreshCw size={16} />
          Tentar novamente
        </button>
      </div>
    );
  const choose = (candidate: File | undefined) => {
    setError("");
    if (!candidate) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(candidate.type)) {
      setError("Escolha uma foto PNG, JPEG ou WebP.");
      return;
    }
    if (candidate.size > 12 * 1024 * 1024) {
      setError("A foto deve ter até 12 MB antes do ajuste de tamanho.");
      return;
    }
    setFile(candidate);
    setSuccess("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    let uploaded: string | null = null;
    const oldPath = me.preferences.backgroundPath;
    try {
      const { backgroundUrl: _url, ...next } = values;
      if (file) {
        uploaded = (await uploadPersonalImage(file, "background")).path;
        next.backgroundPath = uploaded;
      }
      const result = await savePreferences(next);
      setValues(result.preferences);
      setFile(null);
      uploaded = null;
      setSuccess(
        "Sua aparência foi salva. Ela será usada apenas na sua conta.",
      );
      if (oldPath && oldPath !== result.preferences.backgroundPath)
        void removePersonalImage(oldPath).catch(() => {});
    } catch (cause) {
      if (uploaded) void removePersonalImage(uploaded).catch(() => {});
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar sua aparência.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (workspaceBusy) return;
    setWorkspaceBusy(true);
    setWorkspaceError("");
    setWorkspaceSuccess("");
    try {
      await refreshWorkspace(name.trim());
      setWorkspaceSuccess("Nome da organização atualizado.");
    } catch (cause) {
      setWorkspaceError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar a organização.",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };
  const photo = filePreview || values.backgroundUrl;
  return (
    <div className="personal-layout">
      <section className="personal-card">
        <header className="p-head">
          <span className="p-choice-icon">
            <Palette size={22} />
          </span>
          <div>
            <h2 className="p-title">Minha aparência</h2>
            <p className="p-description">
              Deixe seu espaço com a sua cara. Estas preferências são pessoais.
            </p>
          </div>
        </header>
        <form className="p-form" onSubmit={(event) => void submit(event)}>
          <h3 className="p-section-title">Tema</h3>
          <div className="p-choices" role="group" aria-label="Tema pessoal">
            {THEMES.map(({ id, name: label, text, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`p-choice${values.theme === id ? " p-choice-selected" : ""}`}
                aria-pressed={values.theme === id}
                disabled={busy}
                onClick={() => change({ theme: id })}
              >
                <Icon size={23} />
                <strong className="p-choice-title">{label}</strong>
                <span className="p-choice-copy">{text}</span>
                {values.theme === id && <Check size={15} />}
              </button>
            ))}
          </div>
          <h3 className="p-section-title">Cor de destaque</h3>
          <div
            className="p-choices p-accent-choices"
            role="group"
            aria-label="Cor de destaque"
          >
            {ACCENTS.map(({ id, name: label, color }) => (
              <button
                type="button"
                key={id}
                className={`p-choice p-accent-choice${values.accent === id ? " p-choice-selected" : ""}`}
                aria-pressed={values.accent === id}
                disabled={busy}
                onClick={() => change({ accent: id })}
              >
                <span className="p-swatch" style={{ background: color }}>
                  {values.accent === id && <Check size={16} />}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <h3 className="p-section-title">Plano de fundo</h3>
          <div
            className="p-backgrounds"
            role="group"
            aria-label="Planos de fundo"
          >
            {BACKGROUNDS.map(({ id, name: label }) => (
              <button
                type="button"
                key={id}
                disabled={busy}
                className={`p-background${!values.backgroundPath && !file && values.backgroundPreset === id ? " p-background-selected" : ""}`}
                aria-pressed={
                  !values.backgroundPath &&
                  !file &&
                  values.backgroundPreset === id
                }
                onClick={() => {
                  setFile(null);
                  change({
                    backgroundPreset: id,
                    backgroundPath: null,
                    backgroundUrl: null,
                  });
                }}
              >
                <span className={`p-background-preview p-background-${id}`} />
                {label}
              </button>
            ))}
          </div>
          <div className="p-upload-controls">
            <label className="btn btn-secondary p-upload-label">
              <ImagePlus size={17} />
              Usar minha foto
              <input
                className="p-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Escolher foto de fundo"
                disabled={busy}
                onChange={(event) => {
                  choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {photo && (
              <button
                type="button"
                className="btn btn-ghost p-danger"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  change({
                    backgroundPath: null,
                    backgroundUrl: null,
                    backgroundPreset: "none",
                  });
                }}
              >
                <Trash2 size={16} />
                Remover foto de fundo
              </button>
            )}
            <span className="p-hint">
              PNG, JPEG ou WebP. A foto fica disponível somente para sua conta.
            </span>
          </div>
          {photo && (
            <div className="p-image-preview">
              <img src={photo} alt="Prévia do seu plano de fundo" />
            </div>
          )}
          <label className="p-field">
            <span>
              Intensidade do fundo —{" "}
              {Math.round(values.backgroundOpacity * 100)}%
            </span>
            <input
              type="range"
              min="0"
              max="0.7"
              step="0.05"
              aria-label="Intensidade do plano de fundo"
              disabled={busy}
              value={values.backgroundOpacity}
              onChange={(event) =>
                change({ backgroundOpacity: Number(event.target.value) })
              }
            />
          </label>
          {(error || loadError) && (
            <div className="p-error" role="alert">
              {error || loadError}
            </div>
          )}
          {success && (
            <div className="p-success" role="status">
              <Check size={16} />
              {success}
            </div>
          )}
          <div className="p-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                setValues(me.preferences);
                setFile(null);
                setError("");
                setSuccess("");
                resetPreview();
              }}
            >
              Cancelar alterações
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spinner" />
              ) : (
                <Check size={16} />
              )}
              {busy ? "Salvando…" : "Salvar aparência"}
            </button>
          </div>
        </form>
      </section>
      <aside className="personal-card p-workspace-summary">
        <header className="p-head">
          <Building2 size={22} />
          <h2 className="p-title">Configurações gerais</h2>
        </header>
        <p className="p-description">
          Estas informações pertencem à organização.
        </p>
        {me.workspace.canEdit ? (
          <form
            className="p-form"
            onSubmit={(event) => void saveWorkspace(event)}
          >
            <label className="p-field">
              <span>Nome da organização</span>
              <input
                required
                maxLength={120}
                value={name}
                disabled={workspaceBusy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {workspaceError && (
              <div className="p-error" role="alert">
                {workspaceError}
              </div>
            )}
            {workspaceSuccess && (
              <div className="p-success" role="status">
                {workspaceSuccess}
              </div>
            )}
            <button className="btn btn-primary" disabled={workspaceBusy}>
              {workspaceBusy ? (
                <LoaderCircle className="spinner" size={16} />
              ) : (
                <Check size={16} />
              )}
              {workspaceBusy ? "Salvando…" : "Salvar organização"}
            </button>
          </form>
        ) : (
          <>
            <strong>{me.workspace.name}</strong>
            <p className="p-hint">
              O administrador gerencia as configurações compartilhadas. Sua
              aparência permanece pessoal.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
