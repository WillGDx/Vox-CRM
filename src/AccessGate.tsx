import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { authorizedFetch } from "./auth-client";
import { WorkspaceAccount } from "./AuthGate";
import type {
  Collection,
  CRMAccess,
  Entity,
  PermissionProfile,
  Role,
} from "./types";
import "./access.css";

const MODULES: Collection[] = ["companies", "contacts", "deals", "tasks"];
const ROLES: Role[] = ["admin", "manager", "user"];
const SCOPES = ["none", "own", "all"];
const noPermissions = (): PermissionProfile =>
  Object.fromEntries(
    MODULES.map((name) => [
      name,
      {
        read: "none",
        create: false,
        update: "none",
        delete: "none",
        export: false,
      },
    ]),
  ) as PermissionProfile;

function profile(value: unknown): PermissionProfile {
  if (!value || typeof value !== "object")
    throw new Error("O perfil de acesso recebido é inválido.");
  const record = value as Record<string, unknown>;
  for (const module of MODULES) {
    const entry = record[module] as Record<string, unknown> | undefined;
    if (
      !entry ||
      !SCOPES.includes(String(entry.read)) ||
      !SCOPES.includes(String(entry.update)) ||
      !SCOPES.includes(String(entry.delete)) ||
      typeof entry.create !== "boolean" ||
      typeof entry.export !== "boolean"
    )
      throw new Error("As permissões recebidas estão incompletas.");
  }
  return value as PermissionProfile;
}

export function parseCRMAccess(value: unknown): CRMAccess {
  if (!value || typeof value !== "object")
    throw new Error("Não foi possível validar seu acesso.");
  const data = value as Record<string, unknown>;
  if (
    !["sqlite", "supabase"].includes(String(data.storage)) ||
    typeof data.userId !== "string" ||
    !(data.workspaceId === null || typeof data.workspaceId === "string") ||
    !(data.role === null || ROLES.includes(data.role as Role))
  )
    throw new Error("A configuração de acesso recebida é inválida.");
  const pending = data.role === null;
  const permissions = pending ? noPermissions() : profile(data.permissions);
  const profiles = {} as Record<Role, PermissionProfile>;
  for (const role of ROLES)
    profiles[role] = pending
      ? noPermissions()
      : profile((data.profiles as Record<string, unknown> | undefined)?.[role]);
  if (!Array.isArray(data.members))
    throw new Error("A lista de usuários recebida é inválida.");
  for (const candidate of data.members) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.userId !== "string" ||
      typeof candidate.displayName !== "string" ||
      typeof candidate.active !== "boolean" ||
      !ROLES.includes(candidate.role) ||
      (candidate.email !== undefined && typeof candidate.email !== "string")
    )
      throw new Error("A lista de usuários recebida é inválida.");
  }
  return {
    storage: data.storage as CRMAccess["storage"],
    userId: data.userId,
    workspaceId: data.workspaceId as string | null,
    workspaceName:
      typeof data.workspaceName === "string"
        ? data.workspaceName
        : "Vox Workspace",
    role: data.role as Role | null,
    permissions,
    members: data.members,
    profiles,
  };
}

interface AccessContextValue {
  access: CRMAccess;
  updateAccess: (value: unknown) => void;
  refreshAccess: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);
export function useAccess() {
  const context = useContext(AccessContext);
  if (!context) throw new Error("O contexto de acesso não foi inicializado.");
  return context;
}

export function canAccessRecord(
  access: CRMAccess,
  collection: Collection,
  action: "update" | "delete",
  entity: Entity,
) {
  const scope = access.permissions[collection][action];
  return (
    scope === "all" || (scope === "own" && entity.ownerId === access.userId)
  );
}

export const roleName = (role: Role | null) =>
  role === "admin"
    ? "Administrador"
    : role === "manager"
      ? "Gestor"
      : role === "user"
        ? "Usuário"
        : "Aguardando acesso";

export default function AccessGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<CRMAccess | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const accessRequest = useRef(0);
  const refreshAccess = useCallback(async () => {
    const requestId = ++accessRequest.current;
    setError("");
    try {
      const response = await authorizedFetch("/api/access");
      const body = await response.json().catch(() => null);
      if (requestId !== accessRequest.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setAccess(null);
        throw new Error(
          body?.error || "Não foi possível carregar suas permissões.",
        );
      }
      setAccess(parseCRMAccess(body));
    } catch (cause) {
      if (requestId !== accessRequest.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar suas permissões.",
      );
    } finally {
      if (requestId === accessRequest.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshAccess();
    const refresh = () => {
      void refreshAccess();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshAccess]);
  const updateAccess = (value: unknown) => {
    const next = parseCRMAccess(value);
    accessRequest.current += 1;
    setAccess(next);
  };
  if (loading || !access || access.role === null)
    return (
      <div className="access-screen">
        <div className="access-card">
          <ShieldCheck size={34} />
          <span className="eyebrow">VOX CRM</span>
          <h1>
            {loading
              ? "Conferindo seu acesso…"
              : error
                ? "Não foi possível carregar o workspace"
                : "Seu acesso aguarda liberação"}
          </h1>
          <p>
            {loading
              ? "Estamos carregando suas permissões."
              : error ||
                "Sua conta está autenticada. Peça ao administrador da organização para adicionar seu e-mail e definir seu perfil de acesso."}
          </p>
          {loading ? (
            <LoaderCircle className="spinner" size={23} />
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => {
                setLoading(true);
                void refreshAccess();
              }}
            >
              <RefreshCw size={16} />
              Atualizar acesso
            </button>
          )}
          <WorkspaceAccount />
        </div>
      </div>
    );
  const fingerprint = MODULES.map((module) => {
    const permissions = access.permissions[module];
    return [
      module,
      permissions.read,
      permissions.create,
      permissions.update,
      permissions.delete,
      permissions.export,
    ].join(":");
  }).join("|");
  return (
    <AccessContext.Provider
      key={`${access.userId}:${access.workspaceId}:${access.role}:${fingerprint}`}
      value={{ access, updateAccess, refreshAccess }}
    >
      {children}
    </AccessContext.Provider>
  );
}
