import { cloneElement, useEffect, useId, useMemo, useState } from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  GitBranch,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  UserRound,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useAccess } from "./AccessGate";
import { usePersonalizationOptional } from "./PersonalizationProvider";
import { suiteRequest, useSuite } from "./suite-client";
import type { SuiteItem } from "./suite-client";
import UserAvatar from "./UserAvatar";
import "./people-suite.css";

type Person = { userId: string; displayName: string };
type EmployeeForm = {
  userId: string;
  jobTitle: string;
  department: string;
  managerId: string;
  location: string;
  startDate: string;
};
type WorkflowForm = {
  title: string;
  type: string;
  description: string;
  approverId: string;
  fields: string;
};
type RequestForm = {
  title: string;
  workflowId: string;
  amount: string;
  reason: string;
  answers: Record<string, string>;
};
type TimeBreak = { startedAt: string; endedAt: string };

const WORKFLOW_TYPES: Record<
  string,
  { label: string; description: string; fields: string }
> = {
  purchase: {
    label: "Compra",
    description: "Organize pedidos de compra e a aprovação do responsável.",
    fields: "Fornecedor\nCentro de custo",
  },
  reimbursement: {
    label: "Reembolso",
    description: "Envie despesas para análise antes do reembolso.",
    fields: "Data da despesa\nCategoria",
  },
  approval: {
    label: "Aprovação",
    description: "Defina um responsável por analisar solicitações internas.",
    fields: "Área solicitante",
  },
};
const REQUEST_STATUS: Record<string, string> = {
  pending: "Em análise",
  approved: "Aprovada",
  rejected: "Recusada",
};
const EMPTY_EMPLOYEE: EmployeeForm = {
  userId: "",
  jobTitle: "",
  department: "",
  managerId: "",
  location: "",
  startDate: "",
};
const EMPTY_WORKFLOW: WorkflowForm = {
  title: "",
  type: "purchase",
  description: "",
  approverId: "",
  fields: WORKFLOW_TYPES.purchase.fields,
};
const EMPTY_REQUEST: RequestForm = {
  title: "",
  workflowId: "",
  amount: "",
  reason: "",
  answers: {},
};
const money = (amount: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    amount,
  );
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
const dateTime = (value: unknown) => {
  const parsed = new Date(text(value));
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
};
const dateOnly = (value: string) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR")
    : "Não informada";
const hours = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 3600)}h ${String(Math.floor((Math.max(0, seconds) % 3600) / 60)).padStart(2, "0")}min`;
const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function breaksOf(item: SuiteItem): TimeBreak[] {
  return Array.isArray(item.data.breaks)
    ? item.data.breaks
        .filter(
          (entry): entry is TimeBreak =>
            !!entry &&
            typeof entry === "object" &&
            typeof entry.startedAt === "string",
        )
        .map((entry) => ({
          startedAt: entry.startedAt,
          endedAt: text(entry.endedAt),
        }))
    : [];
}
function elapsed(item: SuiteItem, now: number) {
  if (
    text(item.data.state) === "closed" &&
    typeof item.data.durationSeconds === "number"
  )
    return Math.max(0, number(item.data.durationSeconds));
  const started = Date.parse(text(item.data.startedAt));
  const ended = item.data.endedAt ? Date.parse(text(item.data.endedAt)) : now;
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
  const paused = breaksOf(item).reduce((total, entry) => {
    const start = Date.parse(entry.startedAt);
    const end = entry.endedAt ? Date.parse(entry.endedAt) : ended;
    return (
      total +
      (Number.isFinite(start) && Number.isFinite(end)
        ? Math.max(0, end - start)
        : 0)
    );
  }, 0);
  return Math.max(0, Math.floor((ended - started - paused) / 1000));
}
function csvCell(value: unknown) {
  let valueText = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(valueText)) valueText = `'${valueText}`;
  return `"${valueText.replaceAll('"', '""')}"`;
}
function exportCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob(
    ["\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="people-empty">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
  wide?: boolean;
}) {
  const fieldId = useId();
  return (
    <div className={`people-field${wide ? " people-field-wide" : ""}`}>
      <label htmlFor={fieldId}>{label}</label>
      {cloneElement(children, { id: fieldId })}
    </div>
  );
}

