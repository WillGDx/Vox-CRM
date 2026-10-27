import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { authorizedFetch } from "./auth-client";
import { accountName, useWorkspaceAuth, WorkspaceAccount } from "./AuthGate";
import { canAccessRecord, roleName, useAccess } from "./AccessGate";
import AccessSettings from "./AccessSettings";
import useChatUnread from "./useChatUnread";
import { usePersonalization } from "./PersonalizationProvider";
import UserAvatar from "./UserAvatar";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Columns3,
  LayoutDashboard,
  List,
  ListTodo,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  MessageCircle,
  Newspaper,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type {
  Collection,
  CRMState,
  CRMAccess,
  Deal,
  Editor,
  Entity,
  Page,
  Stage,
  Task,
} from "./types";

const ChatPanel = lazy(() => import("./ChatPanel"));
const FeedPanel = lazy(() => import("./FeedPanel"));
const PersonalSettings = lazy(() => import("./PersonalSettings"));
const ProfilePanel = lazy(() => import("./ProfilePanel"));
const SalesSuite = lazy(() => import("./SalesSuite"));
const WorkSuite = lazy(() => import("./WorkSuite"));
const PeopleSuite = lazy(() => import("./PeopleSuite"));
const CopilotPanel = lazy(() => import("./CopilotPanel"));
const CollaborationExtras = lazy(() => import("./CollaborationExtras"));
const SALES_PAGES = ["leads", "automations", "billing", "contact-center"];
const SUITE_PAGES = [
  ...SALES_PAGES,
  "projects",
  "calendar",
  "people",
  "processes",
  "copilot",
];

const STAGES: { id: Stage; name: string; color: string }[] = [
  { id: "new", name: "Novo lead", color: "#5d8fe7" },
  { id: "qualified", name: "Qualificação", color: "#8170da" },
  { id: "proposal", name: "Proposta", color: "#daa348" },
  { id: "negotiation", name: "Negociação", color: "#df8856" },
  { id: "won", name: "Ganho", color: "#29a985" },
  { id: "lost", name: "Perdido", color: "#a3abb7" },
];
const TEAM = ["Mariana Costa", "Rafael Silva", "Julia Santos"];
const SINGULAR = {
  companies: "empresa",
  contacts: "contato",
  deals: "negócio",
  tasks: "tarefa",
};
const NEW_LABEL = {
  companies: "Nova empresa",
  contacts: "Novo contato",
  deals: "Novo negócio",
  tasks: "Nova tarefa",
};
const PAGES: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "feed", label: "Feed da empresa", icon: Newspaper },
  { id: "chat", label: "Chat interno", icon: MessageCircle },
  { id: "deals", label: "Negócios", icon: Columns3 },
  { id: "leads", label: "Leads", icon: Target },
  { id: "contact-center", label: "Central de atendimento", icon: Phone },
  { id: "automations", label: "Automação de vendas", icon: Sparkles },
  { id: "billing", label: "Orçamentos e faturas", icon: Wallet },
  { id: "contacts", label: "Contatos", icon: Users },
  { id: "companies", label: "Empresas", icon: Building2 },
  { id: "tasks", label: "Tarefas", icon: ListTodo },
  { id: "projects", label: "Projetos", icon: LayoutDashboard },
  { id: "calendar", label: "Calendário", icon: CalendarDays },
  { id: "people", label: "Equipe e ponto", icon: Users },
  { id: "processes", label: "Processos e aprovações", icon: CheckCheck },
  { id: "copilot", label: "Copilot", icon: Sparkles },
  { id: "app-settings", label: "Configurações do app", icon: Settings },
  { id: "profile", label: "Meu perfil", icon: Users },
  { id: "settings", label: "Usuários e permissões", icon: ShieldCheck },
];
const PAGE_COPY: Record<Page, [string, string]> = {
  leads: ["Leads", "Acompanhe cada novo contato até a oportunidade de venda."],
  automations: [
    "Automação de vendas",
    "Transforme mudanças no funil em próximos passos para a equipe.",
  ],
  billing: [
    "Orçamentos e faturas",
    "Prepare propostas comerciais e acompanhe cobranças.",
  ],
  "contact-center": [
    "Central de atendimento",
    "Organize os atendimentos e conecte seus canais.",
  ],
  projects: [
    "Projetos",
    "Planeje entregas, organize sprints e acompanhe o tempo da equipe.",
  ],
  calendar: ["Calendário", "Encontre espaço para compromissos e agendamentos."],
  people: [
    "Equipe e ponto",
    "Conheça sua equipe e acompanhe a jornada de trabalho.",
  ],
  processes: [
    "Processos e aprovações",
    "Organize solicitações, compras e reembolsos com responsáveis claros.",
  ],
  copilot: [
    "Copilot",
    "Escreva, resuma e encontre os próximos passos com seu assistente.",
  ],
  overview: [
    "Sua operação, em um só lugar.",
    "Acompanhe resultados e descubra onde sua equipe pode avançar.",
  ],
  deals: [
    "Negócios",
    "Boas conversas se transformam em grandes oportunidades.",
  ],
  contacts: ["Contatos", "Relacionamentos que fazem seu negócio crescer."],
  companies: ["Empresas", "Conheça as empresas por trás de cada oportunidade."],
  tasks: ["Tarefas", "O próximo passo de cada relacionamento começa aqui."],
  chat: [
    "Chat interno",
    "Converse com sua equipe e mantenha os próximos passos por perto.",
  ],
  feed: [
    "Feed da empresa",
    "Comunicados, ideias e conquistas para compartilhar com a equipe.",
  ],
  "app-settings": [
    "Configurações do app",
    "Personalize sua aparência e as preferências do seu espaço de trabalho.",
  ],
  profile: [
    "Meu perfil",
    "Sua foto e suas informações para se conectar melhor com a equipe.",
  ],
  settings: [
    "Usuários e permissões",
    "Defina quem participa da equipe e o que cada perfil pode fazer.",
  ],
};

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );
const dateLabel = (date: string) =>
  date
    ? new Date(`${date}T12:00:00`)
        .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
        .replace(".", "")
    : "Sem prazo";
const isClosed = (deal: Deal) => deal.stage === "won" || deal.stage === "lost";
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const isOverdue = (date: string) => !!date && date < today();
const matches = (query: string, ...values: string[]) =>
  values
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(
      query
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    );
const entityLabel = (entity: Entity) =>
  "name" in entity ? entity.name : entity.title;
