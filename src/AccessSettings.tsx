import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  ChevronRight,
  Info,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Save,
  ShieldCheck,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";
import { authorizedFetch } from "./auth-client";
import { parseCRMAccess, roleName } from "./AccessGate";
import type { CRMAccess, Collection, PermissionProfile, Role } from "./types";
import "./access.css";

const ROLES: Role[] = ["admin", "manager", "user"];
const MODULES: { id: Collection; label: string }[] = [
  { id: "deals", label: "Negócios" },
  { id: "contacts", label: "Contatos" },
  { id: "companies", label: "Empresas" },
  { id: "tasks", label: "Tarefas" },
];
const SCOPE_OPTIONS = [
  { value: "none", label: "Sem acesso" },
  { value: "own", label: "Somente próprios" },
  { value: "all", label: "Todos" },
] as const;

function copyProfiles(profiles: CRMAccess["profiles"]): CRMAccess["profiles"] {
  return structuredClone(profiles);
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

async function saveAccess(path: string, method: "POST" | "PUT", body: unknown) {
  let response: Response;
  try {
    response = await authorizedFetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Não foi possível conectar ao servidor. Tente novamente.");
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Não foi possível salvar as permissões. Tente novamente.";
    throw new Error(message);
  }
  return parseCRMAccess(result);
}

type Member = CRMAccess["members"][number];

function MemberRow({
  member,
  self,
  lastAdmin,
  busy,
  disabled,
  onSave,
}: {
  member: Member;
  self: boolean;
  lastAdmin: boolean;
  busy: boolean;
  disabled: boolean;
  onSave: (member: Member, role: Role, active: boolean) => void;
}) {
  const [draftRole, setDraftRole] = useState<Role>(member.role);
  useEffect(() => setDraftRole(member.role), [member.role]);
  const canUpdate = !disabled && !busy && !!member.email;
  return (
    <tr>
      <td>
        <div className="access-member-name">
          <span className="access-member-avatar">
            {initials(member.displayName || member.email || "Usuário")}
          </span>
          <div>
            <strong>
              {member.displayName || member.email || "Usuário"}
              {self && <span className="access-member-self">Você</span>}
            </strong>
            {member.email && (
              <span className="access-member-email">{member.email}</span>
            )}
          </div>
        </div>
      </td>
      <td>
        <span
          className={`access-status-pill ${member.active ? "active" : "inactive"}`}
        >
          {member.active ? "Ativo" : "Desativado"}
        </span>
      </td>
      <td>
        <div className="access-member-controls">
          <select
            aria-label={`Perfil de ${member.displayName || member.email || "usuário"}`}
            value={draftRole}
            disabled={!canUpdate || lastAdmin}
            onChange={(event) => setDraftRole(event.target.value as Role)}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canUpdate || lastAdmin || draftRole === member.role}
            aria-label={`Salvar perfil de ${member.displayName || member.email || "usuário"}`}
            onClick={() => onSave(member, draftRole, member.active)}
          >
            {busy ? (
              <LoaderCircle className="spinner" size={15} />
            ) : (
              <Check size={15} />
            )}
            Aplicar
          </button>
        </div>
      </td>
      <td>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canUpdate || lastAdmin}
          title={
            lastAdmin
              ? "Mantenha pelo menos um administrador ativo."
              : undefined
          }
          aria-label={`${member.active ? "Desativar" : "Ativar"} usuário ${member.displayName || member.email || "usuário"}`}
          onClick={() => onSave(member, member.role, !member.active)}
        >
          {member.active ? <UserMinus size={15} /> : <UserCheck size={15} />}
          {member.active ? "Desativar" : "Ativar"}
        </button>
      </td>
    </tr>
  );
}

