import { randomUUID } from "node:crypto";
import { HttpError } from "./domain.mjs";
import {
  completeSuiteData,
  validateSuiteData,
  suiteTitle,
  validateSuiteAction,
  validateBookingInput,
} from "./suite-domain.mjs";

const missing = () => {
  throw new HttpError(404, "O registro solicitado não foi encontrado.");
};
const invalid = (text) => {
  throw new HttpError(400, text || "Confira os vínculos e campos informados.");
};
const conflict = () => {
  throw new HttpError(
    409,
    "O registro foi alterado. Atualize a página e tente novamente.",
  );
};
const seconds = (from, to) =>
  Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 1000));
const localMember = (id) => id === "local";

export function createLocalSuiteDatabase(
  db,
  { clock = () => new Date() } = {},
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS suite_items (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
  );
  const read = db.prepare("SELECT payload FROM suite_items WHERE id=?");
  const list = db.prepare(
    "SELECT payload FROM suite_items ORDER BY rowid DESC",
  );
  const write = db.prepare(
    "INSERT INTO suite_items(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
  );
  const remove = db.prepare("DELETE FROM suite_items WHERE id=?");
  const items = () => list.all().map((row) => JSON.parse(row.payload));
  const get = (id, kind) => {
    const row = read.get(id);
    const value = row ? JSON.parse(row.payload) : null;
    if (!value || (kind && value.kind !== kind)) missing();
    return value;
  };
  const now = () => clock().toISOString();
  const save = (kind, title, data, previous = null) => {
    const at = now();
    const value = {
      id: previous?.id || randomUUID(),
      workspaceId: "local",
      kind,
      title,
      data,
      ownerId: "local",
      createdAt: previous?.createdAt || at,
      updatedAt: at,
      revision: (previous?.revision || 0) + 1,
    };
    write.run(value.id, JSON.stringify(value));
    return value;
  };
  const version = (item, expected) => {
    if (item.revision !== expected) conflict();
  };
  const core = (collection, id) => {
    const row = db
      .prepare("SELECT payload FROM records WHERE collection=? AND id=?")
      .get(collection, id);
    return row ? JSON.parse(row.payload) : null;
  };
  function references(kind, data, previous) {
    for (const field of ["userId", "managerId", "assigneeId", "approverId"])
      if (data[field] && !localMember(data[field]))
        invalid("O modo local tem apenas o seu próprio usuário.");
    if (
      [...(data.members || []), ...(data.attendees || [])].some(
        (id) => !localMember(id),
      )
    )
      invalid("O modo local tem apenas o seu próprio usuário.");
    if (
      ["quotes", "invoices"].includes(kind) &&
      data.dealId &&
      !core("deals", data.dealId)
    )
      invalid("O negócio vinculado não existe.");
    if (
      kind === "employees" &&
      items().some(
        (item) =>
          item.kind === "employees" &&
          item.data.userId === data.userId &&
          item.id !== previous?.id,
      )
    )
      throw new HttpError(409, "Este colaborador já tem um registro.");
    if (kind === "project_tasks") {
      get(data.projectId, "projects");
      for (const id of data.dependsOn) {
        const task = get(id, "project_tasks");
        if (id === previous?.id || task.data.projectId !== data.projectId)
          invalid("Selecione dependências do mesmo projeto.");
      }
      // A dependency path back to this task would never be schedulable.
      const visited = new Set();
      const visit = (id) => {
        if (id === previous?.id)
          invalid("As dependências não podem formar um ciclo.");
        if (visited.has(id)) return;
        visited.add(id);
        for (const next of get(id, "project_tasks").data.dependsOn || [])
          visit(next);
      };
      for (const id of data.dependsOn) visit(id);
    }
    if (kind === "workflow_requests") {
      const workflow = get(data.workflowId, "workflows");
      if (previous)
        throw new HttpError(
          403,
          "Uma solicitação enviada é imutável; use os comandos de decisão.",
        );
      if (
        Object.keys(data.answers).some(
          (key) => !workflow.data.fields.includes(key),
        )
      )
        invalid("Uma resposta não pertence aos campos deste fluxo.");
      data.approverId = previous?.data.approverId || workflow.data.approverId;
      data.status = previous?.data.status || "pending";
      data.decidedAt = previous?.data.decidedAt || null;
      data.decidedBy = previous?.data.decidedBy || null;
      data.decisionNote = previous?.data.decisionNote || "";
    }
    if (kind === "service_conversations" && data.leadId)
      get(data.leadId, "leads");
    if (kind === "service_messages") {
      const conversation = get(data.conversationId, "service_conversations");
      if (conversation.data.status === "closed")
        throw new HttpError(409, "Reabra o atendimento antes de responder.");
      if (!["manual", "webchat"].includes(conversation.data.channel))
        throw new HttpError(
          503,
          "Este canal precisa de um provedor conectado antes de enviar mensagens.",
        );
      if (
        conversation.data.channel === "webchat" &&
        data.direction !== "outbound"
      )
        invalid("Mensagens recebidas são registradas pelo chat público.");
      if (previous)
        invalid(
          "Mensagens de atendimento já registradas não podem ser reescritas.",
        );
    }
  }
  function mutate(args) {
    const previous = args.p_id ? get(args.p_id, args.p_kind) : null;
    if (previous) version(previous, args.p_revision);
    const patch = validateSuiteData(args.p_kind, args.p_data || {});
    if (previous?.kind === "leads" && previous.data.status === "converted")
      invalid("O lead já foi convertido.");
    const data = completeSuiteData(args.p_kind, patch, previous?.data);
    references(args.p_kind, data, previous);
    return save(
      args.p_kind,
      args.p_title === null ? previous?.title : suiteTitle(args.p_title),
      data,
      previous,
    );
  }
  function action(args) {
    const input = validateSuiteAction(args.p_action, {
      ...(args.p_id ? { id: args.p_id, revision: args.p_revision } : {}),
      ...(args.p_payload || {}),
    });
    const at = now();
    const entry = input.id ? get(input.id) : null;
    if (entry) version(entry, input.revision);
    if (args.p_action === "time_start") {
      const stored = read.get(input.taskId);
      const suiteTask = stored ? JSON.parse(stored.payload) : null;
      const task =
        suiteTask?.kind === "project_tasks"
          ? suiteTask
          : core("tasks", input.taskId);
      if (!task) missing();
      if (
        items().some(
          (x) => x.kind === "time_entries" && x.data.status === "running",
        )
      )
        conflict();
      return save("time_entries", task.title, {
        taskId: task.id,
        startedAt: at,
        endedAt: null,
        durationSeconds: 0,
        status: "running",
      });
    }
    if (args.p_action === "time_stop") {
      if (entry.kind !== "time_entries" || entry.data.status !== "running")
        conflict();
      return save(
        entry.kind,
        entry.title,
        {
          ...entry.data,
          endedAt: at,
          durationSeconds: seconds(entry.data.startedAt, at),
          status: "stopped",
        },
        entry,
      );
    }
    if (args.p_action === "clock_in") {
      if (
        items().some(
          (x) => x.kind === "attendance" && x.data.state !== "closed",
        )
      )
        conflict();
      return save("attendance", "Jornada de trabalho", {
        userId: "local",
        startedAt: at,
        endedAt: null,
        breaks: [],
        state: "working",
        durationSeconds: 0,
      });
    }
    if (["pause", "resume", "clock_out"].includes(args.p_action)) {
      if (entry.kind !== "attendance" || entry.data.state === "closed")
        conflict();
      const data = structuredClone(entry.data);
      if (args.p_action === "pause") {
        if (data.state !== "working") conflict();
        data.breaks.push({ startedAt: at, endedAt: null });
        data.state = "paused";
      } else {
        if (args.p_action === "resume" && data.state !== "paused") conflict();
        if (data.state === "paused")
          data.breaks[data.breaks.length - 1].endedAt = at;
        data.state = args.p_action === "resume" ? "working" : "closed";
        if (data.state === "closed") data.endedAt = at;
      }
      data.durationSeconds = Math.max(
        0,
        seconds(data.startedAt, at) -
          data.breaks.reduce(
            (sum, b) => sum + seconds(b.startedAt, b.endedAt || at),
            0,
          ),
      );
      return save(entry.kind, entry.title, data, entry);
    }
    if (["approve", "reject"].includes(args.p_action)) {
      if (entry.kind !== "workflow_requests" || entry.data.status !== "pending")
        conflict();
      if (entry.data.approverId !== "local")
        throw new HttpError(
          403,
          "Somente o aprovador ou administrador pode decidir.",
        );
      return save(
        entry.kind,
        entry.title,
        {
          ...entry.data,
          status: args.p_action === "approve" ? "approved" : "rejected",
          decidedAt: at,
          decidedBy: "local",
          decisionNote: input.note || "",
        },
        entry,
      );
    }
    if (args.p_action === "convert_lead") {
      if (entry.kind !== "leads" || entry.data.status === "converted")
        conflict();
      const contactId = randomUUID(),
        dealId = randomUUID();
      const contact = {
        id: contactId,
        name: entry.data.name || entry.title,
        email: entry.data.email,
        phone: entry.data.phone,
        role: "",
        companyId: "",
        owner: "Usuário local",
        ownerId: "local",
      };
      const deal = {
        id: dealId,
        title: entry.title,
        value: entry.data.value || 0,
        stage: "new",
        companyId: "",
        contactId,
        owner: "Usuário local",
        ownerId: "local",
        dueDate: "",
        description: entry.data.notes || "",
      };
      const put = db.prepare(
        "INSERT INTO records(collection,id,payload)VALUES(?,?,?)",
      );
      put.run("contacts", contactId, JSON.stringify(contact));
      put.run("deals", dealId, JSON.stringify(deal));
      return save(
        entry.kind,
        entry.title,
        {
          ...entry.data,
          status: "converted",
          contactId,
          dealId,
          convertedAt: at,
        },
        entry,
      );
    }
    invalid("A ação informada não existe.");
  }
  function bookingPage(args) {
    const page = get(args.p_id, "booking_pages");
    if (!page.data.enabled) missing();
    const { durationMinutes, weekdays, startHour, endHour, timeZone } =
      page.data;
    return {
      id: page.id,
      title: page.title,
      data: { durationMinutes, weekdays, startHour, endHour, timeZone },
      busyStartTimes: items()
        .filter(
          (x) =>
            x.kind === "calendar_events" &&
            Date.parse(x.data.endAt) > clock().getTime(),
        )
        .map((x) => x.data.startAt),
      busyIntervals: items()
        .filter(
          (x) =>
            x.kind === "calendar_events" &&
            Date.parse(x.data.endAt) > clock().getTime(),
        )
        .map((x) => ({ startAt: x.data.startAt, endAt: x.data.endAt })),
    };
  }
  function reserve(args) {
    validateBookingInput({
      name: args.p_name,
      email: args.p_email,
      startAt: args.p_start_at,
    });
    const page = get(args.p_id, "booking_pages");
    if (!page.data.enabled) missing();
    const start = new Date(args.p_start_at);
    const duration = page.data.durationMinutes * 60_000;
    const end = new Date(start.getTime() + duration);
    if (
      !Number.isFinite(start.getTime()) ||
      start.getTime() < clock().getTime() + 15 * 60_000 ||
      start.getTime() > clock().getTime() + 60 * 86400_000
    )
      invalid("Escolha um horário futuro nos próximos 60 dias.");
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: page.data.timeZone,
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(start)
        .map((p) => [p.type, p.value]),
    );
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday,
    );
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    if (
      !page.data.weekdays.includes(weekday) ||
      minutes < page.data.startHour * 60 ||
      minutes + page.data.durationMinutes > page.data.endHour * 60 ||
      (minutes - page.data.startHour * 60) % page.data.durationMinutes !== 0 ||
      Number(parts.second) !== 0 ||
      start.getMilliseconds() !== 0
    )
      invalid("O horário não pertence à disponibilidade desta agenda.");
    if (
      items().some(
        (x) =>
          x.kind === "calendar_events" &&
          Date.parse(x.data.startAt) < end.getTime() &&
          Date.parse(x.data.endAt) > start.getTime(),
      )
    )
      conflict();
    const created = save("calendar_events", `${page.title} — ${args.p_name}`, {
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timeZone: page.data.timeZone,
      visibility: "personal",
      attendees: [],
      description: `Agendamento: ${args.p_name}\n${args.p_email}`,
      location: "",
    });
    return { ok: true, id: created.id };
  }
  return async function suiteDatabase(endpoint, options = {}) {
    const name = endpoint.replace(/^\/rest\/v1\/rpc\//, "");
    const args = JSON.parse(options.body || "{}");
    const owns = !db.isTransaction;
    if (owns) db.exec("BEGIN IMMEDIATE");
    try {
      let result;
      if (name === "crm_suite_list") result = items();
      else if (name === "crm_suite_save") result = mutate(args);
      else if (name === "crm_suite_action") result = action(args);
      else if (name === "crm_suite_delete") {
        const item = get(args.p_id, args.p_kind);
        version(item, args.p_revision);
        if (item.kind === "service_messages")
          invalid("O histórico de atendimento não pode ser apagado.");
        if (
          items().some(
            (x) =>
              x.id !== item.id &&
              (x.data.projectId === item.id ||
                x.data.workflowId === item.id ||
                x.data.conversationId === item.id ||
                (x.data.dependsOn || []).includes(item.id) ||
                (x.kind === "time_entries" && x.data.taskId === item.id)),
          )
        )
          throw new HttpError(
            409,
            "Este registro ainda tem vínculos. Remova os vínculos antes de excluir.",
          );
        remove.run(item.id);
        result = { ok: true };
      } else if (name === "crm_booking_page") result = bookingPage(args);
      else if (name === "crm_booking_reserve") result = reserve(args);
      else throw new HttpError(404, "A operação do módulo não existe.");
      if (owns) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (owns) db.exec("ROLLBACK");
      throw error;
    }
  };
}