const colorFor = (name: string) =>
  ["#dfe9fc", "#e9e1fa", "#d9eee5", "#fae6d7", "#f8dfec"][
    [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % 5
  ];
const safeWebsite = (website: string) => {
  try {
    const url = new URL(
      website.includes("://") ? website : `https://${website}`,
    );
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

function permittedState(state: CRMState, access: CRMAccess): CRMState {
  const next = { ...state };
  for (const collection of [
    "companies",
    "contacts",
    "deals",
    "tasks",
  ] as Collection[]) {
    const scope = access.permissions[collection].read;
    (next[collection] as Entity[]) = state[collection].filter(
      (entity) =>
        scope === "all" ||
        (scope === "own" && entity.ownerId === access.userId),
    );
  }
  return next;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authorizedFetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body?.error || "Não foi possível concluir a operação. Tente novamente.",
    );
  return body as T;
}

function Avatar({
  name,
  small = false,
  userId,
}: {
  name: string;
  small?: boolean;
  userId?: string;
}) {
  return (
    <UserAvatar
      userId={userId}
      name={name}
      className={`avatar${small ? " avatar-small" : ""}`}
      style={{ background: colorFor(name) }}
    />
  );
}

function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Search size={28} strokeWidth={1.5} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const container = ref.current;
    const focusable = () =>
      Array.from(
        container?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        ) || [],
      );
    const firstInput = container?.querySelector<HTMLElement>(
      "input, select, textarea",
    );
    (firstInput || focusable()[0])?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">VOX CRM</span>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button modal-close"
            aria-label="Fechar"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditorForm({
  editor,
  data,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  editor: Editor;
  data: CRMState;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: Record<string, string | number>) => void;
  onDelete: () => void;
}) {
  const { access } = useAccess();
  const { collection, entity } = editor;
  const readOnly =
    !!entity && !canAccessRecord(access, collection, "update", entity);
  const allowDelete =
    !!entity && canAccessRecord(access, collection, "delete", entity);
  const canAssign = access.permissions[collection].update === "all";
  const currentMember = access.members.find(
    (member) => member.userId === access.userId,
  );
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<Collection, Record<string, string>> = {
      companies: {
        name: "",
        sector: "",
        website: "",
        phone: "",
        owner: TEAM[0]!,
      },
      contacts: {
        name: "",
        email: "",
        phone: "",
        role: "",
        companyId: "",
        owner: TEAM[0]!,
      },
      deals: {
        title: "",
        value: "",
        stage: "new",
        companyId: "",
        contactId: "",
        owner: TEAM[0]!,
        dueDate: "",
        description: "",
      },
      tasks: {
        title: "",
        dueDate: today(),
        priority: "medium",
        status: "pending",
        owner: TEAM[0]!,
        dealId: "",
      },
    };
    const values = entity
      ? Object.fromEntries(
          Object.entries(entity)
            .filter(([key]) => key !== "id")
            .map(([key, value]) => [key, String(value)]),
        )
      : { ...defaults[collection], ...editor.initial };
    if (access.storage === "supabase") {
      values.ownerId = entity?.ownerId || access.userId;
      values.owner =
        entity?.owner || currentMember?.displayName || "Minha conta";
    }
    return values;
  });
  const change = (name: string, value: string) =>
    setValues((previous) => ({
      ...previous,
      [name]: value,
      ...(name === "ownerId"
        ? {
            owner:
              access.members.find((member) => member.userId === value)
                ?.displayName ||
              previous.owner ||
              "",
          }
        : {}),
      ...(name === "companyId" && collection === "deals"
        ? { contactId: "" }
        : {}),
    }));
  const input = (
    name: string,
    label: string,
    type = "text",
    required = false,
    full = false,
  ) => (
    <label className={`form-field${full ? " full-width" : ""}`} key={name}>
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      <input
        name={name}
        aria-label={label}
        type={type}
        value={values[name] || ""}
        onChange={(event) => change(name, event.target.value)}
        required={required}
        {...(type === "number" ? { min: 0, step: "0.01" } : {})}
      />
    </label>
  );
  const select = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
    required = false,
    disabled = false,
  ) => (
    <label className="form-field" key={name}>
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      <select
        name={name}
        aria-label={label}
        value={values[name] || ""}
        onChange={(event) => change(name, event.target.value)}
        required={required}
        disabled={disabled}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
  const owners = [
    ...new Set([
      ...TEAM,
      values.owner || "",
      ...data.companies.map((company) => company.owner),
      ...data.contacts.map((contact) => contact.owner),
      ...data.deals.map((deal) => deal.owner),
      ...data.tasks.map((task) => task.owner),
    ]),
  ].filter(Boolean);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly) return;
    onSave({
      ...values,
      ...(collection === "deals" ? { value: Number(values.value) } : {}),
    });
  };
  return (
    <Modal
      title={
        entity
          ? `${readOnly ? "Consultar" : "Editar"} ${SINGULAR[collection]}`
          : NEW_LABEL[collection]
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="field-help">
            {entity
              ? "Mantenha as informações do seu relacionamento atualizadas."
              : "Preencha os detalhes. Cada oportunidade começa com um primeiro passo."}
          </p>
          {readOnly && (
            <p className="field-help">
              Seu perfil permite consultar este registro.
            </p>
          )}
          <fieldset
            className="form-grid"
            disabled={readOnly}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
          >
            {collection === "companies" && (
              <>
                {input("name", "Nome", "text", true, true)}
                {input("sector", "Segmento")}
                {input("phone", "Telefone", "tel")}
                {input("website", "Site", "url", false, true)}
              </>
            )}
            {collection === "contacts" && (
              <>
                {input("name", "Nome", "text", true, true)}
                {input("email", "E-mail", "email")}
                {input("phone", "Telefone", "tel")}
                {input("role", "Cargo")}
                {select("companyId", "Empresa", [
                  { value: "", label: "Sem empresa" },
                  ...data.companies.map((company) => ({
                    value: company.id,
                    label: company.name,
                  })),
                ])}
              </>
            )}
            {collection === "deals" && (
              <>
                {input("title", "Nome do negócio", "text", true, true)}
                {input("value", "Valor", "number", true)}
                {select(
                  "stage",
                  "Etapa",
                  STAGES.map((stage) => ({
                    value: stage.id,
                    label: stage.name,
                  })),
                  true,
                )}
                {select("companyId", "Empresa", [
                  { value: "", label: "Sem empresa" },
                  ...data.companies.map((company) => ({
                    value: company.id,
                    label: company.name,
                  })),
                ])}
                {select("contactId", "Contato", [
                  { value: "", label: "Sem contato" },
                  ...data.contacts
                    .filter(
                      (contact) =>
                        !values.companyId ||
                        contact.companyId === values.companyId,
                    )
                    .map((contact) => ({
                      value: contact.id,
                      label: contact.name,
                    })),
                ])}
                {input("dueDate", "Data prevista", "date")}
              </>
            )}
            {collection === "tasks" && (
              <>
                {input("title", "Título", "text", true, true)}
                {input("dueDate", "Prazo", "date")}
                {select(
                  "priority",
                  "Prioridade",
                  [
                    { value: "high", label: "Alta" },
                    { value: "medium", label: "Média" },
                    { value: "low", label: "Baixa" },
                  ],
                  true,
                )}
                {select(
                  "status",
                  "Situação",
                  [
                    { value: "pending", label: "Pendente" },
                    { value: "done", label: "Concluída" },
                  ],
                  true,
                )}
                {select("dealId", "Negócio", [
                  { value: "", label: "Sem negócio" },
                  ...data.deals.map((deal) => ({
                    value: deal.id,
                    label: deal.title,
                  })),
                ])}
              </>
            )}
            {access.storage === "supabase"
              ? select(
                  "ownerId",
                  "Responsável",
                  [
                    ...access.members
                      .filter((member) => member.active)
                      .map((member) => ({
                        value: member.userId,
                        label: member.displayName,
                      })),
                    ...(!access.members.some(
                      (member) =>
                        member.active && member.userId === values.ownerId,
                    ) && values.ownerId
                      ? [
                          {
                            value: values.ownerId,
                            label: values.owner || "Responsável atual",
                          },
                        ]
                      : []),
                  ],
                  true,
                  !canAssign,
                )
              : select(
                  "owner",
                  "Responsável",
                  owners.map((owner) => ({ value: owner, label: owner })),
                  true,
                )}
            {collection === "deals" && (
              <label className="form-field full-width">
                <span>Observações</span>
                <textarea
                  name="description"
                  value={values.description || ""}
                  rows={3}
                  onChange={(event) =>
                    change("description", event.target.value)
                  }
                  placeholder="Contexto, próximos passos e o que você precisa lembrar…"
                />
              </label>
            )}
          </fieldset>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {allowDelete && (
            <button
              type="button"
              className="btn btn-ghost danger-zone"
              onClick={onDelete}
              disabled={saving}
            >
              <Trash2 size={16} />
              Excluir
            </button>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              {readOnly ? "Fechar" : "Cancelar"}
            </button>
            {!readOnly && (
              <button
                className="btn btn-primary"
                type="submit"
                disabled={saving}
              >
                {saving ? (
                  <LoaderCircle size={16} className="spinner" />
                ) : (
                  <Check size={16} />
                )}
                {saving
                  ? "Salvando…"
                  : entity
                    ? "Salvar alterações"
                    : `Criar ${SINGULAR[collection]}`}
              </button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function App() {
  const auth = useWorkspaceAuth();
  const personal = usePersonalization();
  const { access, updateAccess, refreshAccess } = useAccess();
  const { unread, updateUnread } = useChatUnread(
    access.userId,
    access.workspaceId,
  );
  const availablePages = PAGES.filter(({ id }) =>
    SUITE_PAGES.includes(id)
      ? id === "automations"
        ? access.role === "admin" || access.role === "manager"
        : SALES_PAGES.includes(id)
          ? access.permissions.deals.read !== "none"
          : true
      : id === "overview" ||
        id === "chat" ||
        id === "feed" ||
        id === "app-settings" ||
        id === "profile" ||
        (id === "settings"
          ? access.role === "admin"
          : access.permissions[id as Collection].read !== "none"),
  );
  const visiblePages = availablePages.filter(({ id }) => id !== "profile");
  const [page, setPage] = useState<Page>(() =>
    access.permissions.deals.read === "none" ? "overview" : "deals",
  );
  const canCreate = (type: Collection) => access.permissions[type].create;
  const canUpdate = (type: Collection, entity: Entity) =>
    canAccessRecord(access, type, "update", entity);
  const canDelete = (type: Collection, entity: Entity) =>
    canAccessRecord(access, type, "delete", entity);
  const [data, setData] = useState<CRMState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [dealScope, setDealScope] = useState<"all" | "open" | "closed">("all");
  const [taskFilter, setTaskFilter] = useState("pending");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [dropStage, setDropStage] = useState<Stage | null>(null);
  const [dragging, setDragging] = useState(false);
  const load = useCallback(async () => {
    setLoadError("");
    try {
      const next = await request<CRMState>("/api/state");
      setData(permittedState(next, access));
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Falha ao carregar os dados.",
      );
    }
  }, [access.permissions, access.userId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!availablePages.some((entry) => entry.id === page)) setPage("overview");
    if (editor && access.permissions[editor.collection].read === "none")
      setEditor(null);
    if (
      deleteTarget?.entity &&
      !canAccessRecord(
        access,
        deleteTarget.collection,
        "delete",
        deleteTarget.entity,
      )
    )
      setDeleteTarget(null);
  }, [access, page, editor, deleteTarget]);
  const navigate = (next: Page) => {
    if (!availablePages.some((entry) => entry.id === next)) return;
    setPage(next);
    setQuery("");
    setOwner("all");
    setActionError("");
  };
  const openEditor = (
    collection: Collection,
    entity?: Entity,
    initial?: Record<string, string>,
  ) => {
    if (
      access.permissions[collection].read === "none" ||
      (!entity && !canCreate(collection))
    )
      return;
    setFormError("");
    setEditor(
      entity
        ? { collection, entity }
        : { collection, ...(initial ? { initial } : {}) },
    );
  };
  const mutate = async (
    collection: Collection,
    id: string,
    patch: Record<string, unknown>,
    message: string,
  ) => {
    const entity = data?.[collection].find((item) => item.id === id);
    if (!entity || !canUpdate(collection, entity)) {
      setActionError("Seu perfil não permite editar este registro.");
      return;
    }
    setActionError("");
    try {
      await request(`/api/${collection}/${id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setData(permittedState(await request<CRMState>("/api/state"), access));
      setToast(message);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    }
  };
  const saveEntity = async (values: Record<string, string | number>) => {
    if (!editor) return;
    if (
      editor.entity
        ? !canUpdate(editor.collection, editor.entity)
        : !canCreate(editor.collection)
    ) {
      setFormError("Seu perfil não permite salvar este registro.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await request(
        `/api/${editor.collection}${editor.entity ? `/${editor.entity.id}` : ""}`,
        {
          method: editor.entity ? "PUT" : "POST",
          body: JSON.stringify(values),
        },
      );
      setData(permittedState(await request<CRMState>("/api/state"), access));
      const feminine =
        editor.collection === "companies" || editor.collection === "tasks";
      setToast(
        `${SINGULAR[editor.collection][0]!.toUpperCase()}${SINGULAR[editor.collection].slice(1)} ${editor.entity ? "atualizad" : "criad"}${feminine ? "a" : "o"} com sucesso.`,
      );
      setEditor(null);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  };
  const deleteEntity = async () => {
    if (!deleteTarget?.entity) return;
    if (!canDelete(deleteTarget.collection, deleteTarget.entity)) {
      setFormError("Seu perfil não permite excluir este registro.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await request(
        `/api/${deleteTarget.collection}/${deleteTarget.entity.id}`,
        { method: "DELETE" },
      );
      setData(permittedState(await request<CRMState>("/api/state"), access));
      setDeleteTarget(null);
      setToast("Registro excluído com sucesso.");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Não foi possível excluir.",
      );
    } finally {
      setSaving(false);
    }
  };
  const moveDeal = (deal: Deal, stage: Stage) => {
    if (stage !== deal.stage)
      void mutate(
        "deals",
        deal.id,
        { stage },
        `Negócio movido para ${STAGES.find((item) => item.id === stage)?.name}.`,
      );
  };
  const toggleTask = (task: Task) =>
    void mutate(
      "tasks",
      task.id,
      { status: task.status === "done" ? "pending" : "done" },
      task.status === "done"
        ? "Tarefa reaberta."
        : "Tarefa concluída. Bom trabalho!",
    );
  const confirmDeletion = (collection: Collection, entity: Entity) => {
    if (!canDelete(collection, entity)) return;
    setFormError("");
    setEditor(null);
    setDeleteTarget({ collection, entity });
  };

  const companyName = (id: string) =>
    data?.companies.find((company) => company.id === id)?.name ||
    (id ? "Empresa sem acesso de leitura" : "Cliente independente");
  const contactName = (id: string) =>
    data?.contacts.find((contact) => contact.id === id)?.name || "";
  const pending = data?.tasks.filter((task) => task.status === "pending") || [];
  const openDeals = data?.deals.filter((deal) => !isClosed(deal)) || [];
  const wonDeals = data?.deals.filter((deal) => deal.stage === "won") || [];
  const closedCount = data?.deals.filter(isClosed).length || 0;
  const conversion = closedCount
    ? Math.round((wonDeals.length / closedCount) * 100)
    : 0;
  const dealList =
    data?.deals.filter(
      (deal) =>
        matches(
          query,
          deal.title,
          companyName(deal.companyId),
          contactName(deal.contactId),
        ) &&
        (owner === "all" || deal.owner === owner) &&
        (dealScope === "all" ||
          (dealScope === "closed" ? isClosed(deal) : !isClosed(deal))),
    ) || [];
  const contacts =
    data?.contacts.filter(
      (contact) =>
        matches(
          query,
          contact.name,
          contact.email,
          contact.role,
          companyName(contact.companyId),
        ) &&
        (owner === "all" || contact.owner === owner),
    ) || [];
  const companies =
    data?.companies.filter(
      (company) =>
        matches(query, company.name, company.sector, company.website) &&
        (owner === "all" || company.owner === owner),
    ) || [];
  const tasks =
    data?.tasks
      .filter(
        (task) =>
          matches(
            query,
            task.title,
            data.deals.find((deal) => deal.id === task.dealId)?.title || "",
          ) &&
          (owner === "all" || task.owner === owner) &&
          (taskFilter === "all" ||
            (taskFilter === "overdue"
              ? task.status !== "done" && isOverdue(task.dueDate)
              : task.status === taskFilter)),
      )
      .sort((first, second) =>
        (first.dueDate || "9999").localeCompare(second.dueDate || "9999"),
      ) || [];
  const owners = [
    ...new Set([
      ...TEAM,
      ...(data?.deals.map((deal) => deal.owner) || []),
      ...(data?.contacts.map((contact) => contact.owner) || []),
      ...(data?.companies.map((company) => company.owner) || []),
      ...(data?.tasks.map((task) => task.owner) || []),
    ]),
  ].filter(Boolean);
  const collection: Collection =
    page === "contacts" || page === "companies" || page === "tasks"
      ? page
      : "deals";
  const collaborationPage = page === "chat" || page === "feed";
  const personalPage = page === "profile" || page === "app-settings";
  const suitePage = SUITE_PAGES.includes(page);
  const exportData = async () => {
    if (!access.permissions[collection].export) return;
    setActionError("");
    try {
      const response = await authorizedFetch(`/api/export/${collection}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error || "Não foi possível exportar os registros.",
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vox-crm-${collection}-${today()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setToast("Arquivo CSV exportado.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível exportar.",
      );
      void refreshAccess();
    }
  };

  const stats = (
    <div className="stats-grid">
      <div className="stat-card">
        <div
          className="stat-icon"
          style={
            {
              "--icon-bg": "#e8f0fe",
              "--icon-color": "#4b83d8",
            } as CSSProperties
          }
        >
          <Wallet size={20} />
        </div>
        <span className="stat-label">Valor do funil</span>
        <strong className="stat-value">
          {money(openDeals.reduce((sum, deal) => sum + deal.value, 0))}
        </strong>
        <span className="stat-foot">
          <span className="stat-change">
            <ArrowUpRight size={13} />
            {openDeals.length} oportunidades
          </span>{" "}
          em andamento
        </span>
      </div>
      <div className="stat-card">
        <div
          className="stat-icon"
          style={
            {
              "--icon-bg": "#e1f5ed",
              "--icon-color": "#209f7e",
            } as CSSProperties
          }
        >
          <CircleDollarSign size={20} />
        </div>
        <span className="stat-label">Receita conquistada</span>
        <strong className="stat-value">
          {money(wonDeals.reduce((sum, deal) => sum + deal.value, 0))}
        </strong>
        <span className="stat-foot">
          <span className="stat-change">{wonDeals.length} negócios ganhos</span>{" "}
          no total
        </span>
      </div>
      <div className="stat-card">
        <div
          className="stat-icon"
          style={
            {
              "--icon-bg": "#f0e9fb",
              "--icon-color": "#8d6cc7",
            } as CSSProperties
          }
        >
          <Target size={20} />
        </div>
        <span className="stat-label">Taxa de conversão</span>
        <strong className="stat-value">
          {conversion}
          <small>%</small>
        </strong>
        <span className="stat-foot">Dos {closedCount} negócios concluídos</span>
      </div>
      <div className="stat-card">
        <div
          className="stat-icon"
          style={
            {
              "--icon-bg": "#fff1df",
              "--icon-color": "#c79742",
            } as CSSProperties
          }
        >
          <CheckCheck size={20} />
        </div>
        <span className="stat-label">Próximas ações</span>
        <strong className="stat-value">
          {String(pending.length).padStart(2, "0")}
        </strong>
        <span className="stat-foot">
          <span
            className={
              pending.some((task) => isOverdue(task.dueDate)) ? "overdue" : ""
            }
          >
            {pending.filter((task) => isOverdue(task.dueDate)).length} em atraso
          </span>{" "}
          · mantenha o ritmo
        </span>
      </div>
    </div>
  );

  const taskRow = (task: Task) => (
    <div className="task-row" key={task.id}>
      <button
        className={`task-check${task.status === "done" ? " completed" : ""}`}
        aria-label={`${task.status === "done" ? "Reabrir" : "Concluir"} tarefa ${task.title}`}
        aria-pressed={task.status === "done"}
        onClick={() => toggleTask(task)}
        disabled={!canUpdate("tasks", task)}
      >
        {task.status === "done" && <Check size={15} />}
      </button>
      <div className="task-body">
        <button
          className={`task-title${task.status === "done" ? " completed" : ""}`}
          onClick={() => openEditor("tasks", task)}
        >
          {task.title}
        </button>
        <div className="task-meta">
          <span
            className={
              task.status === "pending" && isOverdue(task.dueDate)
                ? "overdue task-due"
                : "task-due"
            }
          >
            <CalendarDays size={12} />
            {dateLabel(task.dueDate)}
          </span>
          {task.dealId && (
            <span>
              {data?.deals.find((deal) => deal.id === task.dealId)?.title ||
                "Negócio"}
            </span>
          )}
        </div>
      </div>
      <span className={`badge badge-${task.priority}`}>
        {{ high: "Alta", medium: "Média", low: "Baixa" }[task.priority]}
      </span>
      <Avatar name={task.owner} userId={task.ownerId} small />
      <div className="task-actions">
        <button
          className="icon-button"
          aria-label={`Editar tarefa ${task.title}`}
          disabled={!canUpdate("tasks", task)}
          onClick={() => openEditor("tasks", task)}
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-button"
          aria-label={`Excluir tarefa ${task.title}`}
          disabled={!canDelete("tasks", task)}
          onClick={() => confirmDeletion("tasks", task)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );

  const renderOverview = () => (
    <>
      {stats}
      <div className="overview-grid">
        <section className="section-card">
          <div className="section-heading">
            <div>
              <h2>Seu funil de vendas</h2>
              <p>Uma visão clara de cada etapa.</p>
            </div>
            <button className="btn btn-ghost" onClick={() => navigate("deals")}>
              Ver negócios <ArrowRight size={15} />
            </button>
          </div>
          <div className="funnel-list">
            {STAGES.map((stage) => {
              const stageDeals = data!.deals.filter(
                (deal) => deal.stage === stage.id,
              );
              const value = stageDeals.reduce(
                (sum, deal) => sum + deal.value,
                0,
              );
              const max = Math.max(
                ...STAGES.map((entry) =>
                  data!.deals
                    .filter((deal) => deal.stage === entry.id)
                    .reduce((sum, deal) => sum + deal.value, 0),
                ),
                1,
              );
              return (
                <div className="funnel-row" key={stage.id}>
                  <div className="funnel-row-top">
                    <span>
                      <i
                        className="column-dot"
                        style={{ background: stage.color }}
                      />
                      {stage.name}
                      <small>{stageDeals.length}</small>
                    </span>
                    <strong>{money(value)}</strong>
                  </div>
                  <div className="funnel-track">
                    <div
                      className="funnel-fill"
                      style={{
                        width: `${(value / max) * 100}%`,
                        background: stage.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="section-footer">
            <Sparkles size={16} />
            <span>Um próximo passo claro faz toda a diferença.</span>
          </div>
        </section>
        <section className="section-card">
          <div className="section-heading">
            <div>
              <h2>Próximas tarefas</h2>
              <p>Pequenas ações, grandes resultados.</p>
            </div>
            <button
              className="icon-button"
              aria-label="Nova tarefa"
              disabled={!canCreate("tasks")}
              onClick={() => openEditor("tasks")}
            >
              <Plus size={20} />
            </button>
          </div>
          <div className="tasks-list overview-tasks">
            {pending
              .sort((first, second) =>
                (first.dueDate || "9999").localeCompare(
                  second.dueDate || "9999",
                ),
              )
              .slice(0, 5)
              .map(taskRow)}
            {!pending.length && (
              <Empty
                title="Tudo em dia!"
                text="Sua equipe concluiu todas as tarefas."
              />
            )}
          </div>
          <button className="section-link" onClick={() => navigate("tasks")}>
            Ver todas as tarefas <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <section className="section-card activity-section">
        <div className="section-heading">
          <div>
            <h2>Aconteceu por aqui</h2>
            <p>As últimas atualizações da sua operação.</p>
          </div>
          <Clock3 size={19} />
        </div>
        <div className="activity-list">
          {data!.activities.slice(0, 8).map((activity) => (
            <div className="activity-item" key={activity.id}>
              <div className="activity-dot">
                <Check size={13} />
              </div>
              <div className="activity-content">
                <p>{activity.text}</p>
                <time className="activity-time" dateTime={activity.createdAt}>
                  {new Date(activity.createdAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            </div>
          ))}
          {!data!.activities.length && (
            <p className="text-muted">
              As atividades da sua equipe aparecerão aqui.
            </p>
          )}
        </div>
      </section>
    </>
  );

  const renderDeals = () => (
    <>
      {stats}
      <section className="pipeline-panel">
        <div className="pipeline-tabs">
          <button
            className={`pipeline-tab${dealScope === "all" ? " active" : ""}`}
            onClick={() => setDealScope("all")}
          >
            Todos os negócios <span>{data!.deals.length}</span>
          </button>
          <button
            className={`pipeline-tab${dealScope === "open" ? " active" : ""}`}
            onClick={() => setDealScope("open")}
          >
            Em andamento <span>{openDeals.length}</span>
          </button>
          <button
            className={`pipeline-tab${dealScope === "closed" ? " active" : ""}`}
            onClick={() => setDealScope("closed")}
          >
            Concluídos <span>{closedCount}</span>
          </button>
        </div>
        {toolbar(
          dealList.length,
          <div className="view-switch" aria-label="Visualização dos negócios">
            <button
              className={view === "kanban" ? "active" : ""}
              aria-label="Visualização Kanban"
              aria-pressed={view === "kanban"}
              onClick={() => setView("kanban")}
            >
              <Columns3 size={17} />
            </button>
            <button
              className={view === "list" ? "active" : ""}
              aria-label="Visualização em lista"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List size={18} />
            </button>
          </div>,
        )}
        {view === "kanban" ? (
          <div className="board-scroll">
            <div className="kanban-board">
              {STAGES.map((stage) => {
                const stageDeals = dealList.filter(
                  (deal) => deal.stage === stage.id,
                );
                return (
                  <section
                    key={stage.id}
                    className={`kanban-column${dropStage === stage.id ? " is-over" : ""}`}
                    aria-label={`Etapa ${stage.name}`}
                    style={{ "--stage-color": stage.color } as CSSProperties}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropStage(stage.id);
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node,
                        )
                      )
                        setDropStage(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const deal = data!.deals.find(
                        (entry) =>
                          entry.id === event.dataTransfer.getData("text/plain"),
                      );
                      setDropStage(null);
                      setDragging(false);
                      if (deal) moveDeal(deal, stage.id);
                    }}
                  >
                    <div className="column-heading">
                      <div className="column-label">
                        <span className="column-dot" />
                        <h3>{stage.name}</h3>
                        <span className="column-count">
                          {stageDeals.length}
                        </span>
                        <button
                          className="icon-button column-add"
                          aria-label={`Adicionar negócio em ${stage.name}`}
                          disabled={!canCreate("deals")}
                          onClick={() =>
                            openEditor("deals", undefined, { stage: stage.id })
                          }
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      <div className="column-total">
                        {money(
                          stageDeals.reduce((sum, deal) => sum + deal.value, 0),
                        )}
                      </div>
                    </div>
                    <div className="column-cards">
                      {stageDeals.map((deal) => (
                        <article
                          className={`deal-card${dragging ? " draggable-card" : ""}`}
                          draggable={canUpdate("deals", deal)}
                          key={deal.id}
                          onDragStart={(event) => {
                            if (!canUpdate("deals", deal)) {
                              event.preventDefault();
                              return;
                            }
                            event.dataTransfer.setData("text/plain", deal.id);
                            event.dataTransfer.effectAllowed = "move";
                            setDragging(true);
                          }}
                          onDragEnd={() => {
                            setDragging(false);
                            setDropStage(null);
                          }}
                        >
                          <div className="deal-card-top">
                            <span className="deal-company">
                              {companyName(deal.companyId)}
                            </span>
                            <button
                              className="icon-button"
                              aria-label={`Editar negócio ${deal.title}`}
                              disabled={!canUpdate("deals", deal)}
                              onClick={() => openEditor("deals", deal)}
                            >
                              <MoreHorizontal size={17} />
                            </button>
                          </div>
                          <button
                            className="deal-title"
                            onClick={() => openEditor("deals", deal)}
                          >
                            {deal.title}
                          </button>
                          <div className="deal-value">{money(deal.value)}</div>
                          <div className="deal-card-meta">
                            <span
                              className={`deal-date${!isClosed(deal) && isOverdue(deal.dueDate) ? " overdue" : ""}`}
                            >
                              <CalendarDays size={12} />
                              {dateLabel(deal.dueDate)}
                            </span>
                            {deal.contactId && (
                              <span
                                className="deal-contact"
                                title={contactName(deal.contactId)}
                              >
                                <Users size={12} />
                                {contactName(deal.contactId).split(" ")[0]}
                              </span>
                            )}
                          </div>
                          <div className="deal-card-footer">
                            <div className="deal-owner">
                              <Avatar
                                name={deal.owner}
                                userId={deal.ownerId}
                                small
                              />
                              <span>{deal.owner.split(" ")[0]}</span>
                            </div>
                            <select
                              className="stage-select"
                              value={deal.stage}
                              aria-label={`Etapa do negócio ${deal.title}`}
                              disabled={!canUpdate("deals", deal)}
                              onChange={(event) =>
                                moveDeal(deal, event.target.value as Stage)
                              }
                            >
                              {STAGES.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </article>
                      ))}
                      {!stageDeals.length && (
                        <div className="column-empty">
                          <span>Nenhum negócio aqui</span>
                          <small>Arraste um cartão para esta etapa</small>
                        </div>
                      )}
                      <button
                        className="add-deal-inline"
                        disabled={!canCreate("deals")}
                        onClick={() =>
                          openEditor("deals", undefined, { stage: stage.id })
                        }
                      >
                        <Plus size={15} />
                        Adicionar negócio
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Negócio</th>
                  <th>Valor</th>
                  <th>Etapa</th>
                  <th>Responsável</th>
                  <th>Previsão</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dealList.map((deal) => (
                  <tr key={deal.id}>
                    <td>
                      <button
                        className="cell-main"
                        onClick={() => openEditor("deals", deal)}
                      >
                        {deal.title}
                      </button>
                      <span className="cell-sub">
                        {companyName(deal.companyId)}
                      </span>
                    </td>
                    <td className="amount-cell">{money(deal.value)}</td>
                    <td>
                      <select
                        className="table-stage-select"
                        aria-label={`Etapa do negócio ${deal.title}`}
                        value={deal.stage}
                        onChange={(event) =>
                          moveDeal(deal, event.target.value as Stage)
                        }
                      >
                        {STAGES.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className="owner-cell">
                        <Avatar name={deal.owner} userId={deal.ownerId} small />
                        {deal.owner.split(" ")[0]}
                      </span>
                    </td>
                    <td
                      className={
                        !isClosed(deal) && isOverdue(deal.dueDate)
                          ? "overdue"
                          : ""
                      }
                    >
                      {dateLabel(deal.dueDate)}
                    </td>
                    <td>{actions("deals", deal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dealList.length && (
              <Empty
                title="Nenhum negócio encontrado"
                text="Ajuste a busca ou adicione uma nova oportunidade."
              />
            )}
          </div>
        )}
        <div className="board-summary">
          <span>
            <span className="summary-dot" />
            {dealList.length} negócios neste funil
          </span>
          <strong>
            Valor total{" "}
            <span>
              {money(dealList.reduce((sum, deal) => sum + deal.value, 0))}
            </span>
          </strong>
        </div>
      </section>
    </>
  );

  function toolbar(count: number, extra?: ReactNode) {
    return (
      <div className="toolbar">
        <label className="search-box">
          <Search size={17} />
          <input
            type="search"
            aria-label={`Buscar ${PAGES.find((entry) => entry.id === page)?.label.toLowerCase()}`}
            placeholder={`Buscar ${PAGES.find((entry) => entry.id === page)?.label.toLowerCase()}…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="owner-filter">
          <Users size={16} />
          <select
            className="filter-select"
            aria-label="Filtrar por responsável"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="all">Todos os responsáveis</option>
            {owners.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {page === "tasks" && (
          <select
            className="filter-select"
            aria-label="Filtrar tarefas por situação"
            value={taskFilter}
            onChange={(event) => setTaskFilter(event.target.value)}
          >
            <option value="pending">Pendentes</option>
            <option value="done">Concluídas</option>
            <option value="overdue">Em atraso</option>
            <option value="all">Todas as tarefas</option>
          </select>
        )}
        <span className="results-count">
          {count} {count === 1 ? "registro" : "registros"}
        </span>
        {extra}
      </div>
    );
  }
  function actions(type: Collection, entity: Entity) {
    return (
      <div className="table-actions">
        <button
          className="icon-button"
          aria-label={`Editar ${SINGULAR[type]} ${entityLabel(entity)}`}
          disabled={!canUpdate(type, entity)}
          onClick={() => openEditor(type, entity)}
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-button"
          aria-label={`Excluir ${SINGULAR[type]} ${entityLabel(entity)}`}
          disabled={!canDelete(type, entity)}
          onClick={() => confirmDeletion(type, entity)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  const renderContacts = () => (
    <section className="data-panel">
      {toolbar(contacts.length)}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Contato</th>
              <th>Empresa</th>
              <th>E-mail</th>
              <th>Telefone</th>
              <th>Responsável</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td>
                  <div className="person-cell">
                    <Avatar name={contact.name} />
                    <div>
                      <button
                        className="cell-main"
                        onClick={() => openEditor("contacts", contact)}
                      >
                        {contact.name}
                      </button>
                      <span className="cell-sub">
                        {contact.role || "Sem cargo informado"}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  {contact.companyId ? (
                    <button
                      className="relation-link"
                      onClick={() => {
                        const company = data!.companies.find(
                          (item) => item.id === contact.companyId,
                        );
                        if (company) openEditor("companies", company);
                      }}
                    >
                      {companyName(contact.companyId)}
                    </button>
                  ) : (
                    <span className="text-muted">Sem empresa</span>
                  )}
                </td>
                <td>
                  {contact.email ? (
                    <a
                      className="contact-link"
                      href={`mailto:${contact.email}`}
                    >
                      <Mail size={13} />
                      {contact.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {contact.phone ? (
                    <a
                      className="contact-link"
                      href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}
                    >
                      <Phone size={13} />
                      {contact.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <span className="owner-cell">
                    <Avatar
                      name={contact.owner}
                      userId={contact.ownerId}
                      small
                    />
                    {contact.owner.split(" ")[0]}
                  </span>
                </td>
                <td>{actions("contacts", contact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!contacts.length && (
          <Empty
            title="Nenhum contato encontrado"
            text="Adicione um contato ou ajuste os filtros da sua busca."
            action={
              <button
                className="btn btn-primary"
                disabled={!canCreate("contacts")}
                onClick={() => openEditor("contacts")}
              >
                <Plus size={15} />
                Novo contato
              </button>
            }
          />
        )}
      </div>
      <div className="board-summary">
        <span>
          {contacts.length} de {data!.contacts.length} contatos
        </span>
        <span>Relacionamentos que importam.</span>
      </div>
    </section>
  );

  const renderCompanies = () => (
    <section className="data-panel">
      {toolbar(companies.length)}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Segmento</th>
              <th>Contatos</th>
              <th>Valor do funil</th>
              <th>Responsável</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id}>
                <td>
                  <div className="person-cell">
                    <span
                      className="entity-avatar"
                      style={{ background: colorFor(company.name) }}
                    >
                      <Building2 size={19} />
                    </span>
                    <div>
                      <button
                        className="cell-main"
                        onClick={() => openEditor("companies", company)}
                      >
                        {company.name}
                      </button>
                      {safeWebsite(company.website) && (
                        <a
                          className="cell-sub website-link"
                          href={safeWebsite(company.website)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {company.website
                            .replace(/^https?:\/\//, "")
                            .replace(/\/$/, "")}
                          <ArrowUpRight size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  {company.sector || (
                    <span className="text-muted">Não informado</span>
                  )}
                </td>
                <td>
                  <span className="contact-count">
                    <Users size={14} />
                    {
                      data!.contacts.filter(
                        (contact) => contact.companyId === company.id,
                      ).length
                    }
                  </span>
                </td>
                <td className="amount-cell">
                  {money(
                    data!.deals
                      .filter(
                        (deal) =>
                          deal.companyId === company.id && !isClosed(deal),
                      )
                      .reduce((sum, deal) => sum + deal.value, 0),
                  )}
                </td>
                <td>
                  <span className="owner-cell">
                    <Avatar
                      name={company.owner}
                      userId={company.ownerId}
                      small
                    />
                    {company.owner.split(" ")[0]}
                  </span>
                </td>
                <td>{actions("companies", company)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!companies.length && (
          <Empty
            title="Nenhuma empresa encontrada"
            text="Cadastre uma empresa para conectar contatos e oportunidades."
            action={
              <button
                className="btn btn-primary"
                disabled={!canCreate("companies")}
                onClick={() => openEditor("companies")}
              >
                <Plus size={15} />
                Nova empresa
              </button>
            }
          />
        )}
      </div>
      <div className="board-summary">
        <span>
          {companies.length} de {data!.companies.length} empresas
        </span>
        <span>Conexões que geram oportunidades.</span>
      </div>
    </section>
  );

  const renderTasks = () => (
    <>
      <div className="task-stats">
        <div>
          <span className="task-stat-dot pending-dot" />
          <strong>{pending.length}</strong>
          <span>Pendentes</span>
        </div>
        <div>
          <span className="task-stat-dot overdue-dot" />
          <strong>
            {pending.filter((task) => isOverdue(task.dueDate)).length}
          </strong>
          <span>Em atraso</span>
        </div>
        <div>
          <span className="task-stat-dot done-dot" />
          <strong>
            {data!.tasks.filter((task) => task.status === "done").length}
          </strong>
          <span>Concluídas</span>
        </div>
      </div>
      <section className="data-panel">
        {toolbar(tasks.length)}
        <div className="tasks-list">
          {tasks.map(taskRow)}
          {!tasks.length && (
            <Empty
              title={
                taskFilter === "pending"
                  ? "Tudo em dia por aqui!"
                  : "Nenhuma tarefa encontrada"
              }
              text="Crie uma tarefa ou ajuste os filtros para continuar."
              action={
                <button
                  className="btn btn-primary"
                  disabled={!canCreate("tasks")}
                  onClick={() => openEditor("tasks")}
                >
                  <Plus size={15} />
                  Nova tarefa
                </button>
              }
            />
          )}
        </div>
        <div className="board-summary">
          <span>{tasks.length} tarefas nesta visualização</span>
          <span>Um passo de cada vez.</span>
        </div>
      </section>
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
          aria-label="Vox CRM - visão geral"
        >
          <span className="brand-mark">
            <BarChart3 size={24} strokeWidth={2.5} />
          </span>
          <span className="brand-word">
            vox<span>crm</span>
          </span>
          <span className="brand-tag">workspace</span>
        </a>
        <div className="workspace-switch">
          <div className="workspace-avatar">V</div>
          <div className="workspace-copy">
            <strong>{access.workspaceName}</strong>
            <span>Sua equipe, conectada</span>
          </div>
          <ShieldCheck size={16} />
        </div>
        <span className="nav-label">SEU ESPAÇO DE TRABALHO</span>
        <nav className="nav-list" aria-label="Navegação principal">
          {visiblePages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item${page === id ? " active" : ""}`}
              aria-label={label}
              title={label}
              aria-current={page === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon className="nav-icon" size={19} />
              <span>{label}</span>
              {id === "deals" && data && (
                <span className="nav-badge">{data.deals.length}</span>
              )}
              {id === "tasks" && !!pending.length && (
                <span className="nav-badge">{pending.length}</span>
              )}
              {id === "chat" && unread > 0 && (
                <span
                  className="nav-badge"
                  aria-label={`${unread} mensagens não lidas`}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-tip">
          <div>
            <Sparkles size={18} />
            <span>
              Menos planilhas.
              <br />
              <strong>Mais possibilidades.</strong>
            </span>
          </div>
          <p>Seu próximo grande negócio começa com uma boa conexão.</p>
          <button
            disabled={!canCreate("deals")}
            onClick={() => openEditor("deals")}
          >
            Criar oportunidade <ArrowRight size={14} />
          </button>
        </div>
        <button
          type="button"
          className="sidebar-footer sidebar-profile-button"
          onClick={() => navigate("profile")}
          aria-label="Editar meu perfil"
          title="Meu perfil"
        >
          <UserAvatar
            userId={access.userId}
            name={
              personal.me?.profile.fullName ||
              (auth.enabled ? accountName(auth.user) : "Usuário local")
            }
            className="user-avatar"
          />
          <span className="user-info">
            <strong>
              {personal.me?.profile.fullName ||
                (auth.enabled ? accountName(auth.user) : "Usuário local")}
            </strong>
            <span>{roleName(access.role)}</span>
          </span>
          <ShieldCheck size={16} />
        </button>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span className="mobile-brand">vox crm</span>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>CRM</strong>
            <ChevronRight size={13} />
            <span>{PAGES.find((entry) => entry.id === page)?.label}</span>
          </div>
          <div className="topbar-right">
            <span className="access-role-badge">{roleName(access.role)}</span>
            <span className="workspace-status">
              <span className="status-dot" />
              {auth.enabled ? "Banco Supabase" : "Dados salvos no workspace"}
            </span>
            {auth.enabled ? (
              <WorkspaceAccount
                onProfileOpen={() => navigate("profile")}
                displayName={personal.me?.profile.fullName}
                avatar={
                  <UserAvatar
                    userId={access.userId}
                    name={
                      personal.me?.profile.fullName || accountName(auth.user)
                    }
                    className="topbar-avatar"
                  />
                }
              />
            ) : (
              <button
                type="button"
                className="auth-profile-button"
                onClick={() => navigate("profile")}
                aria-label="Abrir meu perfil"
              >
                <UserAvatar
                  userId={access.userId}
                  name={personal.me?.profile.fullName || "Usuário local"}
                  className="topbar-avatar"
                />
              </button>
            )}
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "overview"
                  ? "BOM TRABALHO COMEÇA COM CLAREZA"
                  : "RELACIONAMENTOS QUE GERAM RESULTADOS"}
              </span>
              <h1>
                {PAGE_COPY[page][0]}
                {page === "deals" && <span className="heading-dot">.</span>}
              </h1>
              <p className="page-description">{PAGE_COPY[page][1]}</p>
            </div>
            <div className="heading-actions">
              {page !== "overview" &&
                page !== "settings" &&
                !collaborationPage &&
                !personalPage &&
                !suitePage &&
                access.permissions[collection].export && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => void exportData()}
                    disabled={!data}
                  >
                    <ArrowDownToLine size={16} />
                    <span className="button-label">Exportar</span>
                  </button>
                )}
              {page !== "settings" &&
                !collaborationPage &&
                !personalPage &&
                !suitePage &&
                canCreate(collection) && (
                  <button
                    className="btn btn-primary"
                    onClick={() => openEditor(collection)}
                    disabled={!data}
                  >
                    <Plus size={17} />
                    {NEW_LABEL[collection]}
                  </button>
                )}
            </div>
          </div>
          {actionError && (
            <div className="error-banner" role="alert">
              <span>{actionError}</span>
              <button
                className="icon-button"
                aria-label="Dispensar erro"
                onClick={() => setActionError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "settings" ? (
            <AccessSettings access={access} onAccessChange={updateAccess} />
          ) : suitePage ? (
            <Suspense
              fallback={
                <div className="loading-screen" role="status">
                  <LoaderCircle className="spinner" size={28} />
                  <span>Carregando módulo…</span>
                </div>
              }
            >
              {SALES_PAGES.includes(page) ? (
                <SalesSuite
                  section={
                    page as
                      | "leads"
                      | "automations"
                      | "billing"
                      | "contact-center"
                  }
                />
              ) : page === "projects" || page === "calendar" ? (
                <WorkSuite section={page} />
              ) : page === "people" || page === "processes" ? (
                <PeopleSuite section={page} />
              ) : (
                <CopilotPanel />
              )}
            </Suspense>
          ) : personalPage ? (
            <Suspense
              fallback={
                <div className="loading-screen" role="status">
                  <LoaderCircle className="spinner" size={28} />
                  <span>Carregando suas configurações…</span>
                </div>
              }
            >
              {page === "profile" ? <ProfilePanel /> : <PersonalSettings />}
            </Suspense>
          ) : collaborationPage ? (
            <Suspense
              fallback={
                <div className="loading-screen" role="status">
                  <LoaderCircle className="spinner" size={28} />
                  <span>Carregando espaço da equipe…</span>
                </div>
              }
            >
              <CollaborationExtras section={page as "chat" | "feed"} />
              {page === "chat" ? (
                <ChatPanel onUnreadChange={updateUnread} />
              ) : (
                <FeedPanel />
              )}
            </Suspense>
          ) : loadError ? (
            <div className="error-banner" role="alert">
              <span>{loadError}</span>
              <button
                className="btn btn-secondary retry-button"
                onClick={() => void load()}
              >
                Tentar novamente
              </button>
            </div>
          ) : !data ? (
            <div className="loading-screen" role="status">
              <LoaderCircle className="spinner" size={28} />
              <span>Preparando seu workspace…</span>
            </div>
          ) : page === "overview" ? (
            renderOverview()
          ) : page === "deals" ? (
            renderDeals()
          ) : page === "contacts" ? (
            renderContacts()
          ) : page === "companies" ? (
            renderCompanies()
          ) : (
            renderTasks()
          )}
          <footer className="page-footer">
            <span>Feito para conectar pessoas e oportunidades.</span>
            <span>
              Vox CRM <span className="footer-dot">·</span>{" "}
              {access.workspaceName}
            </span>
          </footer>
        </main>
      </div>
      {data && editor && (
        <EditorForm
          key={`${editor.collection}-${editor.entity?.id || "new"}`}
          editor={editor}
          data={data}
          saving={saving}
          error={formError}
          onClose={() => {
            if (!saving) setEditor(null);
          }}
          onSave={(values) => void saveEntity(values)}
          onDelete={() => {
            if (editor.entity)
              confirmDeletion(editor.collection, editor.entity);
          }}
        />
      )}
      {deleteTarget?.entity && (
        <Modal
          title={`Excluir ${SINGULAR[deleteTarget.collection]}?`}
          onClose={() => {
            if (!saving) setDeleteTarget(null);
          }}
        >
          <div className="modal-body">
            <p>
              O registro <strong>{entityLabel(deleteTarget.entity)}</strong>{" "}
              será excluído. Os demais registros serão mantidos e seus vínculos
              serão removidos.
            </p>
            <p className="field-help">Esta ação não pode ser desfeita.</p>
            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <div className="form-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void deleteEntity()}
                disabled={saving}
              >
                {saving ? (
                  <LoaderCircle className="spinner" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                {saving ? "Excluindo…" : "Excluir registro"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={15} />
          </span>
          {toast}
          <button
            className="icon-button"
            aria-label="Dispensar notificação"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