export default function PeopleSuite({
  section,
}: {
  section: "people" | "processes";
}) {
  const { access } = useAccess();
  const personal = usePersonalizationOptional();
  const suite = useSuite();
  const { items, loading, error: loadError, refresh, create, update } = suite;
  const isAdmin = access.role === "admin";
  const [tab, setTab] = useState("directory");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<SuiteItem | null>(
    null,
  );
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<SuiteItem | null>(
    null,
  );
  const [requestForm, setRequestForm] = useState<RequestForm | null>(null);
  const [requestFilter, setRequestFilter] = useState("mine");
  const [requestStatus, setRequestStatus] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [decisionNote, setDecisionNote] = useState("");
  const [reportFrom, setReportFrom] = useState(() =>
    localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  );
  const [reportTo, setReportTo] = useState(() => localDate());
  const [reportUser, setReportUser] = useState("");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setError("");
    setSuccess("");
    setEmployeeForm(null);
    setWorkflowForm(null);
    setRequestForm(null);
    setSelectedRequestId(null);
  }, [section]);
  const people = useMemo<Person[]>(() => {
    const directory = new Map<string, Person>();
    for (const member of access.members)
      if (member.active)
        directory.set(member.userId, {
          userId: member.userId,
          displayName: member.displayName,
        });
    for (const member of personal?.me?.directory || [])
      directory.set(member.userId, {
        userId: member.userId,
        displayName: member.displayName,
      });
    if (!directory.has(access.userId))
      directory.set(access.userId, {
        userId: access.userId,
        displayName: personal?.me?.profile.fullName || "Meu perfil",
      });
    return [...directory.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, "pt-BR"),
    );
  }, [access.members, access.userId, personal?.me]);
  const nameOf = (id: unknown) =>
    people.find((entry) => entry.userId === id)?.displayName || "Colaborador";
  const approvers = people.filter(
    (person) =>
      (person.userId === access.userId && isAdmin) ||
      access.members.some(
        (member) =>
          member.userId === person.userId &&
          member.active &&
          (member.role === "admin" || member.role === "manager"),
      ),
  );
  const employeeItems = items.filter((item) => item.kind === "employees");
  const attendance = items.filter((item) => item.kind === "attendance");
  const workflows = items.filter((item) => item.kind === "workflows");
  const requests = items.filter((item) => item.kind === "workflow_requests");
  const currentAttendance = attendance.find(
    (item) =>
      (text(item.data.userId) || item.ownerId) === access.userId &&
      ["working", "paused"].includes(text(item.data.state)),
  );
  const myAttendance = attendance
    .filter(
      (item) => (text(item.data.userId) || item.ownerId) === access.userId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const departments = [
    ...new Set(
      employeeItems.map((item) => text(item.data.department)).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const visiblePeople = people.filter((person) => {
    const employee = employeeItems.find(
      (item) => item.data.userId === person.userId,
    );
    return (
      (!department || text(employee?.data.department) === department) &&
      (!query.trim() ||
        `${person.displayName} ${text(employee?.data.jobTitle)} ${text(employee?.data.department)}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.trim().toLocaleLowerCase("pt-BR")))
    );
  });
  const reportEntries = attendance
    .filter((item) => {
      const user = text(item.data.userId) || item.ownerId;
      const date = text(item.data.startedAt).slice(0, 10);
      return (
        (isAdmin
          ? !reportUser || user === reportUser
          : user === access.userId) &&
        date >= reportFrom &&
        date <= reportTo
      );
    })
    .sort((a, b) =>
      text(b.data.startedAt).localeCompare(text(a.data.startedAt)),
    );
  const totalSeconds = reportEntries.reduce(
    (total, item) => total + elapsed(item, now),
    0,
  );
  const requestRows = requests
    .filter(
      (item) =>
        (!requestStatus || item.data.status === requestStatus) &&
        (requestFilter === "mine"
          ? item.ownerId === access.userId
          : requestFilter === "review"
            ? (isAdmin || item.data.approverId === access.userId) &&
              item.data.status === "pending"
            : true),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected =
    requests.find((item) => item.id === selectedRequestId) || null;
  const pendingForMe = requests.filter(
    (item) =>
      item.data.status === "pending" &&
      (isAdmin || item.data.approverId === access.userId),
  ).length;

  const perform = async (operation: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await operation();
      setSuccess(message);
      setNow(Date.now());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a operação.",
      );
    } finally {
      setBusy(false);
    }
  };
  const actionRequest = async (path: string, body: Record<string, unknown>) => {
    await suiteRequest(path, "POST", body);
    await refresh();
  };
  const clock = (action: string) =>
    void perform(
      async () => {
        await actionRequest(`/api/suite/actions/${action}`, {
          ...(currentAttendance
            ? { id: currentAttendance.id, revision: currentAttendance.revision }
            : {}),
        });
      },
      action === "clock_out"
        ? "Saída registrada."
        : action === "pause"
          ? "Pausa registrada."
          : action === "resume"
            ? "Retorno registrado."
            : "Entrada registrada.",
    );
  const openEmployee = (userId: string) => {
    const item =
      employeeItems.find((entry) => entry.data.userId === userId) || null;
    setEditingEmployee(item);
    setEmployeeForm({
      ...EMPTY_EMPLOYEE,
      userId,
      jobTitle: text(item?.data.jobTitle),
      department: text(item?.data.department),
      managerId: text(item?.data.managerId),
      location: text(item?.data.location),
      startDate: text(item?.data.startDate),
    });
    setError("");
    setSuccess("");
  };
  const saveEmployee = (event: FormEvent) => {
    event.preventDefault();
    if (!employeeForm) return;
    void perform(async () => {
      const data = { ...employeeForm };
      const title = nameOf(data.userId);
      if (editingEmployee) await update(editingEmployee, { title, data });
      else await create("employees", title, data);
      setEmployeeForm(null);
    }, "Informações profissionais atualizadas.");
  };
  const openWorkflow = (item?: SuiteItem) => {
    setEditingWorkflow(item || null);
    setWorkflowForm(
      item
        ? {
            title: item.title,
            type: text(item.data.type),
            description: text(item.data.description),
            approverId: text(item.data.approverId),
            fields: strings(item.data.fields).join("\n"),
          }
        : { ...EMPTY_WORKFLOW },
    );
    setError("");
    setSuccess("");
  };
  const saveWorkflow = (event: FormEvent) => {
    event.preventDefault();
    if (!workflowForm) return;
    void perform(async () => {
      const fields = [
        ...new Set(
          workflowForm.fields
            .split("\n")
            .map((field) => field.trim())
            .filter(Boolean),
        ),
      ];
      if (fields.length > 10 || fields.some((field) => field.length > 80))
        throw new Error("Use até 10 perguntas de até 80 caracteres cada.");
      const data = {
        type: workflowForm.type,
        description: workflowForm.description.trim(),
        approverId: workflowForm.approverId,
        fields,
      };
      if (editingWorkflow)
        await update(editingWorkflow, {
          title: workflowForm.title.trim(),
          data,
        });
      else await create("workflows", workflowForm.title.trim(), data);
      setWorkflowForm(null);
    }, "Fluxo de aprovação salvo.");
  };
  const saveRequest = (event: FormEvent) => {
    event.preventDefault();
    if (!requestForm) return;
    void perform(async () => {
      const amount = requestForm.amount === "" ? 0 : Number(requestForm.amount);
      if (!Number.isFinite(amount) || amount < 0)
        throw new Error("Informe um valor válido.");
      await create("workflow_requests", requestForm.title.trim(), {
        workflowId: requestForm.workflowId,
        amount,
        reason: requestForm.reason.trim(),
        answers: requestForm.answers,
      });
      setRequestForm(null);
      setRequestFilter("mine");
    }, "Solicitação enviada para análise.");
  };
  const decide = (action: "approve" | "reject") => {
    if (!selected) return;
    void perform(
      async () => {
        await actionRequest(`/api/suite/actions/${action}`, {
          id: selected.id,
          note: decisionNote.trim(),
          revision: selected.revision,
        });
        setDecisionNote("");
      },
      action === "approve" ? "Solicitação aprovada." : "Solicitação recusada.",
    );
  };
  const downloadReport = () =>
    exportCsv(`ponto-${reportFrom}-${reportTo}.csv`, [
      [
        "Colaborador",
        "Entrada",
        "Saída",
        "Situação",
        "Horas trabalhadas",
        "Departamento",
      ],
      ...reportEntries.map((item) => [
        nameOf(text(item.data.userId) || item.ownerId),
        dateTime(item.data.startedAt),
        dateTime(item.data.endedAt),
        text(item.data.state) === "closed"
          ? "Encerrado"
          : text(item.data.state) === "paused"
            ? "Em pausa"
            : "Em andamento",
        hours(elapsed(item, now)),
        text(
          employeeItems.find(
            (employee) =>
              employee.data.userId === (text(item.data.userId) || item.ownerId),
          )?.data.department,
        ),
      ]),
    ]);

  if (loading && !items.length)
    return (
      <div className="people-loading" role="status">
        <LoaderCircle className="spinner" size={24} />
        Carregando {section === "people" ? "equipe e ponto" : "processos"}…
      </div>
    );
  return (
    <div className="people-suite">
      {(error || loadError) && (
        <div className="people-notice people-notice-error" role="alert">
          <XCircle size={18} />
          <span>{error || loadError}</span>
          <button
            className="btn btn-ghost"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RefreshCw size={15} />
            Atualizar
          </button>
        </div>
      )}
      {success && (
        <div className="people-notice people-notice-success" role="status">
          <CheckCircle2 size={18} />
          {success}
        </div>
      )}

      {section === "people" ? (
        <>
          <div className="people-toolbar">
            <div
              className="people-tabs"
              role="group"
              aria-label="Visões de pessoas"
            >
              <button
                className={tab === "directory" ? "active" : ""}
                onClick={() => setTab("directory")}
                aria-pressed={tab === "directory"}
              >
                <Users size={16} />
                Colaboradores
              </button>
              <button
                className={tab === "structure" ? "active" : ""}
                onClick={() => setTab("structure")}
                aria-pressed={tab === "structure"}
              >
                <GitBranch size={16} />
                Estrutura
              </button>
              <button
                className={tab === "attendance" ? "active" : ""}
                onClick={() => setTab("attendance")}
                aria-pressed={tab === "attendance"}
              >
                <Clock3 size={16} />
                Meu ponto
              </button>
              <button
                className={tab === "reports" ? "active" : ""}
                onClick={() => setTab("reports")}
                aria-pressed={tab === "reports"}
              >
                <FileCheck2 size={16} />
                Espelho de ponto
              </button>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spinner" : ""} />
              <span>Atualizar</span>
            </button>
          </div>
          {(tab === "directory" || tab === "structure") && (
            <>
              <div className="people-directory-heading">
                <div>
                  <h2>
                    {tab === "structure"
                      ? "Nossa estrutura"
                      : "Pessoas da equipe"}
                  </h2>
                  <p>
                    {people.length}{" "}
                    {people.length === 1
                      ? "colaborador cadastrado"
                      : "colaboradores cadastrados"}{" "}
                    · {departments.length}{" "}
                    {departments.length === 1
                      ? "departamento"
                      : "departamentos"}
                  </p>
                </div>
                <div className="people-filters">
                  <label className="people-search">
                    <Search size={17} />
                    <input
                      aria-label="Buscar colaborador"
                      placeholder="Nome, cargo ou departamento"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filtrar departamento"
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                  >
                    <option value="">Todos os departamentos</option>
                    {departments.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </div>
              </div>
              {employeeForm && (
                <section
                  className="people-panel people-editor"
                  aria-labelledby="employee-heading"
                >
                  <div className="people-panel-heading">
                    <div>
                      <span className="people-eyebrow">
                        Cadastro profissional
                      </span>
                      <h3 id="employee-heading">
                        {nameOf(employeeForm.userId)}
                      </h3>
                    </div>
                    <button
                      className="btn btn-ghost"
                      aria-label="Fechar edição de colaborador"
                      onClick={() => setEmployeeForm(null)}
                      disabled={busy}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <form onSubmit={saveEmployee}>
                    <div className="people-form-grid">
                      <Field label="Cargo">
                        <input
                          autoFocus
                          value={employeeForm.jobTitle}
                          maxLength={100}
                          onChange={(event) =>
                            setEmployeeForm({
                              ...employeeForm,
                              jobTitle: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Departamento">
                        <input
                          value={employeeForm.department}
                          maxLength={100}
                          onChange={(event) =>
                            setEmployeeForm({
                              ...employeeForm,
                              department: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Responsável direto">
                        <select
                          value={employeeForm.managerId}
                          onChange={(event) =>
                            setEmployeeForm({
                              ...employeeForm,
                              managerId: event.target.value,
                            })
                          }
                        >
                          <option value="">Sem responsável definido</option>
                          {people
                            .filter(
                              (person) => person.userId !== employeeForm.userId,
                            )
                            .map((person) => (
                              <option key={person.userId} value={person.userId}>
                                {person.displayName}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Data de admissão">
                        <input
                          type="date"
                          value={employeeForm.startDate}
                          onChange={(event) =>
                            setEmployeeForm({
                              ...employeeForm,
                              startDate: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Local de trabalho" wide>
                        <input
                          value={employeeForm.location}
                          maxLength={120}
                          onChange={(event) =>
                            setEmployeeForm({
                              ...employeeForm,
                              location: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="people-form-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => setEmployeeForm(null)}
                      >
                        Cancelar
                      </button>
                      <button className="btn btn-primary" disabled={busy}>
                        {busy ? (
                          <LoaderCircle size={15} className="spinner" />
                        ) : (
                          <Check size={15} />
                        )}
                        Salvar informações
                      </button>
                    </div>
                  </form>
                </section>
              )}
              {tab === "directory" ? (
                <div className="people-grid">
                  {visiblePeople.map((person) => {
                    const employee = employeeItems.find(
                      (item) => item.data.userId === person.userId,
                    );
                    return (
                      <article key={person.userId} className="people-person">
                        <div className="people-person-head">
                          <UserAvatar
                            userId={person.userId}
                            name={person.displayName}
                            className="people-avatar"
                          />
                          <div>
                            <h3>{person.displayName}</h3>
                            <p>
                              {text(employee?.data.jobTitle) ||
                                "Cargo não informado"}
                            </p>
                          </div>
                        </div>
                        <dl>
                          <div>
                            <dt>Departamento</dt>
                            <dd>
                              {text(employee?.data.department) ||
                                "Não informado"}
                            </dd>
                          </div>
                          <div>
                            <dt>Responsável</dt>
                            <dd>
                              {employee?.data.managerId
                                ? nameOf(employee.data.managerId)
                                : "Não definido"}
                            </dd>
                          </div>
                          <div>
                            <dt>Local</dt>
                            <dd>
                              {text(employee?.data.location) || "Não informado"}
                            </dd>
                          </div>
                          {isAdmin && (
                            <div>
                              <dt>Admissão</dt>
                              <dd>
                                {dateOnly(text(employee?.data.startDate))}
                              </dd>
                            </div>
                          )}
                        </dl>
                        {isAdmin && (
                          <button
                            className="people-text-button"
                            onClick={() => openEmployee(person.userId)}
                          >
                            Editar informações <ArrowRight size={14} />
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="people-structure">
                  {[...departments, ""].map((group) => {
                    const groupPeople = visiblePeople.filter(
                      (person) =>
                        text(
                          employeeItems.find(
                            (item) => item.data.userId === person.userId,
                          )?.data.department,
                        ) === group,
                    );
                    return groupPeople.length ? (
                      <section className="people-panel" key={group}>
                        <div className="people-department-heading">
                          <Building2 size={20} />
                          <div>
                            <h3>{group || "Sem departamento"}</h3>
                            <span>
                              {groupPeople.length}{" "}
                              {groupPeople.length === 1 ? "pessoa" : "pessoas"}
                            </span>
                          </div>
                        </div>
                        {groupPeople.map((person) => {
                          const employee = employeeItems.find(
                            (item) => item.data.userId === person.userId,
                          );
                          return (
                            <div
                              className="people-structure-row"
                              key={person.userId}
                            >
                              <UserAvatar
                                userId={person.userId}
                                name={person.displayName}
                                className="people-avatar-small"
                              />
                              <div>
                                <strong>{person.displayName}</strong>
                                <span>
                                  {text(employee?.data.jobTitle) ||
                                    "Cargo não informado"}
                                </span>
                                {Boolean(employee?.data.managerId) && (
                                  <small>
                                    Responde a{" "}
                                    {nameOf(employee?.data.managerId)}
                                  </small>
                                )}
                              </div>
                              {isAdmin && (
                                <button
                                  className="people-text-button"
                                  onClick={() => openEmployee(person.userId)}
                                >
                                  Editar
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </section>
                    ) : null;
                  })}
                </div>
              )}
              {!visiblePeople.length && (
                <Empty
                  icon={<Users size={32} />}
                  title="Nenhuma pessoa encontrada"
                >
                  Ajuste a busca ou o filtro de departamento.
                </Empty>
              )}
              {!isAdmin && (
                <p className="people-footnote">
                  As informações da estrutura são mantidas pelo administrador.
                  Você pode editar suas informações pessoais em Meu perfil.
                </p>
              )}
            </>
          )}

          {tab === "attendance" && (
            <div className="people-attendance-layout">
              <section className="people-panel people-clock-card">
                <div className="people-clock-icon">
                  <Clock3 size={27} />
                </div>
                <span className="people-eyebrow">
                  {new Date(now).toLocaleDateString("pt-BR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
                <h2>
                  {currentAttendance
                    ? currentAttendance.data.state === "paused"
                      ? "Pausa em andamento"
                      : "Seu dia está em andamento"
                    : "Pronto para começar?"}
                </h2>
                <p>
                  {currentAttendance
                    ? `Entrada às ${new Date(text(currentAttendance.data.startedAt)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                    : "Registre sua entrada para acompanhar a jornada de hoje."}
                </p>
                <strong className="people-clock-total">
                  {currentAttendance
                    ? hours(elapsed(currentAttendance, now))
                    : "0h 00min"}
                </strong>
                <span className="people-clock-caption">
                  Tempo de trabalho · pausas descontadas
                </span>
                <div className="people-clock-actions">
                  {!currentAttendance ? (
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => clock("clock_in")}
                    >
                      <Play size={17} />
                      Registrar entrada
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          clock(
                            currentAttendance.data.state === "paused"
                              ? "resume"
                              : "pause",
                          )
                        }
                      >
                        {currentAttendance.data.state === "paused" ? (
                          <Play size={16} />
                        ) : (
                          <Pause size={16} />
                        )}
                        {currentAttendance.data.state === "paused"
                          ? "Retornar ao trabalho"
                          : "Iniciar pausa"}
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => clock("clock_out")}
                      >
                        <Square size={15} />
                        Registrar saída
                      </button>
                    </>
                  )}
                </div>
                <p className="people-footnote">
                  Os registros usam o horário do servidor. A jornada continua
                  registrada quando você fecha esta página.
                </p>
              </section>
              <section className="people-panel">
                <div className="people-panel-heading">
                  <h3>Registros recentes</h3>
                  <span className="people-count">{myAttendance.length}</span>
                </div>
                {myAttendance.length ? (
                  <div className="people-time-history">
                    {myAttendance.slice(0, 12).map((item) => (
                      <article key={item.id}>
                        <div>
                          <strong>
                            {new Date(
                              text(item.data.startedAt),
                            ).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "long",
                            })}
                          </strong>
                          <span>
                            {dateTime(item.data.startedAt)}{" "}
                            <ArrowRight size={12} />
                            {item.data.endedAt
                              ? dateTime(item.data.endedAt)
                              : "Em aberto"}
                          </span>
                          <small>
                            {breaksOf(item).length}{" "}
                            {breaksOf(item).length === 1 ? "pausa" : "pausas"}
                          </small>
                        </div>
                        <div className="people-time-right">
                          <strong>{hours(elapsed(item, now))}</strong>
                          <span
                            className={`people-status people-status-${item.data.state === "closed" ? "approved" : "pending"}`}
                          >
                            {item.data.state === "closed"
                              ? "Encerrado"
                              : item.data.state === "paused"
                                ? "Em pausa"
                                : "Em andamento"}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={<Clock3 size={30} />}
                    title="Sua primeira jornada"
                  >
                    Registre uma entrada para começar seu histórico.
                  </Empty>
                )}
              </section>
            </div>
          )}

          {tab === "reports" && (
            <>
              <section className="people-panel">
                <div className="people-panel-heading">
                  <div>
                    <h2>
                      {isAdmin
                        ? "Espelho de ponto da equipe"
                        : "Meu espelho de ponto"}
                    </h2>
                    <p>
                      Confira as jornadas e as horas registradas no período.
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary"
                    disabled={!reportEntries.length || reportFrom > reportTo}
                    onClick={downloadReport}
                  >
                    <Download size={16} />
                    Exportar CSV
                  </button>
                </div>
                <div className="people-report-filters">
                  <Field label="De">
                    <input
                      type="date"
                      value={reportFrom}
                      onChange={(event) => setReportFrom(event.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Até">
                    <input
                      type="date"
                      value={reportTo}
                      onChange={(event) => setReportTo(event.target.value)}
                      required
                    />
                  </Field>
                  {isAdmin && (
                    <Field label="Colaborador">
                      <select
                        value={reportUser}
                        onChange={(event) => setReportUser(event.target.value)}
                      >
                        <option value="">Toda a equipe</option>
                        {people.map((person) => (
                          <option key={person.userId} value={person.userId}>
                            {person.displayName}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
                {reportFrom > reportTo && (
                  <p className="people-inline-error">
                    A data inicial deve ser anterior ou igual à final.
                  </p>
                )}
                <div className="people-summary">
                  <div>
                    <span>Horas registradas</span>
                    <strong>{hours(totalSeconds)}</strong>
                  </div>
                  <div>
                    <span>Jornadas</span>
                    <strong>{reportEntries.length}</strong>
                  </div>
                  <div>
                    <span>Em aberto</span>
                    <strong>
                      {
                        reportEntries.filter(
                          (item) => item.data.state !== "closed",
                        ).length
                      }
                    </strong>
                  </div>
                </div>
                <div className="people-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Entrada</th>
                        <th>Saída</th>
                        <th>Pausas</th>
                        <th>Horas</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportEntries.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {nameOf(text(item.data.userId) || item.ownerId)}
                          </td>
                          <td>{dateTime(item.data.startedAt)}</td>
                          <td>{dateTime(item.data.endedAt)}</td>
                          <td>{breaksOf(item).length}</td>
                          <td>
                            <strong>{hours(elapsed(item, now))}</strong>
                          </td>
                          <td>
                            <span
                              className={`people-status people-status-${item.data.state === "closed" ? "approved" : "pending"}`}
                            >
                              {item.data.state === "closed"
                                ? "Encerrado"
                                : item.data.state === "paused"
                                  ? "Em pausa"
                                  : "Em andamento"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!reportEntries.length && (
                  <Empty
                    icon={<FileCheck2 size={30} />}
                    title="Nenhuma jornada neste período"
                  >
                    Selecione outras datas ou comece registrando sua entrada.
                  </Empty>
                )}
                <p className="people-footnote">
                  Jornadas em aberto mostram um total parcial. O período usa a
                  data de entrada registrada no servidor (UTC).
                </p>
              </section>
            </>
          )}
        </>
      ) : (
        <>
          <div className="people-toolbar">
            <div className="people-process-intro">
              <span className="people-eyebrow">Processos internos</span>
              <h2>Da solicitação à decisão</h2>
              <p>
                Compras, reembolsos e aprovações com responsável e histórico.
              </p>
            </div>
            <div className="people-toolbar-actions">
              {isAdmin && (
                <button
                  className="btn btn-secondary"
                  onClick={() => openWorkflow()}
                  disabled={busy}
                >
                  <GitBranch size={16} />
                  Novo fluxo
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={!workflows.length || busy}
                onClick={() => {
                  setRequestForm({
                    ...EMPTY_REQUEST,
                    workflowId: workflows[0]?.id || "",
                  });
                  setSelectedRequestId(null);
                }}
              >
                <Plus size={16} />
                Nova solicitação
              </button>
            </div>
          </div>
          {workflowForm && (
            <section
              className="people-panel people-editor"
              aria-labelledby="workflow-heading"
            >
              <div className="people-panel-heading">
                <div>
                  <span className="people-eyebrow">Modelo de processo</span>
                  <h3 id="workflow-heading">
                    {editingWorkflow
                      ? "Editar fluxo"
                      : "Criar fluxo de aprovação"}
                  </h3>
                </div>
                <button
                  className="btn btn-ghost"
                  aria-label="Fechar edição de fluxo"
                  onClick={() => setWorkflowForm(null)}
                  disabled={busy}
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={saveWorkflow}>
                <div className="people-form-grid">
                  <Field label="Nome do fluxo">
                    <input
                      autoFocus
                      required
                      value={workflowForm.title}
                      maxLength={120}
                      placeholder="Ex.: Reembolso de despesas"
                      onChange={(event) =>
                        setWorkflowForm({
                          ...workflowForm,
                          title: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Tipo">
                    <select
                      value={workflowForm.type}
                      onChange={(event) =>
                        setWorkflowForm({
                          ...workflowForm,
                          type: event.target.value,
                          fields: WORKFLOW_TYPES[event.target.value].fields,
                        })
                      }
                    >
                      {Object.entries(WORKFLOW_TYPES).map(([id, value]) => (
                        <option value={id} key={id}>
                          {value.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Responsável pela aprovação">
                    <select
                      required
                      value={workflowForm.approverId}
                      onChange={(event) =>
                        setWorkflowForm({
                          ...workflowForm,
                          approverId: event.target.value,
                        })
                      }
                    >
                      <option value="">Selecione um colaborador</option>
                      {approvers.map((person) => (
                        <option key={person.userId} value={person.userId}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Descrição">
                    <input
                      maxLength={1000}
                      value={workflowForm.description}
                      onChange={(event) =>
                        setWorkflowForm({
                          ...workflowForm,
                          description: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Perguntas adicionais (uma por linha, até 10)"
                    wide
                  >
                    <textarea
                      rows={4}
                      maxLength={810}
                      value={workflowForm.fields}
                      onChange={(event) =>
                        setWorkflowForm({
                          ...workflowForm,
                          fields: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                <p className="people-footnote">
                  Escolha um gestor ou administrador como responsável. Ele e os
                  administradores podem aprovar ou recusar. Alterações no fluxo
                  valem para as próximas solicitações.
                </p>
                <div className="people-form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setWorkflowForm(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                  <button className="btn btn-primary" disabled={busy}>
                    {busy ? (
                      <LoaderCircle size={15} className="spinner" />
                    ) : (
                      <Check size={15} />
                    )}
                    Salvar fluxo
                  </button>
                </div>
              </form>
            </section>
          )}
          <div className="people-workflow-grid">
            {workflows.map((item) => (
              <article className="people-workflow" key={item.id}>
                <div className="people-workflow-icon">
                  <GitBranch size={21} />
                </div>
                <span className="people-eyebrow">
                  {WORKFLOW_TYPES[text(item.data.type)]?.label || "Aprovação"}
                </span>
                <h3>{item.title}</h3>
                <p>
                  {text(item.data.description) ||
                    WORKFLOW_TYPES[text(item.data.type)]?.description ||
                    "Fluxo de aprovação da equipe."}
                </p>
                <span className="people-reviewer">
                  <UserRound size={14} />
                  Aprovação: {nameOf(item.data.approverId)}
                </span>
                <div>
                  <button
                    className="people-text-button"
                    onClick={() => {
                      setRequestForm({ ...EMPTY_REQUEST, workflowId: item.id });
                      setSelectedRequestId(null);
                    }}
                  >
                    Solicitar <ArrowRight size={14} />
                  </button>
                  {isAdmin && (
                    <button
                      className="people-text-button"
                      onClick={() => openWorkflow(item)}
                    >
                      Editar fluxo
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!workflows.length && (
            <Empty
              icon={<GitBranch size={34} />}
              title="Organize o primeiro processo"
            >
              {isAdmin
                ? "Crie um fluxo de compra, reembolso ou aprovação e escolha quem fará a análise."
                : "O administrador pode criar os fluxos de aprovação da organização."}
            </Empty>
          )}
          {requestForm && (
            <section
              className="people-panel people-editor"
              aria-labelledby="request-heading"
            >
              <div className="people-panel-heading">
                <div>
                  <span className="people-eyebrow">Processo interno</span>
                  <h3 id="request-heading">Nova solicitação</h3>
                </div>
                <button
                  className="btn btn-ghost"
                  aria-label="Fechar solicitação"
                  onClick={() => setRequestForm(null)}
                  disabled={busy}
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={saveRequest}>
                <div className="people-form-grid">
                  <Field label="Fluxo">
                    <select
                      required
                      value={requestForm.workflowId}
                      onChange={(event) =>
                        setRequestForm({
                          ...requestForm,
                          workflowId: event.target.value,
                          answers: {},
                        })
                      }
                    >
                      {workflows.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Título da solicitação">
                    <input
                      autoFocus
                      required
                      maxLength={160}
                      value={requestForm.title}
                      placeholder="Ex.: Reembolso da visita ao cliente"
                      onChange={(event) =>
                        setRequestForm({
                          ...requestForm,
                          title: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Valor (R$)">
                    <input
                      type="number"
                      min="0"
                      max="999999999"
                      step="0.01"
                      value={requestForm.amount}
                      onChange={(event) =>
                        setRequestForm({
                          ...requestForm,
                          amount: event.target.value,
                        })
                      }
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label="Responsável pela análise">
                    <input
                      readOnly
                      value={nameOf(
                        workflows.find(
                          (item) => item.id === requestForm.workflowId,
                        )?.data.approverId,
                      )}
                    />
                  </Field>
                  <Field label="Justificativa" wide>
                    <textarea
                      required
                      maxLength={4000}
                      rows={4}
                      value={requestForm.reason}
                      onChange={(event) =>
                        setRequestForm({
                          ...requestForm,
                          reason: event.target.value,
                        })
                      }
                    />
                  </Field>
                  {strings(
                    workflows.find((item) => item.id === requestForm.workflowId)
                      ?.data.fields,
                  ).map((field) => (
                    <Field label={field} key={field}>
                      <input
                        required
                        maxLength={1000}
                        value={requestForm.answers[field] || ""}
                        onChange={(event) =>
                          setRequestForm({
                            ...requestForm,
                            answers: {
                              ...requestForm.answers,
                              [field]: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <div className="people-form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setRequestForm(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                  <button className="btn btn-primary" disabled={busy}>
                    {busy ? (
                      <LoaderCircle size={15} className="spinner" />
                    ) : (
                      <ArrowRight size={15} />
                    )}
                    Enviar para análise
                  </button>
                </div>
              </form>
            </section>
          )}
          <section className="people-panel">
            <div className="people-panel-heading">
              <div>
                <h3>Solicitações</h3>
                <p>
                  {pendingForMe}{" "}
                  {pendingForMe === 1
                    ? "solicitação aguardando"
                    : "solicitações aguardando"}{" "}
                  sua análise
                </p>
              </div>
              <select
                aria-label="Filtrar situação da solicitação"
                value={requestStatus}
                onChange={(event) => setRequestStatus(event.target.value)}
              >
                <option value="">Todas as situações</option>
                {Object.entries(REQUEST_STATUS).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="people-tabs people-request-tabs"
              role="group"
              aria-label="Filtrar solicitações"
            >
              <button
                aria-pressed={requestFilter === "mine"}
                className={requestFilter === "mine" ? "active" : ""}
                onClick={() => setRequestFilter("mine")}
              >
                Minhas solicitações
              </button>
              <button
                aria-pressed={requestFilter === "review"}
                className={requestFilter === "review" ? "active" : ""}
                onClick={() => setRequestFilter("review")}
              >
                Aguardando minha análise
              </button>
              {isAdmin && (
                <button
                  aria-pressed={requestFilter === "all"}
                  className={requestFilter === "all" ? "active" : ""}
                  onClick={() => setRequestFilter("all")}
                >
                  Toda a equipe
                </button>
              )}
            </div>
            {requestRows.length ? (
              <div className="people-requests">
                {requestRows.map((item) => (
                  <button
                    key={item.id}
                    className={`people-request-row${selected?.id === item.id ? " selected" : ""}`}
                    onClick={() => {
                      setSelectedRequestId(item.id);
                      setDecisionNote("");
                    }}
                  >
                    <span className="people-request-icon">
                      <FileCheck2 size={20} />
                    </span>
                    <span className="people-request-copy">
                      <strong>{item.title}</strong>
                      <span>
                        {nameOf(item.ownerId)} · {dateTime(item.createdAt)}
                      </span>
                    </span>
                    <span className="people-request-value">
                      {money(number(item.data.amount))}
                    </span>
                    <span
                      className={`people-status people-status-${text(item.data.status)}`}
                    >
                      {REQUEST_STATUS[text(item.data.status)] || "Em análise"}
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                icon={<FileCheck2 size={30} />}
                title="Nenhuma solicitação aqui"
              >
                Crie uma solicitação ou escolha outro filtro para acompanhar os
                processos.
              </Empty>
            )}
          </section>
          {selected && (
            <section
              className="people-panel people-request-detail"
              aria-labelledby="request-detail-heading"
            >
              <div className="people-panel-heading">
                <div>
                  <span className="people-eyebrow">
                    {workflows.find(
                      (item) => item.id === selected.data.workflowId,
                    )?.title || "Processo interno"}
                  </span>
                  <h3 id="request-detail-heading">{selected.title}</h3>
                </div>
                <button
                  className="btn btn-ghost"
                  aria-label="Fechar detalhes da solicitação"
                  onClick={() => setSelectedRequestId(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="people-request-detail-grid">
                <div>
                  <span
                    className={`people-status people-status-${text(selected.data.status)}`}
                  >
                    {REQUEST_STATUS[text(selected.data.status)] || "Em análise"}
                  </span>
                  <strong className="people-request-amount">
                    {money(number(selected.data.amount))}
                  </strong>
                  <h4>Justificativa</h4>
                  <p className="people-multiline">
                    {text(selected.data.reason)}
                  </p>
                  {selected.data.answers !== null &&
                    typeof selected.data.answers === "object" &&
                    !Array.isArray(selected.data.answers) && (
                      <dl className="people-request-answers">
                        {Object.entries(selected.data.answers).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>{text(value)}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    )}
                </div>
                <div className="people-timeline">
                  <div>
                    <span className="people-timeline-dot" />
                    <strong>Solicitação enviada</strong>
                    <p>{nameOf(selected.ownerId)}</p>
                    <time>{dateTime(selected.createdAt)}</time>
                  </div>
                  <div>
                    <span className="people-timeline-dot" />
                    <strong>
                      {selected.data.status === "pending"
                        ? "Aguardando análise"
                        : REQUEST_STATUS[text(selected.data.status)] ||
                          "Analisada"}
                    </strong>
                    <p>
                      {nameOf(
                        selected.data.decidedBy || selected.data.approverId,
                      )}
                    </p>
                    {Boolean(selected.data.decidedAt) && (
                      <time>{dateTime(selected.data.decidedAt)}</time>
                    )}
                    {Boolean(selected.data.decisionNote) && (
                      <p className="people-multiline">
                        {text(selected.data.decisionNote)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {selected.data.status === "pending" &&
                (isAdmin || selected.data.approverId === access.userId) && (
                  <div className="people-decision">
                    <Field label="Observação para o solicitante">
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={decisionNote}
                        onChange={(event) =>
                          setDecisionNote(event.target.value)
                        }
                        placeholder="Registre o motivo da decisão"
                      />
                    </Field>
                    <div className="people-form-actions">
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => decide("reject")}
                      >
                        <XCircle size={16} />
                        Recusar
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => decide("approve")}
                      >
                        <CheckCircle2 size={16} />
                        Aprovar
                      </button>
                    </div>
                  </div>
                )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
