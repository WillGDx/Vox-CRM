import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalSuiteDatabase,
  runLocalSuiteAutomations,
} from "../local-suite.mjs";
import {
  handleSuiteRequest,
  handleSuitePublicRequest,
  isSuitePublicPath,
} from "../suite-handler.mjs";
import { localAccess, HttpError, parsePath, sendJson } from "../domain.mjs";
import { validateSuiteData, completeSuiteData } from "../suite-domain.mjs";

async function fixture(t, options = {}) {
  const db = new DatabaseSync(options.dbPath || ":memory:");
  db.exec(
    "CREATE TABLE IF NOT EXISTS records(collection TEXT,id TEXT,payload TEXT,PRIMARY KEY(collection,id))",
  );
  let instant = new Date("2026-10-26T12:00:00Z");
  const database =
    options.database || createLocalSuiteDatabase(db, { clock: () => instant });
  const server = createServer(async (request, response) => {
    try {
      const path = parsePath(request);
      const args = {
        path,
        request,
        response,
        database,
        access: options.access || localAccess(),
      };
      await (
        isSuitePublicPath(path) ? handleSuitePublicRequest : handleSuiteRequest
      )(args);
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, {
        error: error.message,
      });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  async function api(path, method = "GET", body, expected = 200) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      },
    );
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  const create = async (kind, title, data) =>
    (await api(`/api/suite/${kind}`, "POST", { title, data }, 201)).item;
  const action = (name, body, expected = 200) =>
    api(`/api/suite/actions/${name}`, "POST", body, expected);
  return {
    db,
    database,
    api,
    create,
    action,
    advance: (seconds) => {
      instant = new Date(instant.getTime() + seconds * 1000);
    },
  };
}

test("suite SQLite CRUD keeps references, revisions and persistence across a fresh adapter", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "vox-suite-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = await fixture(t, { dbPath: join(dir, "suite.sqlite") });
  const project = await f.create("projects", "Projeto real", {
    members: ["local"],
    startDate: "2026-10-26",
    endDate: "2026-11-30",
  });
  const task = await f.create("project_tasks", "Entrega", {
    projectId: project.id,
    assigneeId: "local",
  });
  const updated = (
    await f.api(`/api/suite/project_tasks/${task.id}`, "PATCH", {
      revision: 1,
      data: { status: "doing" },
    })
  ).item;
  assert.equal(updated.revision, 2);
  assert.equal(updated.title, "Entrega");
  await f.api(
    `/api/suite/project_tasks/${task.id}`,
    "PATCH",
    { revision: 1, data: { status: "done" } },
    409,
  );
  await f.api(
    `/api/suite/projects/${project.id}?revision=1`,
    "DELETE",
    undefined,
    409,
  );
  const other = createLocalSuiteDatabase(f.db);
  const rows = await other("/rest/v1/rpc/crm_suite_list", { body: "{}" });
  assert.equal(rows.find((x) => x.id === task.id).data.status, "doing");
  await f.api(`/api/suite/project_tasks/${task.id}?revision=2`, "DELETE");
  await f.api(`/api/suite/projects/${project.id}?revision=1`, "DELETE");
  assert.equal((await f.api("/api/suite/state")).items.length, 0);
});

test("documents calculate money from lines and reject fake payment or unauthorized fields", async (t) => {
  const f = await fixture(t);
  const quote = await f.create("quotes", "Orçamento", {
    customer: "Cliente",
    lines: [{ description: "Serviço", quantity: 1.5, unitPrice: 10.55 }],
  });
  assert.equal(quote.data.total, 15.83);
  await f.api(
    "/api/suite/invoices",
    "POST",
    {
      title: "Forjada",
      data: {
        status: "paid",
        lines: [{ description: "Item", quantity: 1, unitPrice: 1 }],
      },
    },
    400,
  );
  await f.api(
    "/api/suite/invoices",
    "POST",
    {
      title: "Forjada",
      data: {
        total: 0,
        lines: [{ description: "Item", quantity: 1, unitPrice: 100 }],
      },
    },
    400,
  );
  await f.api(
    "/api/suite/invoices",
    "POST",
    { title: "Vazia", data: { lines: [] } },
    400,
  );
  await f.api(
    "/api/suite/quotes",
    "POST",
    {
      title: "Sem vínculo",
      data: {
        dealId: "missing",
        lines: [{ description: "Item", quantity: 1, unitPrice: 10 }],
      },
    },
    400,
  );
  await f.api(
    `/api/suite/quotes/${quote.id}`,
    "PATCH",
    { revision: 1, ownerId: "another", data: {} },
    400,
  );
});