export default function AccessSettings({
  access,
  onAccessChange,
}: {
  access: CRMAccess;
  onAccessChange: (access: CRMAccess) => void;
}) {
  const [tab, setTab] = useState<"members" | "profiles">("members");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");
  const [selectedRole, setSelectedRole] = useState<Role>("manager");
  const [drafts, setDrafts] = useState(() => copyProfiles(access.profiles));
  const previousProfiles = useRef(copyProfiles(access.profiles));
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const fingerprint = JSON.stringify(access.profiles);

  useEffect(() => {
    const previous = previousProfiles.current;
    setDrafts(
      (current) =>
        Object.fromEntries(
          ROLES.map((role) => [
            role,
            JSON.stringify(current[role]) === JSON.stringify(previous[role])
              ? structuredClone(access.profiles[role])
              : current[role],
          ]),
        ) as CRMAccess["profiles"],
    );
    previousProfiles.current = copyProfiles(access.profiles);
  }, [fingerprint]);

  const local = access.storage === "sqlite";
  const editable = access.role === "admin" && !local;
  const activeAdmins = access.members.filter(
    (member) => member.active && member.role === "admin",
  ).length;
  const selectedProfile = drafts[selectedRole];
  const dirty =
    JSON.stringify(selectedProfile) !==
    JSON.stringify(access.profiles[selectedRole]);

  const updateMember = async (member: Member, role: Role, active: boolean) => {
    if (!editable || busy || !member.email) return;
    setBusy(`member:${member.userId}`);
    setFeedback(null);
    try {
      const next = await saveAccess("/api/members", "POST", {
        email: member.email,
        role,
        active,
      });
      onAccessChange(next);
      setFeedback({ error: false, message: "Acesso do usuário atualizado." });
    } catch (cause) {
      setFeedback({
        error: true,
        message:
          cause instanceof Error
            ? cause.message
            : "Não foi possível atualizar o usuário.",
      });
    } finally {
      setBusy(null);
    }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!editable || busy) return;
    setBusy("add");
    setFeedback(null);
    try {
      const next = await saveAccess("/api/members", "POST", {
        email: email.trim(),
        role: newRole,
        active: true,
      });
      onAccessChange(next);
      setEmail("");
      setNewRole("user");
      setFeedback({
        error: false,
        message: "Usuário adicionado à organização.",
      });
    } catch (cause) {
      setFeedback({
        error: true,
        message:
          cause instanceof Error
            ? cause.message
            : "Não foi possível adicionar o usuário.",
      });
    } finally {
      setBusy(null);
    }
  };

  const changePermission = <K extends keyof PermissionProfile[Collection]>(
    module: Collection,
    action: K,
    value: PermissionProfile[Collection][K],
  ) => {
    if (!editable || selectedRole === "admin" || busy) return;
    setDrafts((current) => {
      const next = { ...current[selectedRole][module], [action]: value };
      if (next.read === "none") {
        next.create = false;
        next.update = "none";
        next.delete = "none";
        next.export = false;
      } else if (next.read === "own") {
        if (next.update === "all") next.update = "own";
        if (next.delete === "all") next.delete = "own";
      }
      return {
        ...current,
        [selectedRole]: { ...current[selectedRole], [module]: next },
      };
    });
  };

  const saveProfile = async () => {
    if (!editable || selectedRole === "admin" || busy || !dirty) return;
    const role = selectedRole;
    setBusy(`profile:${role}`);
    setFeedback(null);
    try {
      const next = await saveAccess(`/api/profiles/${role}`, "PUT", {
        permissions: drafts[role],
      });
      onAccessChange(next);
      setDrafts((current) => ({
        ...current,
        [role]: structuredClone(next.profiles[role]),
      }));
      setFeedback({
        error: false,
        message: `Permissões de ${roleName(role).toLowerCase()} salvas.`,
      });
    } catch (cause) {
      setFeedback({
        error: true,
        message:
          cause instanceof Error
            ? cause.message
            : "Não foi possível salvar este perfil.",
      });
    } finally {
      setBusy(null);
    }
  };

  if (access.role !== "admin")
    return (
      <div className="access-notice" role="status">
        <LockKeyhole size={18} />
        <p>
          A gestão de usuários e permissões está disponível para administradores
          da organização.
        </p>
      </div>
    );

  return (
    <div className="access-settings">
      <div className="access-summary">
        <span>
          <ShieldCheck size={20} />
          <strong>{access.workspaceName}</strong>
        </span>
        <span className="access-role-badge" data-role={access.role}>
          {roleName(access.role)}
        </span>
      </div>
      {local && (
        <div className="access-notice">
          <Info size={18} />
          <p>
            A gestão de usuários funciona na versão conectada ao Supabase. Neste
            ambiente local, você pode consultar os perfis de acesso.
          </p>
        </div>
      )}
      <div className="access-tabs" aria-label="Configurações de acesso">
        <button
          type="button"
          className={`access-tab${tab === "members" ? " active" : ""}`}
          aria-pressed={tab === "members"}
          onClick={() => setTab("members")}
        >
          <Users size={17} />
          Usuários <span>{access.members.length}</span>
        </button>
        <button
          type="button"
          className={`access-tab${tab === "profiles" ? " active" : ""}`}
          aria-pressed={tab === "profiles"}
          onClick={() => setTab("profiles")}
        >
          <ShieldCheck size={17} />
          Perfis de acesso
        </button>
      </div>
      {feedback && (
        <div
          className={`access-feedback ${feedback.error ? "error" : "success"}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.error ? <Info size={17} /> : <Check size={17} />}
          <span>{feedback.message}</span>
        </div>
      )}

      {tab === "members" ? (
        <>
          <section className="access-panel">
            <div className="access-panel-heading">
              <div>
                <h2>Adicionar usuário cadastrado</h2>
                <p>
                  Informe o e-mail de uma pessoa que já criou uma conta no CRM.
                </p>
              </div>
              <UserCheck size={20} />
            </div>
            <form
              className="access-add-form"
              onSubmit={(event) => void addMember(event)}
            >
              <label className="access-settings-label">
                <span>E-mail do usuário</span>
                <input
                  name="memberEmail"
                  type="email"
                  autoComplete="off"
                  placeholder="pessoa@empresa.com.br"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={!editable || !!busy}
                />
              </label>
              <label className="access-settings-label">
                <span>Perfil de acesso</span>
                <select
                  aria-label="Perfil de acesso"
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value as Role)}
                  disabled={!editable || !!busy}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleName(role)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!editable || !!busy}
              >
                {busy === "add" ? (
                  <LoaderCircle className="spinner" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Adicionar usuário
              </button>
            </form>
            <p className="access-save-note">
              O usuário receberá acesso à organização após você adicioná-lo.
              Esta ação não envia um e-mail de convite.
            </p>
          </section>
          <section className="access-panel">
            <div className="access-panel-heading">
              <div>
                <h2>Pessoas da organização</h2>
                <p>Defina quem participa e qual perfil cada pessoa utiliza.</p>
              </div>
              <span className="access-save-note">
                {access.members.filter((member) => member.active).length} ativos
              </span>
            </div>
            {access.members.length ? (
              <div className="access-members-scroll">
                <table className="access-members-table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Situação</th>
                      <th>Perfil de acesso</th>
                      <th>
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {access.members.map((member) => (
                      <MemberRow
                        key={member.userId}
                        member={member}
                        self={member.userId === access.userId}
                        lastAdmin={
                          member.active &&
                          member.role === "admin" &&
                          activeAdmins <= 1
                        }
                        disabled={!editable || !!busy}
                        busy={busy === `member:${member.userId}`}
                        onSave={(record, role, active) =>
                          void updateMember(record, role, active)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="access-empty">
                <Users size={28} />
                <h3>
                  {local
                    ? "Gestão disponível no Supabase"
                    : "Nenhum usuário listado"}
                </h3>
                <p>
                  {local
                    ? "Publique a aplicação conectada para administrar sua organização."
                    : "Os usuários adicionados aparecerão aqui."}
                </p>
              </div>
            )}
            <p className="access-save-note">
              <LockKeyhole size={13} />A organização deve manter pelo menos um
              administrador ativo.
            </p>
          </section>
        </>
      ) : (
        <section className="access-panel">
          <div className="access-panel-heading">
            <div>
              <h2>O que cada perfil pode fazer</h2>
              <p>
                Controle a leitura, a criação, a edição, a exclusão e a
                exportação em cada módulo.
              </p>
            </div>
            <ShieldCheck size={20} />
          </div>
          <div className="access-profile-switch" aria-label="Selecionar perfil">
            {ROLES.map((role) => (
              <button
                key={role}
                type="button"
                className={`access-profile-card${selectedRole === role ? " active" : ""}`}
                aria-pressed={selectedRole === role}
                onClick={() => setSelectedRole(role)}
                disabled={!!busy}
              >
                <span className="access-role-badge" data-role={role}>
                  {roleName(role)}
                </span>
                <span className="access-profile-copy">
                  {role === "admin"
                    ? "Organização e acesso completo"
                    : role === "manager"
                      ? "Gestão da operação comercial"
                      : "Rotina e registros próprios"}
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          <div className="access-profile-header">
            <h3>{roleName(selectedRole)}</h3>
            <span className="access-save-note">
              {selectedRole === "admin"
                ? "Acesso completo protegido"
                : "“Somente próprios” considera o responsável pelo registro."}
            </span>
          </div>
          {selectedRole !== "admin" && (
            <p className="access-save-note">
              A leitura define o alcance das demais ações. Sem leitura, as
              outras ações ficam bloqueadas. A leitura de registros próprios
              limita a edição e a exclusão aos mesmos registros.
            </p>
          )}
          <div className="access-matrix-scroll">
            <table className="access-matrix">
              <thead>
                <tr>
                  <th>Módulo</th>
                  <th>Ler</th>
                  <th>Criar</th>
                  <th>Editar</th>
                  <th>Excluir</th>
                  <th>Exportar</th>
                </tr>
              </thead>
              <tbody>
                {MODULES.map(({ id, label }) => (
                  <tr key={id}>
                    <th scope="row">{label}</th>
                    {(
                      ["read", "create", "update", "delete", "export"] as const
                    ).map((action) => {
                      const title = {
                        read: "Ler",
                        create: "Criar",
                        update: "Editar",
                        delete: "Excluir",
                        export: "Exportar",
                      }[action];
                      const locked =
                        !editable ||
                        selectedRole === "admin" ||
                        !!busy ||
                        (action !== "read" &&
                          selectedProfile[id].read === "none");
                      return (
                        <td key={action}>
                          {action === "create" || action === "export" ? (
                            <label className="access-checkbox">
                              <input
                                type="checkbox"
                                aria-label={`${title} ${label} — ${roleName(selectedRole)}`}
                                checked={selectedProfile[id][action]}
                                disabled={locked}
                                onChange={(event) =>
                                  changePermission(
                                    id,
                                    action,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span>
                                {selectedProfile[id][action]
                                  ? "Permitido"
                                  : "Bloqueado"}
                              </span>
                            </label>
                          ) : (
                            <select
                              aria-label={`${title} ${label} — ${roleName(selectedRole)}`}
                              value={selectedProfile[id][action]}
                              disabled={locked}
                              onChange={(event) =>
                                changePermission(
                                  id,
                                  action,
                                  event.target
                                    .value as PermissionProfile[Collection][typeof action],
                                )
                              }
                            >
                              {SCOPE_OPTIONS.map((option) => (
                                <option
                                  key={option.value}
                                  value={option.value}
                                  disabled={
                                    action !== "read" &&
                                    option.value === "all" &&
                                    selectedProfile[id].read === "own"
                                  }
                                >
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="access-profile-footer">
            <p className="access-save-note">
              {selectedRole === "admin"
                ? "As permissões do administrador garantem a gestão dos usuários e dos demais perfis."
                : dirty
                  ? "Você tem alterações não salvas neste perfil."
                  : "As alterações salvas passam a valer para os usuários deste perfil."}
            </p>
            {selectedRole !== "admin" && (
              <div className="access-inline-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!editable || !!busy || !dirty}
                  onClick={() =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedRole]: structuredClone(
                        access.profiles[selectedRole],
                      ),
                    }))
                  }
                >
                  Descartar alterações
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!editable || !!busy || !dirty}
                  onClick={() => void saveProfile()}
                >
                  {busy === `profile:${selectedRole}` ? (
                    <LoaderCircle className="spinner" size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  Salvar perfil
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
