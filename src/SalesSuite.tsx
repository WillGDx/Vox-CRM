import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Columns3,
  ExternalLink,
  FileText,
  List,
  LoaderCircle,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import { useAccess } from "./AccessGate";
import { authorizedFetch } from "./auth-client";
import { useSuite } from "./suite-client";
import type { SuiteItem } from "./suite-client";
import "./sales-suite.css";

type SalesSection = "leads" | "automations" | "billing" | "contact-center";
type EditorKind =
  | "leads"
  | "automations"
  | "quotes"
  | "invoices"
  | "service_conversations";
type Line = { description: string; quantity: number; unitPrice: number };
type FormValues = {
  title: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  status: string;
  notes: string;
  value: number;
  stage: string;
  targetStage: string;
  action: string;
  taskTitle: string;
  delayDays: number;
  enabled: boolean;
  customer: string;
  customerEmail: string;
  dueDate: string;
  dealId: string;
  channel: string;
  assigneeId: string;
  lines: Line[];
};
type IntegrationState = Record<
  "whatsapp" | "email" | "payments" | "phone" | "ai" | "siteChat",
  { configured: boolean; provider: string | null }
>;
const LEAD_STAGES = [
  { id: "new", label: "Novos", color: "#6599c9" },
  { id: "contacted", label: "Em contato", color: "#bc9c4c" },
  { id: "qualified", label: "Qualificados", color: "#2b9e88" },
  { id: "lost", label: "Descartados", color: "#b16b79" },
  { id: "converted", label: "Convertidos", color: "#8b7bb4" },
];
const DEAL_STAGES = [
  { id: "new", label: "Novo lead" },
  { id: "qualified", label: "Qualificação" },
  { id: "proposal", label: "Proposta" },
  { id: "negotiation", label: "Negociação" },
  { id: "won", label: "Ganho" },
  { id: "lost", label: "Perdido" },
];
const CHANNELS = [
  { id: "manual", label: "Registro manual", icon: MessageSquare },
  { id: "webchat", label: "Chat do site", icon: MessageSquare },
  { id: "whatsapp", label: "WhatsApp", icon: Phone },
  { id: "instagram", label: "Instagram", icon: MessageSquare },
  { id: "facebook", label: "Facebook", icon: MessageSquare },
  { id: "phone", label: "Telefonia", icon: Phone },
  { id: "email", label: "E-mail", icon: Mail },
];
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const txt = (item: SuiteItem, field: string) =>
  typeof item.data[field] === "string" ? (item.data[field] as string) : "";
const num = (item: SuiteItem, field: string) =>
  typeof item.data[field] === "number" ? (item.data[field] as number) : 0;
const date = (value: string) =>
  value
    ? (value.includes("T")
        ? new Date(value)
        : new Date(`${value}T12:00:00`)
      ).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Sem prazo";
const linesOf = (item: SuiteItem): Line[] =>
  Array.isArray(item.data.lines)
    ? item.data.lines.filter(
        (line): line is Line =>
          !!line &&
          typeof line === "object" &&
          typeof line.description === "string" &&
          Number.isFinite(line.quantity) &&
          Number.isFinite(line.unitPrice),
      )
    : [];
const totalOf = (item: SuiteItem) =>
  linesOf(item).reduce(
    (total, line) =>
      total + Math.round(line.quantity * line.unitPrice * 100) / 100,
    0,
  );
const billStatus = (item: SuiteItem) =>
  txt(item, "status") === "sent" &&
  item.kind === "invoices" &&
  txt(item, "dueDate") &&
  txt(item, "dueDate") <
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    )
    ? "overdue"
    : txt(item, "status") || "draft";
const STATUS: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  accepted: "Aceito",
  cancelled: "Cancelado",
  overdue: "Vencido",
  paid: "Pago",
  open: "Aberto",
  pending: "Em espera",
  closed: "Encerrado",
};