test("task timers and attendance use server timestamps, state transitions and measured pauses", async (t) => {
  const f = await fixture(t);
  const project = await f.create("projects", "Tempo", {});
  const task = await f.create("project_tasks", "Tarefa medida", {
    projectId: project.id,
  });
  const timer = await f.action("time_start", { taskId: task.id });
  await f.action("time_start", { taskId: task.id }, 409);
  f.advance(61);
  const stopped = await f.action("time_stop", {
    id: timer.id,
    revision: timer.revision,
  });
  assert.equal(stopped.data.durationSeconds, 61);
  assert.equal(stopped.data.status, "stopped");
  await f.action(
    "time_stop",
    { id: stopped.id, revision: stopped.revision },
    409,
  );
  await f.api(
    "/api/suite/time_entries",
    "POST",
    { title: "Falso", data: { durationSeconds: 999999 } },
    400,
  );
  const entry = await f.action("clock_in", {});
  await f.action("clock_in", {}, 409);
  f.advance(3600);
  const paused = await f.action("pause", { id: entry.id, revision: 1 });
  f.advance(900);
  const resumed = await f.action("resume", {
    id: entry.id,
    revision: paused.revision,
  });
  f.advance(1800);
  const closed = await f.action("clock_out", {
    id: entry.id,
    revision: resumed.revision,
  });
  assert.equal(closed.data.durationSeconds, 5400);
  assert.equal(closed.data.state, "closed");
  assert.equal(closed.data.breaks.length, 1);
  assert.ok(closed.data.breaks[0].endedAt);
  await f.action(
    "clock_out",
    { id: closed.id, revision: closed.revision },
    409,
  );
});

test("workflow approvals derive the designated approver and cannot be overwritten with generic edits", async (t) => {
  const f = await fixture(t);
  const workflow = await f.create("workflows", "Reembolso", {
    type: "reimbursement",
    approverId: "local",
    fields: ["Centro de custo"],
  });
  const request = await f.create("workflow_requests", "Transporte", {
    workflowId: workflow.id,
    reason: "Visita ao cliente",
    amount: 45,
    answers: { "Centro de custo": "Comercial" },
  });
  assert.equal(request.data.approverId, "local");
  assert.equal(request.data.status, "pending");
  await f.api(
    `/api/suite/workflow_requests/${request.id}`,
    "PATCH",
    { revision: 1, data: { status: "approved" } },
    400,
  );
  const decided = await f.action("approve", {
    id: request.id,
    revision: request.revision,
    note: "Comprovante conferido",
  });
  assert.equal(decided.data.status, "approved");
  assert.equal(decided.data.decidedBy, "local");
  assert.ok(decided.data.decidedAt);
  await f.action(
    "reject",
    { id: decided.id, revision: decided.revision, note: "alterar decisão" },
    409,
  );
  await f.api(
    `/api/suite/workflow_requests/${decided.id}`,
    "PATCH",
    { revision: decided.revision, data: { amount: 0 } },
    403,
  );
  await f.api(
    "/api/suite/workflow_requests",
    "POST",
    {
      title: "Injetar campo",
      data: {
        workflowId: workflow.id,
        reason: "R",
        answers: { "Outro campo": "x" },
      },
    },
    400,
  );
});

test("converting a lead atomically creates linked real CRM records and is idempotently guarded", async (t) => {
  const f = await fixture(t);
  const lead = await f.create("leads", "Oportunidade", {
    name: "Pessoa",
    email: "pessoa@example.invalid",
    phone: "1199999999",
    value: 250,
    notes: "Conversão real",
  });
  const converted = await f.action("convert_lead", {
    id: lead.id,
    revision: 1,
  });
  assert.equal(converted.data.status, "converted");
  const rows = f.db.prepare("SELECT collection,payload FROM records").all();
  assert.equal(rows.length, 2);
  const contact = JSON.parse(
    rows.find((x) => x.collection === "contacts").payload,
  );
  const deal = JSON.parse(rows.find((x) => x.collection === "deals").payload);
  assert.equal(contact.name, "Pessoa");
  assert.equal(deal.contactId, contact.id);
  assert.equal(deal.value, 250);
  assert.equal(converted.data.dealId, deal.id);
  await f.action(
    "convert_lead",
    { id: lead.id, revision: converted.revision },
    409,
  );
  assert.equal(f.db.prepare("SELECT count(*) n FROM records").get().n, 2);
});

