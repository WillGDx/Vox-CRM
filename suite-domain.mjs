import { HttpError } from "./domain.mjs";

export const suiteKinds = [
  "leads",
  "automations",
  "quotes",
  "invoices",
  "projects",
  "project_tasks",
  "project_templates",
  "time_entries",
  "calendar_events",
  "booking_pages",
  "employees",
  "attendance",
  "workflows",
  "workflow_requests",
  "channels",
  "service_conversations",
  "service_messages",
  "notes",
];
export const suiteUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const dealStages = [
  "new",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
];
export const channelTypes = [
  "webchat",
  "whatsapp",
  "instagram",
  "facebook",
  "phone",
  "email",
  "manual",
];
const bad = (message = "Confira os campos e valores informados.") => {
  throw new HttpError(400, message);
};
export const plainObject = (value) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function suiteIdentifier(value, local = false) {
  if (
    typeof value !== "string" ||
    !(suiteUuid.test(value) || (local && value === "local"))
  )
    bad("O identificador informado é inválido.");
  return value;
}
export function suiteTitle(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160)
    bad("Informe um título entre 1 e 160 caracteres.");
  return value.trim();
}
export function suiteRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    bad("Atualize a página antes de alterar este registro.");
  return value;
}
const str =
  (max = 1000, required = false) =>
  (v) => {
    if (typeof v !== "string" || v.length > max || (required && !v.trim()))
      bad();
    return v.trim();
  };
const choice = (values) => (v) =>
  values.includes(v) ? v : bad("Selecione uma opção válida.");
const num =
  (min = 0, max = 1e12, integer = false) =>
  (v) =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!integer || Number.isInteger(v))
      ? v
      : bad("Informe um número válido dentro do limite.");
const bool = (v) => (typeof v === "boolean" ? v : bad());
const identifier = (v) => (v === "" ? "" : suiteIdentifier(v, true));
const requiredId = (v) => suiteIdentifier(v, true);
const link = str(500);
const email = (v) => {
  const s = str(254)(v);
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    bad("Informe um e-mail válido.");
  return s;
};
const date = (v) => {
  if (v === "") return v;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v + "T12:00:00Z")) ||
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v
  )
    bad("Informe uma data válida.");
  return v;
};
const instant = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      v,
    ) ||
    !Number.isFinite(Date.parse(v))
  )
    bad("Informe data e hora com fuso horário.");
  date(v.slice(0, 10));
  return new Date(v).toISOString();
};
const list =
  (entry, max = 100, min = 0) =>
  (value) => {
    if (!Array.isArray(value) || value.length > max || value.length < min)
      bad("A lista informada é inválida.");
    return value.map(entry);
  };