// Called inside the existing CRM transaction after a deal's stage changes.
export function runLocalSuiteAutomations(db, { before, after }) {
  if (!before || !after || before.stage === after.stage) return;
  const rules = db
    .prepare("SELECT payload FROM suite_items")
    .all()
    .map((x) => JSON.parse(x.payload))
    .filter(
      (x) =>
        x.kind === "automations" &&
        x.data.enabled &&
        x.data.trigger === "deal_stage_changed" &&
        x.data.stage === after.stage,
    );
  const at = new Date().toISOString();
  for (const rule of rules) {
    let status = "completed",
      message = "Regra executada.";
    if (rule.data.action === "create_task") {
      const due = new Date();
      due.setUTCDate(due.getUTCDate() + rule.data.delayDays);
      const task = {
        id: randomUUID(),
        title: rule.data.taskTitle,
        dueDate: due.toISOString().slice(0, 10),
        priority: "medium",
        status: "pending",
        owner: after.owner || "Usuário local",
        ownerId: "local",
        dealId: after.id,
      };
      db.prepare(
        "INSERT INTO records(collection,id,payload)VALUES('tasks',?,?)",
      ).run(task.id, JSON.stringify(task));
    } else if (rule.data.action === "update_deal") {
      const row = db
        .prepare(
          "SELECT payload FROM records WHERE collection='deals' AND id=?",
        )
        .get(after.id);
      if (row) {
        const deal = JSON.parse(row.payload);
        deal.stage = rule.data.targetStage;
        db.prepare(
          "UPDATE records SET payload=? WHERE collection='deals' AND id=?",
        ).run(JSON.stringify(deal), deal.id);
      }
    } else {
      status = "provider_required";
      message = "Conecte um provedor de e-mail para habilitar o envio.";
    }
    rule.data.lastRun = { at, status, message, dealId: after.id };
    rule.updatedAt = at;
    rule.revision += 1;
    db.prepare("UPDATE suite_items SET payload=? WHERE id=?").run(
      JSON.stringify(rule),
      rule.id,
    );
  }
}