test("public booking exposes availability without guest details and rejects overlaps or invalid slots", async (t) => {
  const f = await fixture(t);
  const page = await f.create("booking_pages", "Conversa comercial", {
    durationMinutes: 30,
    weekdays: [1, 2, 3, 4, 5],
    startHour: 9,
    endHour: 17,
    enabled: true,
  });
  const booked = await f.api(
    `/api/booking/${page.id}`,
    "POST",
    {
      name: "Cliente",
      email: "cliente@example.invalid",
      startAt: "2026-10-27T13:00:00Z",
    },
    201,
  );
  assert.equal(booked.ok, true);
  const availability = await f.api(`/api/booking/${page.id}`);
  assert.ok(availability.busyStartTimes.includes("2026-10-27T13:00:00.000Z"));
  assert.equal(
    JSON.stringify(availability).includes("cliente@example.invalid"),
    false,
  );
  await f.api(
    `/api/booking/${page.id}`,
    "POST",
    {
      name: "Outro",
      email: "outro@example.invalid",
      startAt: "2026-10-27T13:00:00Z",
    },
    409,
  );
  await f.api(
    `/api/booking/${page.id}`,
    "POST",
    {
      name: "Outro",
      email: "outro@example.invalid",
      startAt: "2026-10-27T13:15:00Z",
    },
    400,
  );
  await f.api(
    `/api/booking/${page.id}`,
    "POST",
    {
      name: "Outro",
      email: "outro@example.invalid",
      startAt: "2026-10-27T22:00:00Z",
    },
    400,
  );
  const state = await f.api("/api/suite/state");
  const event = state.items.find((x) => x.id === booked.id);
  assert.equal(event.data.visibility, "personal");
  assert.match(event.data.description, /cliente@example\.invalid/);
});

test("real local deal stage rules create tasks or change stage and never pretend to send email", async (t) => {
  const f = await fixture(t);
  const deal = {
    id: "deal-real",
    title: "Venda",
    stage: "qualified",
    owner: "Usuário local",
  };
  f.db
    .prepare("INSERT INTO records(collection,id,payload)VALUES('deals',?,?)")
    .run(deal.id, JSON.stringify(deal));
  await f.create("automations", "Criar tarefa", {
    stage: "qualified",
    action: "create_task",
    taskTitle: "Preparar proposta",
    delayDays: 2,
    enabled: true,
  });
  await f.create("automations", "Aguardar provedor", {
    stage: "qualified",
    action: "send_email",
    emailSubject: "Assunto",
    emailBody: "Conteúdo",
    enabled: true,
  });
  runLocalSuiteAutomations(f.db, {
    before: { ...deal, stage: "new" },
    after: deal,
  });
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM records WHERE collection='tasks'")
      .get().n,
    1,
  );
  runLocalSuiteAutomations(f.db, { before: deal, after: deal });
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM records WHERE collection='tasks'")
      .get().n,
    1,
  );
  const rules = (await f.api("/api/suite/state")).items.filter(
    (x) => x.kind === "automations",
  );
  assert.equal(
    rules.find((x) => x.title === "Aguardar provedor").data.lastRun.status,
    "provider_required",
  );
});

test("suite HTTP boundaries reject pending access, foreign DTOs, forged commands and unconfigured external sends", async (t) => {
  const pending = await fixture(t, {
    access: { ...localAccess(), role: null },
  });
  await pending.api("/api/suite/state", "GET", undefined, 403);
  const foreign = await fixture(t, {
    access: {
      ...localAccess(),
      storage: "supabase",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    database: async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ownerId: "22222222-2222-4222-8222-222222222222",
        kind: "notes",
        title: "Não expor",
        data: { body: "Privado" },
        revision: 1,
        createdAt: "2026-10-26T12:00:00Z",
        updatedAt: "2026-10-26T12:00:00Z",
      },
    ],
  });
  const rejected = await foreign.api("/api/suite/state", "GET", undefined, 502);
  assert.equal(JSON.stringify(rejected).includes("Privado"), false);
  const f = await fixture(t);
  await f.action(
    "clock_in",
    { userId: "another", startedAt: "2000-01-01T00:00:00Z" },
    400,
  );
  await f.api("/api/suite/unknown", "POST", { title: "X", data: {} }, 404);
  await f.api(
    "/api/suite/leads/invalid",
    "PATCH",
    { revision: 1, data: {} },
    400,
  );
  const conversation = await f.create(
    "service_conversations",
    "WhatsApp sem provedor",
    { channel: "whatsapp", customer: "Cliente" },
  );
  await f.api(
    "/api/suite/service_messages",
    "POST",
    {
      title: "Mensagem",
      data: {
        conversationId: conversation.id,
        text: "Mensagem não enviada",
        direction: "outbound",
      },
    },
    503,
  );
  assert.equal(
    (await f.api("/api/suite/state")).items.some(
      (x) => x.kind === "service_messages",
    ),
    false,
  );
  assert.throws(
    () => validateSuiteData("leads", { ownerId: "another" }),
    /campos|valores/,
  );
  assert.throws(
    () =>
      completeSuiteData("projects", {
        startDate: "2026-11-20",
        endDate: "2026-11-01",
      }),
    /final/,
  );
});
