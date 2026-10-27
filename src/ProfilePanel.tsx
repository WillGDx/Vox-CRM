import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Camera,
  Check,
  LoaderCircle,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import { usePersonalization } from "./PersonalizationProvider";
import { uploadPersonalImage, removePersonalImage } from "./auth-client";
import type { ProfilePatch } from "./personalization-types";

const EMPTY: ProfilePatch = {
  fullName: "",
  jobTitle: "",
  department: "",
  phone: "",
  location: "",
  bio: "",
  avatarPath: null,
};
export default function ProfilePanel() {
  const {
    me,
    loading,
    error: loadError,
    refresh,
    saveProfile,
  } = usePersonalization();
  const [values, setValues] = useState<ProfilePatch>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (me && initialized.current !== me.userId) {
      const { avatarUrl: _url, ...profile } = me.profile;
      setValues(profile);
      initialized.current = me.userId;
    }
  }, [me]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (loading && !me)
    return (
      <div className="loading-screen" role="status">
        <LoaderCircle className="spinner" />
        <span>Carregando seu perfil…</span>
      </div>
    );
  if (!me)
    return (
      <div className="personal-card">
        <div className="p-error" role="alert">
          {loadError || "Não foi possível carregar seu perfil."}
        </div>
        <button className="btn btn-secondary" onClick={() => void refresh()}>
          <RefreshCw size={16} />
          Tentar novamente
        </button>
      </div>
    );
  const image = preview || (values.avatarPath ? me.profile.avatarUrl : null);
  const change = (field: keyof ProfilePatch, value: string | null) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setSuccess("");
  };
  const choose = (candidate: File | undefined) => {
    setError("");
    setSuccess("");
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
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    let uploaded: string | null = null;
    const oldPath = me.profile.avatarPath;
    try {
      const nextValues = { ...values };
      if (file) {
        uploaded = (await uploadPersonalImage(file, "avatar")).path;
        nextValues.avatarPath = uploaded;
      }
      const result = await saveProfile(nextValues);
      const { avatarUrl: _url, ...profile } = result.profile;
      setValues(profile);
      setFile(null);
      uploaded = null;
      setSuccess("Perfil atualizado com sucesso.");
      if (oldPath && oldPath !== result.profile.avatarPath)
        void removePersonalImage(oldPath).catch(() => {});
    } catch (cause) {
      if (uploaded) void removePersonalImage(uploaded).catch(() => {});
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar seu perfil.",
      );
    } finally {
      setBusy(false);
    }
  };
  const field = (
    name: keyof ProfilePatch,
    label: string,
    maxLength: number,
    type = "text",
  ) => (
    <label className="p-field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        maxLength={maxLength}
        value={values[name] || ""}
        required={name === "fullName"}
        disabled={busy}
        onChange={(event) => change(name, event.target.value)}
      />
    </label>
  );
  return (
    <div className="personal-layout">
      <section className="personal-card">
        <header className="p-head">
          <span className="p-choice-icon">
            <UserRound size={22} />
          </span>
          <div>
            <h2 className="p-title">Meu perfil</h2>
            <p className="p-description">
              Conte à equipe quem você é e como encontrar você.
            </p>
          </div>
        </header>
        <form className="p-form" onSubmit={(event) => void submit(event)}>
          <div className="p-profile-layout">
            <div className="p-avatar-column">
              <div className="p-avatar-preview">
                {image ? (
                  <img src={image} alt="Prévia da sua foto de perfil" />
                ) : (
                  <span className="p-avatar-placeholder">
                    {values.fullName
                      .trim()
                      .split(/\s+/)
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() || <UserRound size={42} />}
                  </span>
                )}
              </div>
              <label className="btn btn-secondary p-upload-label">
                <Camera size={16} />
                Mudar foto
                <input
                  className="p-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Escolher foto de perfil"
                  disabled={busy}
                  onChange={(event) => {
                    choose(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {(image || file) && (
                <button
                  className="btn btn-ghost p-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    change("avatarPath", null);
                  }}
                >
                  <Trash2 size={15} />
                  Remover foto
                </button>
              )}
              <p className="p-hint">
                PNG, JPEG ou WebP. A imagem será ajustada para o seu avatar.
              </p>
            </div>
            <div className="p-grid">
              {field("fullName", "Nome completo", 120)}
              <label className="p-field">
                <span>E-mail de acesso</span>
                <input type="email" value={me.email} readOnly />
                <small className="p-hint">
                  Seu e-mail identifica a conta e permanece protegido.
                </small>
              </label>
              {field("jobTitle", "Cargo", 100)}
              {field("department", "Departamento", 100)}
              {field("phone", "Telefone", 40, "tel")}
              {field("location", "Localização", 120)}
              <label className="p-field p-wide">
                <span>Sobre mim</span>
                <textarea
                  name="bio"
                  rows={4}
                  maxLength={1000}
                  value={values.bio}
                  disabled={busy}
                  placeholder="Apresente sua experiência, interesses ou como você participa da equipe…"
                  onChange={(event) => change("bio", event.target.value)}
                />
                <small className="p-hint">
                  {values.bio.length}/1.000 caracteres
                </small>
              </label>
            </div>
          </div>
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
                const { avatarUrl: _url, ...profile } = me.profile;
                setValues(profile);
                setFile(null);
                setError("");
                setSuccess("");
              }}
            >
              Restaurar dados salvos
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spinner" />
              ) : (
                <Check size={16} />
              )}
              {busy ? "Salvando…" : "Salvar perfil"}
            </button>
          </div>
        </form>
      </section>
      <aside className="personal-card p-workspace-summary">
        <h3>Seu espaço na equipe</h3>
        <p>
          Nome, foto e informações profissionais ajudam seus colegas a
          reconhecer você nas conversas e no feed.
        </p>
        <p className="p-hint">
          As preferências de aparência são pessoais. Ajuste seu tema em
          Configurações do app.
        </p>
      </aside>
    </div>
  );
}