async function api(path: string, body?: unknown) {
  const response = await authorizedFetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(result?.error || "Não foi possível concluir esta ação.");
  return result;
}
function initial(kind: EditorKind, item?: SuiteItem): FormValues {
  return {
    title: item?.title || "",
    email: item ? txt(item, "email") : "",
    phone: item ? txt(item, "phone") : "",
    company: item ? txt(item, "company") : "",
    source: item ? txt(item, "source") : "Indicação",
    status: item
      ? txt(item, "status")
      : kind === "leads"
        ? "new"
        : kind === "service_conversations"
          ? "open"
          : "draft",
    notes: item ? txt(item, "notes") : "",
    value: item ? num(item, "value") : 0,
    stage: item ? txt(item, "stage") : "proposal",
    targetStage: item ? txt(item, "targetStage") : "negotiation",
    action: item ? txt(item, "action") : "create_task",
    taskTitle: item
      ? txt(item, "taskTitle")
      : "Fazer acompanhamento do negócio",
    delayDays: item ? num(item, "delayDays") : 1,
    enabled: item ? item.data.enabled === true : true,
    customer: item ? txt(item, "customer") : "",
    customerEmail: item ? txt(item, "customerEmail") : "",
    dueDate: item ? txt(item, "dueDate") : "",
    dealId: item ? txt(item, "dealId") : "",
    channel: item ? txt(item, "channel") : "manual",
    assigneeId: item ? txt(item, "assigneeId") : "",
    lines:
      item && linesOf(item).length
        ? linesOf(item)
        : [{ description: "", quantity: 1, unitPrice: 0 }],
  };
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={`sales-field${wide ? " sales-field-wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, { id })
        : children}
    </div>
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
    <div className="sales-empty">
      <span className="sales-empty-icon">
        <FileText size={26} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export default function SalesSuite({ section }: { section: SalesSection }) {
  const { access } = useAccess();
  const {
    items,
    loading,
    error: loadError,
    refresh,
    create,
    update,
    remove,
  } = useSuite();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [billTab, setBillTab] = useState<"quotes" | "invoices">("quotes");
  const [editor, setEditor] = useState<{
    kind: EditorKind;
    item?: SuiteItem;
  } | null>(null);
  const [values, setValues] = useState<FormValues>(() => initial("leads"));
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<SuiteItem | null>(null);
  const [documentItem, setDocumentItem] = useState<SuiteItem | null>(null);
  const [selectedConversation, setSelectedConversation] = useState("");
  const [message, setMessage] = useState("");
  const [messageDirection, setMessageDirection] = useState("outbound");
  const [conversationFilter, setConversationFilter] = useState("active");
  const [integrations, setIntegrations] = useState<IntegrationState | null>(
    null,
  );
  const [integrationError, setIntegrationError] = useState(false);
  const modalOpen = !!editor || !!confirmDelete || !!documentItem;
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>(
        ".sales-suite [role=dialog], .sales-suite [role=alertdialog]",
      );
      const dialog = dialogs[dialogs.length - 1];
      (
        dialog?.querySelector<HTMLElement>("input, textarea, select") ||
        dialog?.querySelector<HTMLElement>("button")
      )?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [modalOpen, !!confirmDelete, !!documentItem]);
  useEffect(() => {
    if (!modalOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !actionBusy) {
        event.preventDefault();
        if (confirmDelete) setConfirmDelete(null);
        else if (documentItem) setDocumentItem(null);
        else setEditor(null);
      }
      if (event.key !== "Tab") return;
      const dialogs = document.querySelectorAll<HTMLElement>(
        ".sales-suite [role=dialog], .sales-suite [role=alertdialog]",
      );
      const dialog = dialogs[dialogs.length - 1];
      const buttons = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        ) || [],
      ).filter((element) => element.offsetParent !== null);
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [modalOpen, busy, actionBusy, confirmDelete, documentItem]);
  useEffect(() => {
    setSearch("");
    setEditor(null);
    setError("");
    setSuccess("");
    setDocumentItem(null);
    setConfirmDelete(null);
  }, [section]);
  useEffect(() => {
    let active = true;
    api("/api/integrations/status")
      .then((result) => {
        if (active) {
          setIntegrations(result);
          setIntegrationError(false);
        }
      })
      .catch(() => {
        if (active) setIntegrationError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const elevated = access.role === "admin" || access.role === "manager";
  const dealPermissions = access.permissions.deals;
  const canEdit = (item: SuiteItem) =>
    (access.role === "admin" ||
      dealPermissions.update === "all" ||
      (dealPermissions.update === "own" &&
        (item.ownerId === access.userId ||
          (item.kind === "service_conversations" &&
            txt(item, "assigneeId") === access.userId)))) &&
    !(item.kind === "leads" && txt(item, "status") === "converted");
  const canDelete = (item: SuiteItem) =>
    access.role === "admin" ||
    dealPermissions.delete === "all" ||
    (dealPermissions.delete === "own" && item.ownerId === access.userId);
  const canCreateLead = dealPermissions.create;
  const leads = items.filter((item) => item.kind === "leads");
  const rules = items.filter((item) => item.kind === "automations");
  const webChannel = items.find(
    (item) => item.kind === "channels" && txt(item, "type") === "webchat",
  );
  const publicChatUrl = webChannel
    ? new URL(`/atendimento/${webChannel.id}`, window.location.origin).href
    : "";
  const bills = items.filter((item) => item.kind === billTab);
  const conversations = items.filter(
    (item) => item.kind === "service_conversations",
  );
  const contains = (item: SuiteItem) =>
    !search ||
    `${item.title} ${txt(item, "email")} ${txt(item, "company")} ${txt(item, "customer")}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.toLocaleLowerCase("pt-BR"));
  const filteredLeads = leads.filter(contains);
  const filteredConversations = conversations
    .filter(contains)
    .filter(
      (item) =>
        conversationFilter === "all" ||
        (conversationFilter === "active"
          ? txt(item, "status") !== "closed"
          : txt(item, "status") === conversationFilter),
    );
  const currentConversation =
    filteredConversations.find((item) => item.id === selectedConversation) ||
    filteredConversations[0];
  const conversationMessages = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.kind === "service_messages" &&
            txt(item, "conversationId") === currentConversation?.id,
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [items, currentConversation?.id],
  );
  useEffect(() => {
    setMessage("");
    setMessageDirection("outbound");
  }, [currentConversation?.id]);
  const open = (kind: EditorKind, item?: SuiteItem) => {
    setEditor({ kind, item });
    setValues(initial(kind, item));
    setError("");
    setSuccess("");
  };
  const change = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setValues((previous) => ({ ...previous, [field]: value }));
  const run = async (
    key: string,
    operation: () => Promise<unknown>,
    messageText: string,
  ) => {
    if (actionBusy) return;
    setActionBusy(key);
    setError("");
    setSuccess("");
    try {
      await operation();
      setSuccess(messageText);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setActionBusy("");
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    setError("");
    try {
      const title = values.title.trim();
      let data: Record<string, unknown>;
      if (editor.kind === "leads")
        data = {
          name: title,
          email: values.email.trim(),
          phone: values.phone.trim(),
          company: values.company.trim(),
          source: values.source.trim(),
          status: values.status,
          notes: values.notes.trim(),
          value: values.value,
        };
      else if (editor.kind === "automations")
        data = {
          trigger: "deal_stage_changed",
          stage: values.stage,
          action: values.action,
          taskTitle: values.taskTitle.trim(),
          delayDays: values.delayDays,
          enabled: values.enabled,
          ...(values.action === "update_deal"
            ? { targetStage: values.targetStage }
            : {}),
        };
      else if (editor.kind === "service_conversations")
        data = {
          channel: values.channel,
          customer: values.customer.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          status: values.status,
          assigneeId: values.assigneeId,
        };
      else
        data = {
          customer: values.customer.trim(),
          customerEmail: values.customerEmail.trim(),
          dueDate: values.dueDate,
          dealId: values.dealId,
          currency: "BRL",
          status: values.status,
          lines: values.lines.map((line) => ({
            ...line,
            description: line.description.trim(),
          })),
          notes: values.notes.trim(),
        };
      if (!title) throw new Error("Informe um título para continuar.");
      if (editor.kind === "quotes" || editor.kind === "invoices") {
        if (!values.customer.trim())
          throw new Error("Informe o cliente do documento.");
        if (
          values.lines.some(
            (line) =>
              !line.description.trim() ||
              !Number.isFinite(line.quantity) ||
              line.quantity <= 0 ||
              !Number.isFinite(line.unitPrice) ||
              line.unitPrice < 0,
          )
        )
          throw new Error(
            "Confira a descrição, quantidade e valor de cada item.",
          );
      }
      if (editor.item) await update(editor.item, { title, data });
      else await create(editor.kind, title, data);
      setEditor(null);
      setSuccess("Registro salvo com sucesso.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o registro.",
      );
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = (item: SuiteItem, status: string) =>
    run(item.id, () => update(item, { data: { status } }), "Etapa atualizada.");
  const convertLead = (item: SuiteItem) =>
    run(
      item.id,
      async () => {
        const result = await api("/api/suite/actions/convert_lead", {
          id: item.id,
          revision: item.revision,
        });
        if (!result?.data?.contactId || !result?.data?.dealId)
          throw new Error(
            "A conversão retornou uma resposta incompleta. Atualize a lista para conferir os registros.",
          );
        await refresh();
      },
      "Lead convertido em contato e negócio. Eles já estão disponíveis no CRM.",
    );
  const generateInvoice = (quote: SuiteItem) =>
    run(
      quote.id,
      async () => {
        await create("invoices", `Fatura · ${quote.title}`, {
          customer: txt(quote, "customer"),
          customerEmail: txt(quote, "customerEmail"),
          dueDate: txt(quote, "dueDate"),
          dealId: txt(quote, "dealId"),
          currency: "BRL",
          status: "draft",
          lines: linesOf(quote),
          notes: txt(quote, "notes"),
        });
        setBillTab("invoices");
      },
      "Fatura criada como rascunho a partir do orçamento.",
    );
  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !currentConversation ||
      !message.trim() ||
      actionBusy ||
      !dealPermissions.create
    )
      return;
    const content = message.trim();
    await run(
      "message",
      async () => {
        await create("service_messages", "Mensagem de atendimento", {
          conversationId: currentConversation.id,
          text: content,
          direction:
            txt(currentConversation, "channel") === "manual"
              ? messageDirection
              : "outbound",
        });
        setMessage("");
      },
      txt(currentConversation, "channel") === "webchat" &&
        messageDirection === "outbound"
        ? "Resposta registrada para o chat do site."
        : "Mensagem registrada no histórico do atendimento.",
    );
  };
  const toolbar = (actions: ReactNode) => (
    <div className="sales-toolbar">
      <label className="sales-search">
        <Search size={17} />
        <input
          aria-label="Buscar registros"
          placeholder="Buscar por nome, cliente ou e-mail…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="sales-toolbar-actions">
        <button
          className="btn btn-secondary"
          onClick={() => void refresh()}
          aria-label="Atualizar registros"
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "spinner" : ""} />
        </button>
        {actions}
      </div>
    </div>
  );

  return (
    <div className="sales-suite">
      {(loadError || error) && !editor && (
        <div className="sales-alert sales-alert-error" role="alert">
          {error || loadError}
          <button
            type="button"
            onClick={() => {
              setError("");
              void refresh();
            }}
          >
            <RefreshCw size={15} /> Atualizar
          </button>
        </div>
      )}
      {success && (
        <div className="sales-alert sales-alert-success" role="status">
          <Check size={16} />
          {success}
          <button onClick={() => setSuccess("")} aria-label="Fechar aviso">
            <X size={15} />
          </button>
        </div>
      )}
      {loading && items.length === 0 ? (
        <div className="sales-loading" role="status">
          <LoaderCircle className="spinner" size={24} /> Carregando seu espaço…
        </div>
      ) : (
        <>
          {section === "leads" && (
            <>
              <div className="sales-stats">
                <div>
                  <span>Leads em acompanhamento</span>
                  <strong>
                    {
                      leads.filter(
                        (lead) =>
                          !["lost", "converted"].includes(
                            txt(lead, "status"),
                          ) && !txt(lead, "dealId"),
                      ).length
                    }
                  </strong>
                  <small>Da primeira conversa à oportunidade</small>
                </div>
                <div>
                  <span>Qualificados</span>
                  <strong>
                    {
                      leads.filter(
                        (lead) => txt(lead, "status") === "qualified",
                      ).length
                    }
                  </strong>
                  <small>Prontos para o funil comercial</small>
                </div>
                <div>
                  <span>Potencial identificado</span>
                  <strong>
                    {BRL.format(
                      leads
                        .filter((lead) => txt(lead, "status") !== "lost")
                        .reduce((sum, lead) => sum + num(lead, "value"), 0),
                    )}
                  </strong>
                  <small>Valores informados nos leads</small>
                </div>
              </div>
              {toolbar(
                <>
                  <div
                    className="sales-view-switch"
                    aria-label="Visualização de leads"
                  >
                    <button
                      aria-label="Ver leads em Kanban"
                      aria-pressed={view === "kanban"}
                      onClick={() => setView("kanban")}
                    >
                      <Columns3 size={17} />
                    </button>
                    <button
                      aria-label="Ver leads em lista"
                      aria-pressed={view === "list"}
                      onClick={() => setView("list")}
                    >
                      <List size={17} />
                    </button>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => open("leads")}
                    disabled={!canCreateLead}
                  >
                    <Plus size={16} /> Novo lead
                  </button>
                </>,
              )}
              {filteredLeads.length === 0 ? (
                <Empty
                  title={
                    search
                      ? "Nenhum lead encontrado"
                      : "Toda boa relação começa com uma conversa"
                  }
                  text={
                    search
                      ? "Tente outro nome ou remova o filtro de busca."
                      : "Cadastre interessados, acompanhe os primeiros contatos e converta os qualificados em negócios."
                  }
                  action={
                    !search &&
                    canCreateLead && (
                      <button
                        className="btn btn-primary"
                        onClick={() => open("leads")}
                      >
                        <UserPlus size={16} /> Cadastrar primeiro lead
                      </button>
                    )
                  }
                />
              ) : view === "kanban" ? (
                <div className="sales-kanban">
                  {LEAD_STAGES.map((stage) => (
                    <section className="sales-lane" key={stage.id}>
                      <header>
                        <span style={{ background: stage.color }} />
                        <h3>{stage.label}</h3>
                        <b>
                          {
                            filteredLeads.filter(
                              (item) => txt(item, "status") === stage.id,
                            ).length
                          }
                        </b>
                      </header>
                      <div className="sales-lane-cards">
                        {filteredLeads
                          .filter((item) => txt(item, "status") === stage.id)
                          .map((lead) => (
                            <article className="sales-lead-card" key={lead.id}>
                              <span className="sales-eyebrow">
                                {txt(lead, "source") || "Origem não informada"}
                              </span>
                              <h4>{lead.title}</h4>
                              {txt(lead, "company") && (
                                <p>{txt(lead, "company")}</p>
                              )}
                              <div className="sales-lead-details">
                                {txt(lead, "email") && (
                                  <span>
                                    <Mail size={13} />
                                    {txt(lead, "email")}
                                  </span>
                                )}
                                {txt(lead, "phone") && (
                                  <span>
                                    <Phone size={13} />
                                    {txt(lead, "phone")}
                                  </span>
                                )}
                              </div>
                              <strong className="sales-lead-value">
                                {BRL.format(num(lead, "value"))}
                              </strong>
                              <div className="sales-card-actions">
                                <button
                                  className="sales-text-button"
                                  onClick={() => open("leads", lead)}
                                  disabled={!canEdit(lead)}
                                >
                                  <Pencil size={13} /> Editar
                                </button>
                                {txt(lead, "dealId") ? (
                                  <span className="sales-badge sales-badge-accepted">
                                    <Check size={12} />
                                    Convertido
                                  </span>
                                ) : (
                                  stage.id === "qualified" && (
                                    <button
                                      className="sales-text-button"
                                      disabled={
                                        !canEdit(lead) ||
                                        !access.permissions.contacts.create ||
                                        !access.permissions.deals.create ||
                                        !!actionBusy
                                      }
                                      onClick={() => void convertLead(lead)}
                                    >
                                      Converter <ArrowRight size={13} />
                                    </button>
                                  )
                                )}
                              </div>
                              {canEdit(lead) && !txt(lead, "dealId") && (
                                <label className="sales-stage-select">
                                  <span className="sr-only">
                                    Etapa de {lead.title}
                                  </span>
                                  <select
                                    value={txt(lead, "status") || "new"}
                                    disabled={!!actionBusy}
                                    onChange={(event) =>
                                      void changeStatus(
                                        lead,
                                        event.target.value,
                                      )
                                    }
                                  >
                                    {LEAD_STAGES.filter(
                                      (option) => option.id !== "converted",
                                    ).map((option) => (
                                      <option value={option.id} key={option.id}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </article>
                          ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="sales-table-wrap">
                  <table className="sales-table">
                    <thead>
                      <tr>
                        <th>Lead</th>
                        <th>Empresa / contato</th>
                        <th>Etapa</th>
                        <th>Potencial</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map((lead) => (
                        <tr key={lead.id}>
                          <td>
                            <strong>{lead.title}</strong>
                            <small>{txt(lead, "source")}</small>
                          </td>
                          <td>
                            {txt(lead, "company") || "—"}
                            <small>
                              {txt(lead, "email") || txt(lead, "phone")}
                            </small>
                          </td>
                          <td>
                            <span className="sales-badge">
                              {txt(lead, "dealId")
                                ? "Convertido"
                                : LEAD_STAGES.find(
                                    (stage) => stage.id === txt(lead, "status"),
                                  )?.label || "Novo"}
                            </span>
                          </td>
                          <td>{BRL.format(num(lead, "value"))}</td>
                          <td>
                            <div className="sales-row-actions">
                              <button
                                title="Editar lead"
                                aria-label={`Editar ${lead.title}`}
                                onClick={() => open("leads", lead)}
                                disabled={!canEdit(lead)}
                              >
                                <Pencil size={15} />
                              </button>
                              {txt(lead, "status") === "qualified" &&
                                !txt(lead, "dealId") && (
                                  <button
                                    title="Converter em contato e negócio"
                                    aria-label={`Converter ${lead.title}`}
                                    disabled={
                                      !canEdit(lead) ||
                                      !access.permissions.contacts.create ||
                                      !access.permissions.deals.create ||
                                      !!actionBusy
                                    }
                                    onClick={() => void convertLead(lead)}
                                  >
                                    <ArrowRight size={15} />
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {section === "automations" && (
            <>
              <div className="sales-feature-banner">
                <span>
                  <Zap size={25} />
                </span>
                <div>
                  <h2>O próximo passo acontece na hora certa</h2>
                  <p>
                    Ao mudar a etapa de um negócio, uma regra ativa pode criar a
                    tarefa de acompanhamento para o responsável.
                  </p>
                </div>
                <b>
                  {rules.filter((rule) => rule.data.enabled === true).length}{" "}
                  ativas
                </b>
              </div>
              {toolbar(
                <button
                  className="btn btn-primary"
                  disabled={!elevated}
                  onClick={() => open("automations")}
                >
                  <Plus size={16} /> Nova automação
                </button>,
              )}
              {!elevated && (
                <p className="sales-muted-note">
                  <ShieldCheck size={15} /> Administradores e gestores
                  configuram as regras de vendas.
                </p>
              )}
              {rules.filter(contains).length === 0 ? (
                <Empty
                  title="Seu funil, com menos trabalho repetitivo"
                  text="Crie uma regra para gerar uma tarefa quando um negócio chegar à etapa escolhida. O nome da tarefa e o prazo ficam definidos por você."
                  action={
                    elevated && (
                      <button
                        className="btn btn-primary"
                        onClick={() => open("automations")}
                      >
                        <Zap size={16} /> Criar primeira regra
                      </button>
                    )
                  }
                />
              ) : (
                <div className="sales-rule-list">
                  {rules.filter(contains).map((rule) => (
                    <article className="sales-rule-card" key={rule.id}>
                      <div className="sales-rule-icon">
                        <Zap size={21} />
                      </div>
                      <div className="sales-rule-copy">
                        <h3>{rule.title}</h3>
                        <div className="sales-rule-flow">
                          <span>
                            Negócio em{" "}
                            <b>
                              {DEAL_STAGES.find(
                                (stage) => stage.id === txt(rule, "stage"),
                              )?.label || txt(rule, "stage")}
                            </b>
                          </span>
                          <ArrowRight size={16} />
                          <span>
                            {txt(rule, "action") === "update_deal" ? (
                              <>
                                Mover para{" "}
                                <b>
                                  {DEAL_STAGES.find(
                                    (stage) =>
                                      stage.id === txt(rule, "targetStage"),
                                  )?.label || txt(rule, "targetStage")}
                                </b>
                              </>
                            ) : (
                              <>
                                Criar tarefa <b>{txt(rule, "taskTitle")}</b>
                              </>
                            )}
                          </span>
                        </div>
                        <p>
                          {txt(rule, "action") === "update_deal" ? (
                            "Mudança de etapa após a entrada no gatilho."
                          ) : (
                            <>
                              Prazo:{" "}
                              {num(rule, "delayDays") === 0
                                ? "no mesmo dia"
                                : `${num(rule, "delayDays")} dia(s) após a mudança`}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="sales-rule-actions">
                        <button
                          className={`sales-toggle ${rule.data.enabled ? "is-on" : ""}`}
                          role="switch"
                          aria-checked={rule.data.enabled === true}
                          aria-label={`${rule.data.enabled ? "Desativar" : "Ativar"} regra ${rule.title}`}
                          disabled={!elevated || !!actionBusy}
                          onClick={() =>
                            void run(
                              rule.id,
                              () =>
                                update(rule, {
                                  data: { enabled: !rule.data.enabled },
                                }),
                              "Regra atualizada.",
                            )
                          }
                        >
                          <span />
                        </button>
                        <button
                          className="sales-icon-button"
                          aria-label={`Editar regra ${rule.title}`}
                          disabled={!elevated}
                          onClick={() => open("automations", rule)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="sales-icon-button"
                          aria-label={`Excluir regra ${rule.title}`}
                          disabled={!elevated}
                          onClick={() => {
                            setError("");
                            setConfirmDelete(rule);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className="sales-integration-note">
                <Mail size={19} />
                <div>
                  <strong>E-mails automáticos</strong>
                  <p>
                    {integrations?.email.configured
                      ? "O serviço de e-mail está conectado. As regras desta tela criam tarefas de acompanhamento."
                      : "Conecte um serviço de envio de e-mails para habilitar entregas automáticas. As regras de tarefa funcionam sem essa integração."}
                  </p>
                </div>
              </div>
            </>
          )}
          {section === "billing" && (
            <>
              <div className="sales-stats">
                <div>
                  <span>Orçamentos em aberto</span>
                  <strong>
                    {BRL.format(
                      items
                        .filter(
                          (item) =>
                            item.kind === "quotes" &&
                            ["draft", "sent"].includes(billStatus(item)),
                        )
                        .reduce((sum, item) => sum + totalOf(item), 0),
                    )}
                  </strong>
                  <small>Valores em negociação</small>
                </div>
                <div>
                  <span>Faturas a receber</span>
                  <strong>
                    {BRL.format(
                      items
                        .filter(
                          (item) =>
                            item.kind === "invoices" &&
                            ["sent", "overdue"].includes(billStatus(item)),
                        )
                        .reduce((sum, item) => sum + totalOf(item), 0),
                    )}
                  </strong>
                  <small>Documentos enviados e ainda não pagos</small>
                </div>
                <div>
                  <span>Vencidas</span>
                  <strong>
                    {
                      items.filter(
                        (item) =>
                          item.kind === "invoices" &&
                          billStatus(item) === "overdue",
                      ).length
                    }
                  </strong>
                  <small>Faturas que precisam de acompanhamento</small>
                </div>
              </div>
              <div
                className="sales-tabs"
                role="tablist"
                aria-label="Documentos comerciais"
              >
                <button
                  role="tab"
                  aria-selected={billTab === "quotes"}
                  onClick={() => setBillTab("quotes")}
                >
                  <FileText size={16} /> Orçamentos{" "}
                  <span>
                    {items.filter((item) => item.kind === "quotes").length}
                  </span>
                </button>
                <button
                  role="tab"
                  aria-selected={billTab === "invoices"}
                  onClick={() => setBillTab("invoices")}
                >
                  <FileText size={16} /> Faturas{" "}
                  <span>
                    {items.filter((item) => item.kind === "invoices").length}
                  </span>
                </button>
              </div>
              {toolbar(
                <button
                  className="btn btn-primary"
                  onClick={() => open(billTab)}
                  disabled={!access.permissions.deals.create}
                >
                  <Plus size={16} />{" "}
                  {billTab === "quotes" ? "Novo orçamento" : "Nova fatura"}
                </button>,
              )}
              {bills.filter(contains).length === 0 ? (
                <Empty
                  title={
                    billTab === "quotes"
                      ? "Transforme a conversa em uma proposta"
                      : "Seus documentos de cobrança em um lugar"
                  }
                  text={
                    billTab === "quotes"
                      ? "Monte um orçamento com produtos, serviços, valores e condições. Você pode imprimir ou salvar em PDF pelo navegador."
                      : "Crie faturas com cliente, itens e vencimento. Um orçamento aceito também pode virar uma fatura."
                  }
                />
              ) : (
                <div className="sales-table-wrap">
                  <table className="sales-table">
                    <thead>
                      <tr>
                        <th>Documento</th>
                        <th>Cliente</th>
                        <th>Total</th>
                        <th>Vencimento</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bills.filter(contains).map((bill) => (
                        <tr key={bill.id}>
                          <td>
                            <strong>{bill.title}</strong>
                            <small>
                              {bill.kind === "quotes" ? "Orçamento" : "Fatura"}{" "}
                              · {date(bill.createdAt)}
                            </small>
                          </td>
                          <td>
                            {txt(bill, "customer")}
                            <small>{txt(bill, "customerEmail")}</small>
                          </td>
                          <td>
                            <strong>{BRL.format(totalOf(bill))}</strong>
                          </td>
                          <td>{date(txt(bill, "dueDate"))}</td>
                          <td>
                            <span
                              className={`sales-badge sales-badge-${billStatus(bill)}`}
                            >
                              {STATUS[billStatus(bill)] || billStatus(bill)}
                            </span>
                          </td>
                          <td>
                            <div className="sales-row-actions">
                              <button
                                aria-label={`Visualizar ${bill.title}`}
                                title="Visualizar e imprimir"
                                onClick={() => setDocumentItem(bill)}
                              >
                                <Printer size={16} />
                              </button>
                              <button
                                aria-label={`Editar ${bill.title}`}
                                title="Editar documento"
                                onClick={() => open(billTab, bill)}
                                disabled={
                                  !canEdit(bill) || billStatus(bill) === "paid"
                                }
                              >
                                <Pencil size={16} />
                              </button>
                              {bill.kind === "quotes" &&
                                billStatus(bill) === "accepted" && (
                                  <button
                                    aria-label={`Gerar fatura de ${bill.title}`}
                                    title="Gerar fatura"
                                    disabled={
                                      !access.permissions.deals.create ||
                                      !!actionBusy
                                    }
                                    onClick={() => void generateInvoice(bill)}
                                  >
                                    <ArrowRight size={16} />
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="sales-integration-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>Recebimentos on-line</strong>
                  <p>
                    {integrations?.payments.configured
                      ? "O serviço de pagamentos está conectado. Links confirmados aparecem nos documentos de cobrança."
                      : "Os documentos já podem ser emitidos. Para gerar links e confirmar pagamentos on-line, é necessário conectar um provedor de pagamentos."}
                  </p>
                </div>
              </div>
            </>
          )}
          {section === "contact-center" && (
            <>
              <div className="sales-channel-strip">
                {CHANNELS.filter((channel) => channel.id !== "manual").map(
                  ({ id, label, icon: Icon }) => {
                    const providerKey =
                      id === "webchat"
                        ? "siteChat"
                        : id === "phone"
                          ? "phone"
                          : id === "email"
                            ? "email"
                            : id === "whatsapp"
                              ? "whatsapp"
                              : null;
                    const connected =
                      !!providerKey &&
                      integrations?.[providerKey as keyof IntegrationState]
                        ?.configured;
                    return (
                      <div
                        className={`sales-channel ${connected ? "is-connected" : ""}`}
                        key={id}
                      >
                        <Icon size={19} />
                        <strong>{label}</strong>
                        <span>
                          <i />
                          {integrationError
                            ? "Status indisponível"
                            : !integrations
                              ? "Verificando…"
                              : connected
                                ? "Disponível"
                                : "Não conectado"}
                        </span>
                      </div>
                    );
                  },
                )}
              </div>
              <div className="sales-widget-settings">
                <div>
                  <strong>Chat para seus clientes</strong>
                  <p>
                    Compartilhe este endereço no seu site. As conversas
                    recebidas aparecem neste painel.
                  </p>
                </div>
                {webChannel ? (
                  <>
                    <input
                      aria-label="Link público do chat do site"
                      value={publicChatUrl}
                      readOnly
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={!webChannel.data.enabled || !!actionBusy}
                      onClick={() =>
                        void run(
                          "copy-link",
                          () => navigator.clipboard.writeText(publicChatUrl),
                          "Link do chat copiado.",
                        )
                      }
                    >
                      Copiar link
                    </button>
                    <a
                      className="sales-text-button"
                      href={publicChatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir <ExternalLink size={14} />
                    </a>
                    {elevated && (
                      <button
                        className={`sales-toggle ${webChannel.data.enabled ? "is-on" : ""}`}
                        role="switch"
                        aria-checked={webChannel.data.enabled === true}
                        aria-label="Ativar chat público do site"
                        disabled={!!actionBusy}
                        onClick={() =>
                          void run(
                            "webchat",
                            () =>
                              update(webChannel, {
                                data: { enabled: !webChannel.data.enabled },
                              }),
                            "Canal do site atualizado.",
                          )
                        }
                      >
                        <span />
                      </button>
                    )}
                  </>
                ) : elevated ? (
                  <button
                    className="btn btn-secondary"
                    disabled={!!actionBusy}
                    onClick={() =>
                      void run(
                        "webchat",
                        () =>
                          create("channels", "Chat do site", {
                            type: "webchat",
                            enabled: true,
                          }),
                        "Canal do site criado. O link já pode ser compartilhado.",
                      )
                    }
                  >
                    <MessageSquare size={16} /> Criar canal do site
                  </button>
                ) : (
                  <span className="sales-muted-note">
                    Um administrador ou gestor pode criar o canal do site.
                  </span>
                )}
              </div>
              {toolbar(
                <button
                  className="btn btn-primary"
                  onClick={() => open("service_conversations")}
                  disabled={!dealPermissions.create}
                >
                  <Plus size={16} /> Novo atendimento
                </button>,
              )}
              <div className="sales-inbox">
                <aside className="sales-inbox-list">
                  <div className="sales-inbox-filter">
                    <strong>Atendimentos</strong>
                    <select
                      aria-label="Filtrar atendimentos"
                      value={conversationFilter}
                      onChange={(event) =>
                        setConversationFilter(event.target.value)
                      }
                    >
                      <option value="active">Em andamento</option>
                      <option value="all">Todos</option>
                      <option value="open">Abertos</option>
                      <option value="pending">Em espera</option>
                      <option value="closed">Encerrados</option>
                    </select>
                  </div>
                  {filteredConversations.length ? (
                    filteredConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        className={`sales-inbox-item${currentConversation?.id === conversation.id ? " is-selected" : ""}`}
                        onClick={() => {
                          setSelectedConversation(conversation.id);
                          setMessage("");
                        }}
                      >
                        <span className="sales-conversation-avatar">
                          {(txt(conversation, "customer") || conversation.title)
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                        <span>
                          <strong>
                            {txt(conversation, "customer") ||
                              conversation.title}
                          </strong>
                          <small>{conversation.title}</small>
                          <em>
                            {CHANNELS.find(
                              (channel) =>
                                channel.id === txt(conversation, "channel"),
                            )?.label || "Manual"}{" "}
                            · {STATUS[txt(conversation, "status")] || "Aberto"}
                          </em>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="sales-inbox-empty">
                      Nenhum atendimento neste filtro.
                    </div>
                  )}
                </aside>
                <section className="sales-inbox-detail">
                  {currentConversation ? (
                    <>
                      <header>
                        <div>
                          <h3>{currentConversation.title}</h3>
                          <p>
                            {txt(currentConversation, "customer")}{" "}
                            {txt(currentConversation, "email") &&
                              `· ${txt(currentConversation, "email")}`}
                          </p>
                        </div>
                        <div className="sales-inbox-header-actions">
                          <select
                            aria-label="Status do atendimento"
                            value={txt(currentConversation, "status") || "open"}
                            onChange={(event) =>
                              void changeStatus(
                                currentConversation,
                                event.target.value,
                              )
                            }
                            disabled={
                              !canEdit(currentConversation) || !!actionBusy
                            }
                          >
                            <option value="open">Aberto</option>
                            <option value="pending">Em espera</option>
                            <option value="closed">Encerrado</option>
                          </select>
                          <button
                            className="sales-icon-button"
                            aria-label="Editar atendimento"
                            onClick={() =>
                              open("service_conversations", currentConversation)
                            }
                            disabled={!canEdit(currentConversation)}
                          >
                            <Pencil size={16} />
                          </button>
                        </div>
                      </header>
                      <div className="sales-conversation-meta">
                        <span>
                          <Phone size={13} />
                          {txt(currentConversation, "phone") ||
                            "Telefone não informado"}
                        </span>
                        <span>
                          Responsável:{" "}
                          {access.members.find(
                            (member) =>
                              member.userId ===
                              txt(currentConversation, "assigneeId"),
                          )?.displayName || "Não atribuído"}
                        </span>
                      </div>
                      <div className="sales-messages" aria-live="polite">
                        {conversationMessages.length ? (
                          conversationMessages.map((entry) => (
                            <article
                              key={entry.id}
                              className={`sales-message ${txt(entry, "direction") === "outbound" ? "sales-message-outbound" : ""}`}
                            >
                              <small>
                                {txt(entry, "direction") === "outbound"
                                  ? "Equipe"
                                  : txt(currentConversation, "customer") ||
                                    "Cliente"}
                              </small>
                              <p>{txt(entry, "text")}</p>
                              <time dateTime={entry.createdAt}>
                                {new Date(entry.createdAt).toLocaleString(
                                  "pt-BR",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </time>
                            </article>
                          ))
                        ) : (
                          <div className="sales-message-placeholder">
                            <MessageSquare size={29} />
                            <h4>O contexto da conversa fica aqui</h4>
                            <p>
                              Registre o histórico do atendimento ou responda às
                              mensagens recebidas pelo chat do site.
                            </p>
                          </div>
                        )}
                      </div>
                      <form
                        className="sales-message-form"
                        onSubmit={(event) => void submitMessage(event)}
                      >
                        <div>
                          <label>
                            <span>
                              {txt(currentConversation, "channel") === "webchat"
                                ? "Resposta ao cliente"
                                : "Mensagem do histórico"}
                            </span>
                            <textarea
                              aria-label="Mensagem do atendimento"
                              value={message}
                              maxLength={4000}
                              rows={3}
                              placeholder="Escreva uma mensagem…"
                              onChange={(event) =>
                                setMessage(event.target.value)
                              }
                              disabled={
                                txt(currentConversation, "status") === "closed"
                              }
                              required
                            />
                          </label>
                        </div>
                        <footer>
                          {txt(currentConversation, "channel") !==
                            "webchat" && (
                            <select
                              aria-label="Origem da mensagem registrada"
                              value={messageDirection}
                              onChange={(event) =>
                                setMessageDirection(event.target.value)
                              }
                            >
                              <option value="outbound">
                                Enviada pela equipe
                              </option>
                              <option value="inbound">
                                Recebida do cliente
                              </option>
                            </select>
                          )}
                          <small>
                            {txt(currentConversation, "channel") === "webchat"
                              ? "A resposta fica disponível na sessão do visitante."
                              : "Registro interno. Mensagens externas exigem um canal conectado."}
                          </small>
                          <button
                            className="btn btn-primary"
                            disabled={
                              !message.trim() ||
                              !!actionBusy ||
                              !dealPermissions.create ||
                              txt(currentConversation, "status") === "closed"
                            }
                          >
                            <Send size={15} />
                            {txt(currentConversation, "channel") === "webchat"
                              ? "Responder"
                              : "Registrar"}
                          </button>
                        </footer>
                      </form>
                    </>
                  ) : (
                    <Empty
                      title="Atendimento com contexto"
                      text="Selecione uma conversa ou registre o primeiro atendimento. Os canais externos são habilitados ao conectar os respectivos serviços."
                      action={
                        <button
                          className="btn btn-primary"
                          onClick={() => open("service_conversations")}
                          disabled={!dealPermissions.create}
                        >
                          <Plus size={16} /> Novo atendimento
                        </button>
                      }
                    />
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}
      {editor && (
        <div
          className="sales-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setEditor(null);
          }}
        >
          <section
            className="sales-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sales-editor-title"
          >
            <header>
              <div>
                <span className="sales-eyebrow">
                  {editor.item ? "Editar registro" : "Novo registro"}
                </span>
                <h2 id="sales-editor-title">
                  {editor.kind === "leads"
                    ? "Lead"
                    : editor.kind === "automations"
                      ? "Automação de vendas"
                      : editor.kind === "quotes"
                        ? "Orçamento"
                        : editor.kind === "invoices"
                          ? "Fatura"
                          : "Atendimento"}
                </h2>
              </div>
              <button
                aria-label="Fechar formulário"
                className="sales-icon-button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                <X size={20} />
              </button>
            </header>
            <form onSubmit={(event) => void submit(event)}>
              <fieldset disabled={busy}>
                <div className="sales-form-grid">
                  <Field
                    label={editor.kind === "leads" ? "Nome do lead" : "Título"}
                    wide
                  >
                    <input
                      autoFocus
                      required
                      maxLength={160}
                      value={values.title}
                      onChange={(event) => change("title", event.target.value)}
                      placeholder={
                        editor.kind === "leads"
                          ? "Nome da pessoa interessada"
                          : editor.kind === "automations"
                            ? "Acompanhar propostas enviadas"
                            : "Identifique este registro"
                      }
                    />
                  </Field>
                  {editor.kind === "leads" && (
                    <>
                      <Field label="E-mail">
                        <input
                          type="email"
                          maxLength={254}
                          value={values.email}
                          onChange={(event) =>
                            change("email", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Telefone">
                        <input
                          type="tel"
                          maxLength={40}
                          value={values.phone}
                          onChange={(event) =>
                            change("phone", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Empresa">
                        <input
                          maxLength={160}
                          value={values.company}
                          onChange={(event) =>
                            change("company", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Origem">
                        <select
                          value={values.source}
                          onChange={(event) =>
                            change("source", event.target.value)
                          }
                        >
                          {[
                            "Indicação",
                            "Site",
                            "WhatsApp",
                            "Redes sociais",
                            "Evento",
                            "Prospecção",
                            "Outro",
                          ].map((source) => (
                            <option key={source}>{source}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Etapa">
                        <select
                          value={values.status}
                          onChange={(event) =>
                            change("status", event.target.value)
                          }
                        >
                          {LEAD_STAGES.filter(
                            (stage) => stage.id !== "converted",
                          ).map((stage) => (
                            <option value={stage.id} key={stage.id}>
                              {stage.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Valor potencial (R$)">
                        <input
                          type="number"
                          min={0}
                          max={999999999}
                          step="0.01"
                          value={values.value}
                          onChange={(event) =>
                            change("value", Number(event.target.value))
                          }
                        />
                      </Field>
                    </>
                  )}
                  {editor.kind === "automations" && (
                    <>
                      <Field label="Quando o negócio entrar na etapa" wide>
                        <select
                          value={values.stage}
                          onChange={(event) => {
                            change("stage", event.target.value);
                            if (event.target.value === values.targetStage)
                              change(
                                "targetStage",
                                DEAL_STAGES.find(
                                  (stage) => stage.id !== event.target.value,
                                )!.id,
                              );
                          }}
                        >
                          {DEAL_STAGES.map((stage) => (
                            <option value={stage.id} key={stage.id}>
                              {stage.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Ação" wide>
                        <select
                          value={values.action}
                          onChange={(event) =>
                            change("action", event.target.value)
                          }
                        >
                          <option value="create_task">
                            Criar uma tarefa para o responsável
                          </option>
                          <option value="update_deal">
                            Mover o negócio para outra etapa
                          </option>
                        </select>
                      </Field>
                      {values.action === "create_task" && (
                        <>
                          <Field label="Nome da tarefa" wide>
                            <input
                              required
                              maxLength={160}
                              value={values.taskTitle}
                              onChange={(event) =>
                                change("taskTitle", event.target.value)
                              }
                            />
                          </Field>
                        </>
                      )}
                      {values.action === "update_deal" && (
                        <Field label="Etapa de destino" wide>
                          <select
                            value={values.targetStage}
                            onChange={(event) =>
                              change("targetStage", event.target.value)
                            }
                          >
                            {DEAL_STAGES.filter(
                              (stage) => stage.id !== values.stage,
                            ).map((stage) => (
                              <option value={stage.id} key={stage.id}>
                                {stage.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      {values.action === "create_task" && (
                        <Field label="Prazo da tarefa em dias">
                          <input
                            type="number"
                            min={0}
                            max={365}
                            step={1}
                            required
                            value={values.delayDays}
                            onChange={(event) =>
                              change("delayDays", Number(event.target.value))
                            }
                          />
                        </Field>
                      )}
                      <Field label="Situação da regra">
                        <select
                          value={values.enabled ? "on" : "off"}
                          onChange={(event) =>
                            change("enabled", event.target.value === "on")
                          }
                        >
                          <option value="on">Ativa</option>
                          <option value="off">Pausada</option>
                        </select>
                      </Field>
                      <p className="sales-form-help sales-field-wide">
                        A regra é aplicada nas próximas mudanças de etapa.
                        Negócios que já estão nessa etapa não recebem uma tarefa
                        retroativa.
                      </p>
                    </>
                  )}
                  {(editor.kind === "quotes" || editor.kind === "invoices") && (
                    <>
                      <Field label="Cliente">
                        <input
                          required
                          maxLength={160}
                          value={values.customer}
                          onChange={(event) =>
                            change("customer", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="E-mail do cliente">
                        <input
                          type="email"
                          maxLength={254}
                          value={values.customerEmail}
                          onChange={(event) =>
                            change("customerEmail", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label={
                          editor.kind === "quotes" ? "Validade" : "Vencimento"
                        }
                      >
                        <input
                          type="date"
                          value={values.dueDate}
                          onChange={(event) =>
                            change("dueDate", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Status">
                        <select
                          value={values.status}
                          onChange={(event) =>
                            change("status", event.target.value)
                          }
                        >
                          <option value="draft">Rascunho</option>
                          <option value="sent">Enviado</option>
                          {editor.kind === "quotes" && (
                            <option value="accepted">Aceito</option>
                          )}
                          <option value="cancelled">Cancelado</option>
                        </select>
                      </Field>
                      <div className="sales-line-items sales-field-wide">
                        <header>
                          <h3>Produtos e serviços</h3>
                          <button
                            type="button"
                            className="sales-text-button"
                            onClick={() =>
                              change("lines", [
                                ...values.lines,
                                { description: "", quantity: 1, unitPrice: 0 },
                              ])
                            }
                            disabled={values.lines.length >= 20}
                          >
                            <Plus size={14} /> Adicionar item
                          </button>
                        </header>
                        {values.lines.map((line, index) => (
                          <div className="sales-line-row" key={index}>
                            <Field label={`Descrição do item ${index + 1}`}>
                              <input
                                required
                                maxLength={300}
                                value={line.description}
                                placeholder="Produto ou serviço"
                                onChange={(event) =>
                                  change(
                                    "lines",
                                    values.lines.map((candidate, position) =>
                                      position === index
                                        ? {
                                            ...candidate,
                                            description: event.target.value,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <Field label="Qtd.">
                              <input
                                aria-label={`Quantidade do item ${index + 1}`}
                                required
                                type="number"
                                min={0.001}
                                max={1000000}
                                step="0.001"
                                value={line.quantity}
                                onChange={(event) =>
                                  change(
                                    "lines",
                                    values.lines.map((candidate, position) =>
                                      position === index
                                        ? {
                                            ...candidate,
                                            quantity: Number(
                                              event.target.value,
                                            ),
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <Field label="Valor unitário (R$)">
                              <input
                                aria-label={`Valor do item ${index + 1}`}
                                required
                                type="number"
                                min={0}
                                max={999999999}
                                step="0.01"
                                value={line.unitPrice}
                                onChange={(event) =>
                                  change(
                                    "lines",
                                    values.lines.map((candidate, position) =>
                                      position === index
                                        ? {
                                            ...candidate,
                                            unitPrice: Number(
                                              event.target.value,
                                            ),
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <button
                              className="sales-icon-button"
                              type="button"
                              aria-label={`Remover item ${index + 1}`}
                              disabled={values.lines.length === 1}
                              onClick={() =>
                                change(
                                  "lines",
                                  values.lines.filter(
                                    (_, position) => position !== index,
                                  ),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                        <div className="sales-bill-total">
                          <span>Total do documento</span>
                          <strong>
                            {BRL.format(
                              values.lines.reduce(
                                (sum, line) =>
                                  sum +
                                  Math.round(
                                    line.quantity * line.unitPrice * 100,
                                  ) /
                                    100,
                                0,
                              ),
                            )}
                          </strong>
                        </div>
                      </div>
                      <p className="sales-form-help sales-field-wide">
                        O status “Enviado” registra sua ação de envio. O
                        documento não é enviado por e-mail automaticamente.
                      </p>
                    </>
                  )}
                  {editor.kind === "service_conversations" && (
                    <>
                      <Field label="Nome do cliente">
                        <input
                          required
                          maxLength={160}
                          value={values.customer}
                          onChange={(event) =>
                            change("customer", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Canal">
                        <select
                          value={values.channel}
                          onChange={(event) =>
                            change("channel", event.target.value)
                          }
                        >
                          <option value="manual">Registro manual</option>
                          {editor.item && values.channel !== "manual" && (
                            <option value={values.channel}>
                              {CHANNELS.find(
                                (channel) => channel.id === values.channel,
                              )?.label || values.channel}
                            </option>
                          )}
                        </select>
                      </Field>
                      <Field label="E-mail">
                        <input
                          type="email"
                          maxLength={254}
                          value={values.email}
                          onChange={(event) =>
                            change("email", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Telefone">
                        <input
                          type="tel"
                          maxLength={40}
                          value={values.phone}
                          onChange={(event) =>
                            change("phone", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Responsável">
                        <select
                          value={values.assigneeId}
                          onChange={(event) =>
                            change("assigneeId", event.target.value)
                          }
                        >
                          <option value="">Não atribuído</option>
                          {access.members
                            .filter((member) => member.active)
                            .map((member) => (
                              <option key={member.userId} value={member.userId}>
                                {member.displayName}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Status">
                        <select
                          value={values.status}
                          onChange={(event) =>
                            change("status", event.target.value)
                          }
                        >
                          <option value="open">Aberto</option>
                          <option value="pending">Em espera</option>
                          <option value="closed">Encerrado</option>
                        </select>
                      </Field>
                    </>
                  )}
                  {!["automations", "service_conversations"].includes(
                    editor.kind,
                  ) && (
                    <Field
                      label={
                        editor.kind === "quotes" || editor.kind === "invoices"
                          ? "Condições e observações"
                          : "Observações"
                      }
                      wide
                    >
                      <textarea
                        rows={3}
                        maxLength={4000}
                        value={values.notes}
                        onChange={(event) =>
                          change("notes", event.target.value)
                        }
                      />
                    </Field>
                  )}
                </div>
              </fieldset>
              {error && (
                <div className="sales-alert sales-alert-error" role="alert">
                  {error}
                </div>
              )}
              <footer className="sales-modal-footer">
                {editor.item &&
                  canDelete(editor.item) &&
                  editor.kind !== "automations" && (
                    <button
                      className="sales-text-button sales-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setConfirmDelete(editor.item!);
                      }}
                    >
                      <Trash2 size={15} /> Excluir
                    </button>
                  )}
                <span />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="spinner" size={16} />
                  ) : (
                    <Check size={16} />
                  )}{" "}
                  {busy ? "Salvando…" : "Salvar"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {confirmDelete && (
        <div className="sales-modal-overlay sales-confirm-overlay">
          <section
            className="sales-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sales-delete-title"
          >
            <Trash2 size={25} />
            <h2 id="sales-delete-title">Excluir este registro?</h2>
            <p>
              “{confirmDelete.title}” será removido. Esta ação não pode ser
              desfeita.
            </p>
            {error && (
              <div className="sales-alert sales-alert-error" role="alert">
                {error}
              </div>
            )}
            <footer>
              <button
                className="btn btn-secondary"
                disabled={!!actionBusy}
                onClick={() => setConfirmDelete(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                disabled={!!actionBusy}
                onClick={() =>
                  void run(
                    confirmDelete.id,
                    async () => {
                      await remove(confirmDelete);
                      if (editor?.item?.id === confirmDelete.id)
                        setEditor(null);
                      setConfirmDelete(null);
                    },
                    "Registro excluído.",
                  )
                }
              >
                {actionBusy ? "Excluindo…" : "Excluir registro"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {documentItem && (
        <div className="sales-modal-overlay sales-document-overlay">
          <section
            className="sales-document-viewer"
            role="dialog"
            aria-modal="true"
            aria-label="Documento comercial"
          >
            <div className="sales-document-toolbar">
              <strong>Visualizar documento</strong>
              <button
                className="btn btn-secondary"
                onClick={() => window.print()}
              >
                <Printer size={16} /> Imprimir / salvar PDF
              </button>
              <button
                className="sales-icon-button"
                aria-label="Fechar documento"
                onClick={() => setDocumentItem(null)}
              >
                <X size={20} />
              </button>
            </div>
            <article id="sales-print-document" className="sales-print-document">
              <header>
                <div>
                  <span className="sales-document-logo">
                    vox<span>crm</span>
                  </span>
                  <strong>{access.workspaceName}</strong>
                </div>
                <div>
                  <span>
                    {documentItem.kind === "quotes" ? "ORÇAMENTO" : "FATURA"}
                  </span>
                  <h2>{documentItem.title}</h2>
                  <p>{documentItem.id.slice(0, 8).toUpperCase()}</p>
                </div>
              </header>
              <div className="sales-document-parties">
                <div>
                  <small>CLIENTE</small>
                  <strong>{txt(documentItem, "customer")}</strong>
                  <p>{txt(documentItem, "customerEmail")}</p>
                </div>
                <div>
                  <small>
                    {documentItem.kind === "quotes" ? "VALIDADE" : "VENCIMENTO"}
                  </small>
                  <strong>{date(txt(documentItem, "dueDate"))}</strong>
                  <p>Emitido em {date(documentItem.createdAt)}</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Quantidade</th>
                    <th>Valor unitário</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {linesOf(documentItem).map((line, index) => (
                    <tr key={index}>
                      <td>{line.description}</td>
                      <td>{line.quantity.toLocaleString("pt-BR")}</td>
                      <td>{BRL.format(line.unitPrice)}</td>
                      <td>
                        {BRL.format(
                          Math.round(line.quantity * line.unitPrice * 100) /
                            100,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sales-document-total">
                <span>Total em reais</span>
                <strong>{BRL.format(totalOf(documentItem))}</strong>
              </div>
              {txt(documentItem, "notes") && (
                <section>
                  <h3>Condições e observações</h3>
                  <p>{txt(documentItem, "notes")}</p>
                </section>
              )}
              {txt(documentItem, "paymentUrl").startsWith("https://") && (
                <p>
                  <a
                    href={txt(documentItem, "paymentUrl")}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir link de pagamento <ExternalLink size={13} />
                  </a>
                </p>
              )}
              <footer>
                Documento comercial ·{" "}
                {STATUS[billStatus(documentItem)] || "Rascunho"}
                <br />
                Este documento não substitui uma nota fiscal.
              </footer>
            </article>
          </section>
        </div>
      )}
    </div>
  );
}
