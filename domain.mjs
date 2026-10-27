import { randomUUID } from "node:crypto";
export const collections = ["companies", "contacts", "deals", "tasks"];
const stages = {
  new: "Novo lead",
  qualified: "Qualificação",
  proposal: "Proposta",
  negotiation: "Negociação",
  won: "Ganho",
  lost: "Perdido",
};
const defaults = {
  companies: {
    name: "",
    sector: "",
    website: "",
    phone: "",
    owner: "Mariana Costa",
  },
  contacts: {
    name: "",
    email: "",
    phone: "",
    role: "",
    companyId: "",
    owner: "Mariana Costa",
  },
  deals: {
    title: "",
    value: 0,
    stage: "new",
    companyId: "",
    contactId: "",
    owner: "Mariana Costa",
    dueDate: "",
    description: "",
  },
  tasks: {
    title: "",
    dueDate: "",
    priority: "medium",
    status: "pending",
    owner: "Mariana Costa",
    dealId: "",
  },
};
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

export async function readBody(request) {
  if (
    !/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")
  ) {
    throw new HttpError(415, "Envie os dados como application/json.");
  }
  let preparedBody;
  try {
    preparedBody = request.body;
  } catch {
    throw new HttpError(400, "O JSON enviado é inválido.");
  }
  if (preparedBody !== undefined) {
    let value = preparedBody;
    if (typeof value === "string" || Buffer.isBuffer(value)) {
      if (Buffer.byteLength(value) > 65_536)
        throw new HttpError(
          413,
          "Os dados enviados excedem o limite permitido.",
        );
      try {
        value = JSON.parse(value.toString());
      } catch {
        throw new HttpError(400, "O JSON enviado é inválido.");
      }
    }
    assertBodyObject(value);
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new HttpError(
        400,
        "Envie um objeto JSON válido com os dados do registro.",
      );
    }
    if (Buffer.byteLength(serialized) > 65_536)
      throw new HttpError(413, "Os dados enviados excedem o limite permitido.");
    return value;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 65_536) chunks.push(chunk);
  }
  if (size > 65_536)
    throw new HttpError(413, "Os dados enviados excedem o limite permitido.");
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "O JSON enviado é inválido.");
  }
  assertBodyObject(value);
  return value;
}

function assertBodyObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new HttpError(400, "Envie um objeto com os dados do registro.");
  }
}

function validDate(value) {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function validate(state, collection, body, existing) {
  const item = { ...defaults[collection], ...existing };
  for (const [field, defaultValue] of Object.entries(defaults[collection])) {
    if (!Object.hasOwn(body, field)) continue;
    const value = body[field];
    if (typeof defaultValue === "string") {
      if (typeof value !== "string")
        throw new HttpError(400, `O campo ${field} deve ser um texto.`);
      const limit = field === "description" ? 5000 : 500;
      if (value.length > limit)
        throw new HttpError(400, `O campo ${field} é muito longo.`);
      item[field] = value.trim();
    } else {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1e12
      )
        throw new HttpError(
          400,
          "Informe um valor numérico válido e não negativo.",
        );
      item[field] = Math.round(value * 100) / 100;
    }
  }
  if (!(item.name || item.title))
    throw new HttpError(400, "Informe o nome ou título do registro.");
  if (!item.owner)
    throw new HttpError(400, "Informe o responsável pelo registro.");
  if (
    "email" in item &&
    item.email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)
  )
    throw new HttpError(400, "Informe um e-mail válido.");
  if ("website" in item && item.website) {
    let valid = false;
    try {
      valid = ["http:", "https:"].includes(new URL(item.website).protocol);
    } catch {
      /* Invalid URL is reported below. */
    }
    if (!valid)
      throw new HttpError(
        400,
        "Informe um site válido começando com https:// ou http://.",
      );
  }
  if ("stage" in item && !Object.hasOwn(stages, item.stage))
    throw new HttpError(400, "Selecione uma etapa válida para o negócio.");
  if ("priority" in item && !["high", "medium", "low"].includes(item.priority))
    throw new HttpError(400, "Selecione uma prioridade válida.");
  if ("status" in item && !["pending", "done"].includes(item.status))
    throw new HttpError(400, "Selecione uma situação válida para a tarefa.");
  if ("dueDate" in item && !validDate(item.dueDate))
    throw new HttpError(400, "Informe uma data válida no formato AAAA-MM-DD.");
  for (const [field, target] of [
    ["companyId", "companies"],
    ["contactId", "contacts"],
    ["dealId", "deals"],
  ]) {
    // A linked parent can be hidden by RLS. Keep a previously valid link when
    // an unrelated field changes; newly selected links must be readable.
    if (
      item[field] &&
      !(existing && item[field] === existing[field]) &&
      !state[target].some((entry) => entry.id === item[field])
    )
      throw new HttpError(400, `O vínculo ${field} não existe.`);
  }
  item.id = existing?.id ?? randomUUID();
  return item;
}