const ids = list(requiredId, 100);
const record = (fields) => (value) => {
  if (
    !plainObject(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(fields, key))
  )
    bad();
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, fields[k](v)]),
  );
};
const fields = {
  leads: {
    name: str(160),
    email,
    phone: str(40),
    company: str(160),
    source: str(80),
    status: choice(["new", "contacted", "qualified", "lost"]),
    notes: str(5000),
    value: num(),
  },
  automations: {
    trigger: choice(["deal_stage_changed"]),
    stage: choice(dealStages),
    action: choice(["create_task", "send_email", "update_deal"]),
    taskTitle: str(160),
    delayDays: num(0, 365, true),
    enabled: bool,
    emailSubject: str(200),
    emailBody: str(5000),
    targetStage: choice(dealStages),
  },
  quotes: {
    customer: str(160),
    customerEmail: email,
    dealId: link,
    currency: choice(["BRL"]),
    dueDate: date,
    status: choice(["draft", "sent", "accepted", "cancelled"]),
    lines: list(
      record({
        description: str(500, true),
        quantity: num(0.001, 1e6),
        unitPrice: num(0, 1e10),
      }),
      50,
      1,
    ),
    notes: str(5000),
  },
  invoices: {
    customer: str(160),
    customerEmail: email,
    dealId: link,
    currency: choice(["BRL"]),
    dueDate: date,
    status: choice(["draft", "sent", "overdue", "cancelled"]),
    lines: list(
      record({
        description: str(500, true),
        quantity: num(0.001, 1e6),
        unitPrice: num(0, 1e10),
      }),
      50,
      1,
    ),
    notes: str(5000),
  },
  projects: {
    description: str(5000),
    startDate: date,
    endDate: date,
    status: choice(["planning", "active", "completed"]),
    members: ids,
  },
  project_tasks: {
    projectId: requiredId,
    description: str(5000),
    status: choice(["backlog", "todo", "doing", "done"]),
    priority: choice(["low", "medium", "high"]),
    assigneeId: identifier,
    startDate: date,
    endDate: date,
    sprint: str(100),
    dependsOn: ids,
  },
  project_templates: {
    description: str(5000),
    tasks: list(
      record({
        title: str(160, true),
        description: str(5000),
        durationDays: num(1, 365, true),
        priority: choice(["low", "medium", "high"]),
      }),
      100,
      1,
    ),
  },
  calendar_events: {
    startAt: instant,
    endAt: instant,
    timeZone: choice(["America/Sao_Paulo"]),
    visibility: choice(["personal", "team"]),
    attendees: ids,
    description: str(5000),
    location: str(300),
  },
  booking_pages: {
    durationMinutes: num(15, 240, true),
    weekdays: list(num(0, 6, true), 7, 1),
    startHour: num(0, 23, true),
    endHour: num(1, 24, true),
    timeZone: choice(["America/Sao_Paulo"]),
    enabled: bool,
    slug: str(100),
  },
  employees: {
    userId: requiredId,
    department: str(100),
    jobTitle: str(100),
    managerId: identifier,
    location: str(120),
    startDate: date,
  },
  workflows: {
    type: choice(["purchase", "reimbursement", "approval"]),
    description: str(5000),
    approverId: requiredId,
    fields: list(str(100, true), 20),
  },
  workflow_requests: {
    workflowId: requiredId,
    amount: num(0, 1e12),
    reason: str(5000, true),
    answers: (v) => {
      if (
        !plainObject(v) ||
        Object.keys(v).length > 20 ||
        Object.keys(v).some(
          (k) =>
            !k ||
            k.length > 100 ||
            ["__proto__", "constructor", "prototype"].includes(k),
        )
      )
        bad();
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, str(2000)(x)]),
      );
    },
  },
  channels: { type: choice(channelTypes), enabled: bool },
  service_conversations: {
    channel: choice(channelTypes),
    customer: str(160),
    email,
    phone: str(40),
    status: choice(["open", "pending", "closed"]),
    assigneeId: identifier,
    leadId: link,
  },
  service_messages: {
    conversationId: requiredId,
    text: str(5000, true),
    direction: choice(["inbound", "outbound"]),
  },
  notes: { body: str(10000) },
};
export const suiteDefaults = {
  leads: {
    name: "",
    email: "",
    phone: "",
    company: "",
    source: "",
    status: "new",
    notes: "",
    value: 0,
  },
  automations: {
    trigger: "deal_stage_changed",
    stage: "new",
    action: "create_task",
    taskTitle: "",
    delayDays: 0,
    enabled: true,
    emailSubject: "",
    emailBody: "",
    targetStage: "qualified",
  },
  quotes: {
    customer: "",
    customerEmail: "",
    dealId: "",
    currency: "BRL",
    dueDate: "",
    status: "draft",
    lines: [],
    notes: "",
  },
  invoices: {
    customer: "",
    customerEmail: "",
    dealId: "",
    currency: "BRL",
    dueDate: "",
    status: "draft",
    lines: [],
    notes: "",
  },
  projects: {
    description: "",
    startDate: "",
    endDate: "",
    status: "planning",
    members: [],
  },
  project_tasks: {
    description: "",
    status: "todo",
    priority: "medium",
    assigneeId: "",
    startDate: "",
    endDate: "",
    sprint: "",
    dependsOn: [],
  },
  project_templates: { description: "", tasks: [] },
  calendar_events: {
    timeZone: "America/Sao_Paulo",
    visibility: "personal",
    attendees: [],
    description: "",
    location: "",
  },
  booking_pages: {
    durationMinutes: 30,
    weekdays: [1, 2, 3, 4, 5],
    startHour: 9,
    endHour: 18,
    timeZone: "America/Sao_Paulo",
    enabled: true,
    slug: "",
  },
  employees: {
    department: "",
    jobTitle: "",
    managerId: "",
    location: "",
    startDate: "",
  },
  workflows: { type: "approval", description: "", fields: [] },
  workflow_requests: { amount: 0, answers: {} },
  channels: { type: "manual", enabled: false },
  service_conversations: {
    channel: "manual",
    customer: "",
    email: "",
    phone: "",
    status: "open",
    assigneeId: "",
    leadId: "",
  },
  service_messages: { direction: "outbound" },
  notes: { body: "" },
};
export function validateSuiteData(kind, value) {
  if (!suiteKinds.includes(kind)) bad("O módulo informado não existe.");
  if (["attendance", "time_entries"].includes(kind))
    bad("Use os comandos de início, pausa e encerramento para este registro.");
  if (!plainObject(value)) bad("Envie os campos do registro como um objeto.");
  return record(fields[kind])(value);
}
export function completeSuiteData(kind, patch, existing = null) {
  const data = {
    ...structuredClone(suiteDefaults[kind] || {}),
    ...(existing || {}),
    ...patch,
  };
  const required =
    {
      project_tasks: ["projectId"],
      calendar_events: ["startAt", "endAt"],
      employees: ["userId"],
      workflows: ["approverId"],
      workflow_requests: ["workflowId", "reason"],
      service_messages: ["conversationId", "text"],
    }[kind] || [];
  if (required.some((key) => !data[key]))
    bad("Preencha os campos obrigatórios do registro.");
  if (["quotes", "invoices"].includes(kind)) {
    if (
      !data.lines.length ||
      data.lines.some(
        (x) =>
          !x.description ||
          typeof x.quantity !== "number" ||
          typeof x.unitPrice !== "number",
      )
    )
      bad("Adicione ao menos um item válido ao documento.");
    data.total =
      Math.round(
        data.lines.reduce(
          (sum, line) => sum + Math.round(line.quantity * line.unitPrice * 100),
          0,
        ),
      ) / 100;
    if (
      !Number.isSafeInteger(Math.round(data.total * 100)) ||
      data.total > 1e12
    )
      bad("O total do documento excede o limite.");
  }
  if (
    kind === "project_templates" &&
    (!data.tasks.length || data.tasks.some((task) => !task.title))
  )
    bad("Adicione ao menos uma tarefa com título ao modelo.");
  if (data.startDate && data.endDate && data.endDate < data.startDate)
    bad("A data final deve ser posterior à inicial.");
  if (
    kind === "calendar_events" &&
    Date.parse(data.endAt) <= Date.parse(data.startAt)
  )
    bad("O término deve ser posterior ao início.");
  if (kind === "booking_pages" && data.endHour <= data.startHour)
    bad("A faixa de atendimento é inválida.");
  if (
    kind === "automations" &&
    data.action === "create_task" &&
    !data.taskTitle
  )
    bad("Informe o título da tarefa automática.");
  if (
    kind === "automations" &&
    data.action === "update_deal" &&
    data.stage === data.targetStage
  )
    bad("A etapa de destino deve ser diferente da etapa de entrada.");
  if (Buffer.byteLength(JSON.stringify(data)) > 32768)
    bad("Os campos do registro excedem o limite de tamanho.");
  return data;
}
export function validateSuiteAction(action, body) {
  const definitions = {
    time_start: { taskId: str(500, true) },
    time_stop: { id: requiredId, revision: suiteRevision },
    clock_in: {},
    pause: { id: requiredId, revision: suiteRevision },
    resume: { id: requiredId, revision: suiteRevision },
    clock_out: { id: requiredId, revision: suiteRevision },
    approve: { id: requiredId, revision: suiteRevision, note: str(2000) },
    reject: { id: requiredId, revision: suiteRevision, note: str(2000) },
    convert_lead: { id: requiredId, revision: suiteRevision },
  };
  if (!Object.hasOwn(definitions, action)) bad("A ação informada não existe.");
  const data = record(definitions[action])(body);
  for (const key of Object.keys(definitions[action]))
    if (key !== "note" && !Object.hasOwn(data, key))
      bad("A ação está incompleta.");
  return data;
}
export function presentSuiteItem(value, local = false) {
  if (
    !plainObject(value) ||
    !suiteUuid.test(value.id) ||
    !suiteKinds.includes(value.kind) ||
    typeof value.title !== "string" ||
    !plainObject(value.data) ||
    !(
      suiteUuid.test(value.workspaceId) ||
      (local && value.workspaceId === "local")
    ) ||
    !(suiteUuid.test(value.ownerId) || (local && value.ownerId === "local")) ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    throw new HttpError(502, "O módulo retornou um registro inválido.");
  return value;
}
export function validateBookingInput(body) {
  const input = record({ name: str(120, true), email, startAt: instant })(body);
  if (!input.name || !input.email || !input.startAt)
    bad("Informe nome, e-mail e horário.");
  return input;
}