function logChange(state, collection, item, previous, deleted = false) {
  const label = {
    companies: "a empresa",
    contacts: "o contato",
    deals: "o negócio",
    tasks: "a tarefa",
  }[collection];
  let text = `${item.owner} ${deleted ? "excluiu" : previous ? "atualizou" : "criou"} ${label} “${item.name || item.title}”.`;
  let type =
    collection === "deals"
      ? "deal"
      : collection === "contacts"
        ? "contact"
        : collection === "companies"
          ? "company"
          : "task";
  if (
    !deleted &&
    previous &&
    collection === "deals" &&
    item.stage !== previous.stage
  ) {
    text = `${item.owner} moveu “${item.title}” para ${stages[item.stage]}.`;
    type = item.stage === "won" ? "won" : "stage";
  }
  if (
    !deleted &&
    previous &&
    collection === "tasks" &&
    item.status !== previous.status
  )
    text = `${item.owner} ${item.status === "done" ? "concluiu" : "reabriu"} a tarefa “${item.title}”.`;
  state.activities.unshift({
    id: randomUUID(),
    text,
    type,
    createdAt: new Date().toISOString(),
  });
  state.activities = state.activities.slice(0, 100);
}

export function parsePath(request) {
  let path;
  try {
    path = decodeURIComponent((request.url || "/").split(/[?#]/)[0]);
  } catch {
    throw new HttpError(400, "O endereço solicitado é inválido.");
  }
  if (
    !path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").includes("..")
  )
    throw new HttpError(403, "Caminho não permitido.");
  return path;
}

export function parseMutation(path, method) {
  const match = /^\/api\/(companies|contacts|deals|tasks)(?:\/([^/]+))?$/.exec(
    path,
  );
  if (!match) throw new HttpError(404, "Rota não encontrada.");
  const [, collection, id] = match;
  if (
    !(method === "POST" && !id) &&
    !(id && ["PUT", "DELETE"].includes(method))
  )
    throw new HttpError(405, "Método não permitido.");
  return { collection, id, method };
}

export function assertState(state) {
  if (
    !state ||
    typeof state !== "object" ||
    ![...collections, "activities"].every((key) => Array.isArray(state[key]))
  )
    throw new HttpError(502, "O estado do workspace no Supabase é inválido.");
  for (const collection of collections)
    for (const item of state[collection]) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.id !== "string" ||
        Object.entries(defaults[collection]).some(
          ([key, value]) => typeof item[key] !== typeof value,
        )
      )
        throw new HttpError(
          502,
          "Um registro do workspace no Supabase é inválido.",
        );
    }
  for (const activity of state.activities)
    if (
      !activity ||
      ["id", "text", "type", "createdAt"].some(
        (key) => typeof activity[key] !== "string",
      )
    )
      throw new HttpError(
        502,
        "Uma atividade do workspace no Supabase é inválida.",
      );
  return state;
}

export function applyMutation(current, { collection, id, method }, body = {}) {
  const state = structuredClone(assertState(current));
  const existing = id
    ? state[collection].find((item) => item.id === id)
    : undefined;
  if (id && !existing) throw new HttpError(404, "Registro não encontrado.");
  if (method === "DELETE") {
    state[collection] = state[collection].filter((item) => item.id !== id);
    const field = {
      companies: "companyId",
      contacts: "contactId",
      deals: "dealId",
    }[collection];
    if (field)
      for (const target of collections)
        for (const item of state[target])
          if (item[field] === id) item[field] = "";
    logChange(state, collection, existing, existing, true);
    return { state, result: { ok: true }, status: 200 };
  }
  const item = validate(state, collection, body, existing);
  if (existing)
    state[collection] = state[collection].map((entry) =>
      entry.id === id ? item : entry,
    );
  else state[collection].push(item);
  logChange(state, collection, item, existing);
  return { state, result: item, status: existing ? 200 : 201 };
}

export function defaultProfiles() {
  const build = (scope, remove, exportAllowed) =>
    Object.fromEntries(
      collections.map((name) => [
        name,
        {
          read: scope,
          create: true,
          update: scope,
          delete: remove,
          export: exportAllowed,
        },
      ]),
    );
  return {
    admin: build("all", "all", true),
    manager: build("all", "all", true),
    user: build("own", "none", false),
  };
}

export function localAccess() {
  const profiles = defaultProfiles();
  return {
    storage: "sqlite",
    userId: "local",
    workspaceId: "local",
    workspaceName: "Workspace local",
    role: "admin",
    permissions: profiles.admin,
    members: [],
    profiles,
  };
}

export function csvData(rows) {
  if (!rows.length) return "\uFEFF";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[=+@\-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      columns.map(cell).join(";"),
      ...rows.map((row) => columns.map((key) => cell(row[key])).join(";")),
    ].join("\r\n")
  );
}
