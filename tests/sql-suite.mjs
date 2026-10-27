// PostgreSQL operational-module checks. Auth roles are emulated, no network.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const db = new PGlite();
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  M = "33333333-3333-4333-8333-333333333333",
  O = "44444444-4444-4444-8444-444444444444",
  S = "55555555-5555-4555-8555-555555555555",
  P = "66666666-6666-4666-8666-666666666666";
const TEAM = "534341de-9a86-4d96-b7f8-57fd96be6e3a",
  OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let checks = 0;
function ok(v, label) {
  assert.ok(v, label);
  checks++;
}
async function row(q, p = []) {
  return (await db.query(q, p)).rows[0];
}
async function actor(id, fn, role = "authenticated") {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || "",
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function fail(fn, pattern, expectedCode) {
  let e;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  assert.ok(e, "Expected denial");
  assert.ok(
    ["42501", "22023", "PT409", "23514", "23505", "23503", "P0002"].includes(
      e.code,
    ),
    `Unexpected SQL failure: ${e.message} (${e.code})`,
  );
  if (pattern) assert.match(e.message, pattern);
  if (expectedCode) assert.equal(e.code, expectedCode);
  checks++;
}
const save = (id, kind, title, data = {}, prev = null) =>
  actor(
    id,
    async () =>
      (
        await row(
          "select public.crm_suite_save($1,$2,$3,$4::jsonb,$5) as item",
          [
            kind,
            prev?.id || null,
            title,
            JSON.stringify(data),
            prev?.revision ?? null,
          ],
        )
      ).item,
  );
const change = (id, item, data, title = null) =>
  save(id, item.kind, title, data, item);
const list = (id) =>
  actor(
    id,
    async () => (await row("select public.crm_suite_list() as items")).items,
  );
const action = (id, name, item = null, payload = {}) =>
  actor(
    id,
    async () =>
      (
        await row(
          "select public.crm_suite_action($1,$2,$3,$4::jsonb) as item",
          [
            name,
            item?.id || null,
            item?.revision ?? null,
            JSON.stringify(payload),
          ],
        )
      ).item,
  );
const remove = (id, item) =>
  actor(
    id,
    async () =>
      (
        await row("select public.crm_suite_delete($1,$2,$3) as result", [
          item.kind,
          item.id,
          item.revision,
        ])
      ).result,
  );
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'::jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for (const file of [
    "20261026000000_crm_workspaces.sql",
    "20261026010000_crm_roles.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  for (const [id, role, team, active] of [
    [A, "admin", TEAM, true],
    [B, "user", TEAM, true],
    [M, "manager", TEAM, true],
    [O, "manager", OTHER, true],
    [S, "user", TEAM, false],
    [P, null, null, false],
  ]) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),$3::jsonb)",
      [
        id,
        id.slice(0, 1) + "@example.invalid",
        JSON.stringify({ full_name: "Pessoa " + id[0] }),
      ],
    );
    if (team) {
      await db.query(
        "insert into public.crm_teams(id,name,seeded)values($1,$2,true) on conflict(id)do nothing",
        [team, "Fixture"],
      );
      await db.query(
        "insert into public.crm_members(workspace_id,user_id,role,active)values($1,$2,$3,$4)",
        [team, id, role, active],
      );
    }
  }
  await db.query(
    "insert into public.crm_permission_profiles(workspace_id,role,permissions)select $1,r,public.crm_default_permissions(r)from unnest(array['admin','manager','user'])r on conflict do nothing",
    [OTHER],
  );
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20261026040000_crm_suite.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  ok(
    (
      await row(
        "select count(*)::int n from pg_policies where tablename='crm_suite_items'",
      )
    ).n === 1,
    "Idempotent migration installs SELECT policy",
  );
  await fail(() =>
    actor("", () => db.query("select public.crm_suite_list()"), "anon"),
  );
  await fail(() => list(P));
  await fail(() => list(S));
  let lead = await save(B, "leads", "Lead novo", {
    name: "Cliente",
    email: "cliente@example.invalid",
    value: 123,
  });
  ok(
    lead.ownerId === B && lead.workspaceId === TEAM && lead.revision === 1,
    "Verified actor owns created lead",
  );
  ok((await list(B)).length === 1, "Owner reads own lead");
  const adminLead = await save(A, "leads", "Outro lead", {});
  ok(
    !(await list(B)).some((x) => x.id === adminLead.id),
    "Ordinary user cannot read other sales records",
  );
  ok(
    (await list(M)).some((x) => x.id === lead.id),
    "Manager reads organization sales",
  );
  ok(
    !(await list(O)).some((x) => x.id === lead.id),
    "Other tenant cannot read sales",
  );
  await fail(() => change(O, lead, { status: "qualified" }));
  await fail(() =>
    actor(B, () =>
      db.query(
        "insert into public.crm_suite_items(workspace_id,kind,title,owner_id)values($1,'leads','Forge',$2)",
        [TEAM, B],
      ),
    ),
  );
  await fail(() =>
    actor(B, () =>
      db.query("update public.crm_suite_items set owner_id=$1 where id=$2", [
        A,
        lead.id,
      ]),
    ),
  );
  await fail(() => save(B, "leads", "Forge", { workspaceId: OTHER }));
  await fail(() => save(B, "leads", "Forge", { status: "converted" }));
  await fail(() => save(B, "leads", "Forge", { contactId: "not-owned" }));
  await fail(() => save(B, "unknown", "Forge", {}));
  lead = await change(B, lead, { status: "qualified" });
  ok(
    lead.title === "Lead novo" && lead.revision === 2,
    "PATCH merges data and preserves omitted title",
  );
  await fail(
    () => change(B, { ...lead, revision: 1 }, { status: "lost" }),
    /outra pessoa/,
    "PT409",
  );
  await fail(() => remove(M, { ...lead, revision: 1 }), undefined, "PT409");
  await fail(
    () => action(B, "convert_lead", { ...lead, revision: 1 }),
    undefined,
    "PT409",
  );
  await db.query(
    "update public.crm_permission_profiles set permissions=jsonb_set(permissions,'{contacts}',public.crm_default_permissions('user')->'contacts')where workspace_id=$1 and role='manager'",
    [TEAM],
  );
  await fail(() => action(M, "convert_lead", lead));
  await db.query(
    "update public.crm_permission_profiles set permissions=jsonb_set(permissions,'{contacts}',public.crm_default_permissions('manager')->'contacts')where workspace_id=$1 and role='manager'",
    [TEAM],
  );
  lead = await action(B, "convert_lead", lead);
  ok(
    lead.data.status === "converted" && lead.data.contactId && lead.data.dealId,
    "Lead conversion returns created links",
  );
  ok(
    (
      await row(
        "select count(*)::int n from public.crm_records where workspace_id=$1 and id=any($2::text[])",
        [TEAM, [lead.data.contactId, lead.data.dealId]],
      )
    ).n === 2,
    "Lead conversion persists contact and deal atomically",
  );
  await fail(() => action(B, "convert_lead", lead));
  await fail(() => change(B, lead, { status: "new" }));
  const quote = await save(B, "quotes", "Orçamento", {
    customer: "Cliente",
    lines: [{ description: "Produto", quantity: 2, unitPrice: 10.125 }],
    total: 999999,
  });
  ok(
    quote.data.total === 20.25,
    "Quote total derived from line items, ignores forged total",
  );
  await fail(() => save(B, "invoices", "Fatura", { status: "paid" }));
  await fail(() =>
    save(B, "invoices", "Fatura", { paymentUrl: "https://untrusted.example" }),
  );
  await fail(() =>
    save(B, "quotes", "Orçamento", {
      lines: [{ description: "Produto", quantity: -2, unitPrice: 10 }],
    }),
  );
  await fail(() => save(B, "employees", "Pessoa", { userId: B }));
  const employee = await save(A, "employees", "Pessoa", {
    userId: B,
    department: "Comercial",
  });
  ok(
    (await list(B)).some((x) => x.id === employee.id),
    "Employee directory visible to members",
  );
  await fail(() => save(A, "employees", "Fora", { userId: O }));
  await fail(() => save(A, "employees", "Duplicado", { userId: B }));
  const project = await save(M, "projects", "Projeto", { members: [B] });
  ok(
    (await list(B)).some((x) => x.id === project.id),
    "Project member reads assigned project",
  );
  await fail(() => change(B, project, { description: "Forge" }));
  const task = await save(M, "project_tasks", "Tarefa", {
    projectId: project.id,
    assigneeId: B,
  });
  ok(
    (await list(B)).some((x) => x.id === task.id),
    "Assignee reads assigned project task",
  );
  const done = await change(B, task, { status: "done" });
  ok(done.data.status === "done", "Assignee updates own task stage");
  await fail(() => change(B, done, { assigneeId: M }));
  await fail(() => change(B, done, {}, "Renomeada"));
  await fail(() =>
    save(M, "project_tasks", "Tarefa", {
      projectId: project.id,
      assigneeId: O,
    }),
  );
  await fail(() =>
    save(M, "project_tasks", "Tarefa", {
      projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  );
  const dependency = await save(M, "project_tasks", "Dependente", {
    projectId: project.id,
    dependsOn: [task.id],
  });
  await fail(() => change(M, done, { dependsOn: [dependency.id] }), /ciclo/);
  const readonlyProject = await save(A, "projects", "Outro projeto", {});
  ok(
    !(await list(B)).some((x) => x.id === readonlyProject.id),
    "Project nonmember cannot read unrelated project",
  );
  const timer = await action(B, "time_start", null, { taskId: task.id });
  ok(
    timer.data.status === "running" && timer.ownerId === B,
    "Timer uses server actor and timestamp",
  );
  await fail(
    () => action(B, "time_start", null, { taskId: task.id }),
    /andamento/,
  );
  await fail(() => save(B, "time_entries", "Forge", { durationSeconds: 9999 }));
  await fail(() => action(A, "time_stop", timer));
  await fail(() => action(B, "time_stop", timer, { durationSeconds: 99999 }));
  await db.query(
    "update public.crm_suite_items set data=jsonb_set(data,'{startedAt}',to_jsonb(clock_timestamp()-interval '90 seconds'))where id=$1",
    [timer.id],
  );
  const stopped = await action(B, "time_stop", timer);
  ok(
    stopped.data.status === "stopped" &&
      stopped.data.endedAt &&
      stopped.data.durationSeconds >= 90 &&
      stopped.data.durationSeconds <= 100,
    "Timer stop computes server duration",
  );
  ok(
    !(await list(M)).some((x) => x.id === timer.id),
    "Manager cannot read employee private time entries",
  );
  await fail(() => remove(B, stopped));
  const point = await action(B, "clock_in");
  ok(
    point.data.userId === B && point.data.state === "working",
    "Clock-in is actor-bound",
  );
  await fail(() => action(B, "clock_in"), /aberto/);
  const paused = await action(B, "pause", point);
  ok(
    paused.data.breaks.length === 1 && paused.data.state === "paused",
    "Pause records server-owned break",
  );
  await fail(() => action(B, "pause", paused));
  const resumed = await action(B, "resume", paused);
  ok(
    resumed.data.breaks[0].endedAt && resumed.data.state === "working",
    "Resume closes break",
  );
  await db.query(
    "update public.crm_suite_items set data=jsonb_set(jsonb_set(data,'{startedAt}',to_jsonb(clock_timestamp()-interval '120 seconds')),'{breaks}',jsonb_build_array(jsonb_build_object('startedAt',clock_timestamp()-interval '90 seconds','endedAt',clock_timestamp()-interval '60 seconds')))where id=$1",
    [resumed.id],
  );
  const closed = await action(B, "clock_out", resumed);
  ok(
    closed.data.state === "closed" &&
      closed.data.endedAt &&
      closed.data.durationSeconds >= 90 &&
      closed.data.durationSeconds <= 100,
    "Clock-out subtracts actual break duration from server elapsed time",
  );
  await fail(() => action(B, "clock_out", closed));
  await fail(() => save(B, "attendance", "Forge", { userId: A }));
  const flow = await save(M, "workflows", "Reembolso", {
    type: "reimbursement",
    approverId: M,
    fields: ["Centro de custo"],
  });
  await fail(() => save(B, "workflows", "Forge", { approverId: B }));
  await fail(() => save(M, "workflows", "Forge", { approverId: O }));
  const request = await save(B, "workflow_requests", "Despesa", {
    workflowId: flow.id,
    amount: 50,
    reason: "Transporte",
    answers: { "Centro de custo": "Vendas" },
  });
  ok(
    request.data.approverId === M && request.data.status === "pending",
    "Approver derived from workflow",
  );
  await fail(() =>
    save(B, "workflow_requests", "Forge", {
      workflowId: flow.id,
      approverId: B,
    }),
  );
  await fail(() =>
    save(B, "workflow_requests", "Forge", {
      workflowId: flow.id,
      status: "approved",
    }),
  );
  await fail(() =>
    save(B, "workflow_requests", "Forge", {
      workflowId: flow.id,
      answers: { "campo invisível": "Forge" },
    }),
  );
  await fail(() => action(B, "approve", request));
  await db.query("update public.crm_members set role='user' where user_id=$1", [
    M,
  ]);
  await fail(() => action(M, "approve", request));
  await fail(() => action(M, "reject", request));
  await db.query(
    "update public.crm_members set role='manager' where user_id=$1",
    [M],
  );
  const approved = await action(M, "approve", request, { note: "Validado" });
  ok(
    approved.data.status === "approved" &&
      approved.data.decidedBy === M &&
      approved.data.decidedAt,
    "Only designated approver decides with audit identity",
  );
  await fail(() => action(M, "reject", approved));
  await fail(() => change(B, approved, { amount: 1 }));
  const note = await save(B, "notes", "Minha nota", { body: "Pessoal" });
  ok(
    !(await list(A)).some((x) => x.id === note.id),
    "Personal notes stay private from other accounts, including admin",
  );
  const teamEvent = await save(M, "calendar_events", "Evento equipe", {
    startAt: "2035-04-02T12:00:00Z",
    endAt: "2035-04-02T13:00:00Z",
    visibility: "team",
  });
  ok(
    (await list(B)).some((x) => x.id === teamEvent.id),
    "Team event visible to active members",
  );
  await fail(() => change(B, teamEvent, { description: "Forge" }));
  await fail(() =>
    save(M, "calendar_events", "Invertido", {
      startAt: "2035-04-02T13:00:00Z",
      endAt: "2035-04-02T12:00:00Z",
    }),
  );
  const privateEvent = await save(M, "calendar_events", "Evento privado", {
    startAt: "2035-04-03T12:00:00Z",
    endAt: "2035-04-03T13:00:00Z",
  });
  ok(
    !(await list(B)).some((x) => x.id === privateEvent.id),
    "Private event hidden from colleagues",
  );
  const booking = await save(B, "booking_pages", "Agende comigo", {
    durationMinutes: 30,
    startHour: 9,
    endHour: 18,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  });
  const publicPage = await actor(
    "",
    async () =>
      (await row("select public.crm_booking_page($1) as page", [booking.id]))
        .page,
    "anon",
  );
  ok(
    publicPage.title === "Agende comigo" &&
      !JSON.stringify(publicPage).includes("example.invalid") &&
      !("ownerId" in publicPage),
    "Public booking exposes only availability",
  );
  const next = await row(
    "select (date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo')+interval '2 days 10 hours')at time zone 'America/Sao_Paulo' as next",
  );
  const reserved = await actor(
    "",
    async () =>
      (
        await row("select public.crm_booking_reserve($1,$2,$3,$4) as result", [
          booking.id,
          "Cliente Público",
          "public@example.invalid",
          next.next,
        ])
      ).result,
    "anon",
  );
  ok(
    reserved.ok && reserved.id,
    "Anonymous booking persists a private calendar event",
  );
  await fail(
    () =>
      actor(
        "",
        () =>
          db.query("select public.crm_booking_reserve($1,$2,$3,$4)", [
            booking.id,
            "Outro",
            "other@example.invalid",
            next.next,
          ]),
        "anon",
      ),
    /reservado/,
  );
  const before = await row(
    "select count(*)::int n from public.crm_suite_items",
  );
  await fail(() =>
    actor(
      "",
      () =>
        db.query("select public.crm_booking_reserve($1,$2,$3,$4)", [
          booking.id,
          "Cliente",
          "bad-email",
          next.next,
        ]),
      "anon",
    ),
  );
  ok(
    (await row("select count(*)::int n from public.crm_suite_items")).n ===
      before.n,
    "Invalid booking does not write",
  );
  const busy = await actor(
    "",
    async () =>
      (await row("select public.crm_booking_page($1) as page", [booking.id]))
        .page,
    "anon",
  );
  ok(
    busy.busyStartTimes.length === 1 &&
      !JSON.stringify(busy).includes("Cliente Público"),
    "Public availability omits visitor PII",
  );
  const longStart = new Date(new Date(next.next).getTime() + 86400_000);
  const longEnd = new Date(longStart.getTime() + 90 * 60_000);
  await save(B, "calendar_events", "Reunião privada sigilosa", {
    startAt: longStart.toISOString(),
    endAt: longEnd.toISOString(),
    description: "Informação privada: segredo@example.invalid",
  });
  const longBusy = await actor(
    "",
    async () =>
      (await row("select public.crm_booking_page($1) as page", [booking.id]))
        .page,
    "anon",
  );
  ok(
    longBusy.busyStartTimes.length === 2 && longBusy.busyIntervals.length === 2,
    "Public page preserves start times and adds full busy intervals",
  );
  const longInterval = longBusy.busyIntervals.find(
    (x) => Date.parse(x.startAt) === longStart.getTime(),
  );
  ok(
    longInterval &&
      Date.parse(longInterval.endAt) === longEnd.getTime() &&
      Object.keys(longInterval).sort().join(",") === "endAt,startAt" &&
      !JSON.stringify(longBusy).includes("sigilosa") &&
      !JSON.stringify(longBusy).includes("segredo@example.invalid"),
    "Busy intervals expose only boundaries without titles or private details",
  );
  const overlaps = (start) =>
    longBusy.busyIntervals.some(
      (x) =>
        start < Date.parse(x.endAt) &&
        start + 30 * 60_000 > Date.parse(x.startAt),
    );
  ok(
    [0, 30, 60].every((minutes) =>
      overlaps(longStart.getTime() + minutes * 60_000),
    ) && !overlaps(longEnd.getTime()),
    "A long event blocks every overlapping slot while preserving its end boundary",
  );
  await fail(
    () =>
      actor(
        "",
        () =>
          db.query("select public.crm_booking_reserve($1,$2,$3,$4)", [
            booking.id,
            "Cliente",
            "client@example.invalid",
            new Date(longStart.getTime() + 30 * 60_000),
          ]),
        "anon",
      ),
    /reservado/,
  );
  await save(M, "automations", "Criar follow-up", {
    stage: "proposal",
    action: "create_task",
    taskTitle: "Ligar para cliente",
    delayDays: 2,
  });
  await actor(B, () =>
    db.query(
      "update public.crm_records set payload=jsonb_set(payload,'{stage}','\"proposal\"'::jsonb)where workspace_id=$1 and collection='deals' and id=$2",
      [TEAM, lead.data.dealId],
    ),
  );
  ok(
    (
      await row(
        "select count(*)::int n from public.crm_records where workspace_id=$1 and collection='tasks' and payload->>'dealId'=$2 and payload->>'title'='Ligar para cliente'",
        [TEAM, lead.data.dealId],
      )
    ).n === 1,
    "Stage transition creates actual CRM task atomically",
  );
  const log = await row(
    "select status from public.crm_automation_runs where deal_id=$1",
    [lead.data.dealId],
  );
  ok(log.status === "completed", "Internal automation execution recorded");
  await fail(() =>
    save(B, "automations", "Forge", { stage: "won", action: "create_task" }),
  );
  await save(M, "automations", "E-mail", {
    stage: "won",
    action: "send_email",
    emailSubject: "Obrigado",
    emailBody: "Parabéns",
  });
  await actor(B, () =>
    db.query(
      "update public.crm_records set payload=jsonb_set(payload,'{stage}','\"won\"'::jsonb)where workspace_id=$1 and collection='deals' and id=$2",
      [TEAM, lead.data.dealId],
    ),
  );
  ok(
    (
      await row(
        "select status from public.crm_automation_runs where deal_id=$1 order by created_at desc limit 1",
        [lead.data.dealId],
      )
    ).status === "provider_required",
    "Email does not falsely claim delivery",
  );
  const channel = await save(M, "channels", "Site", { type: "webchat" });
  ok(
    (await list(B)).some((x) => x.id === channel.id),
    "Active staff reads available channels",
  );
  await fail(() => save(B, "channels", "Forge", { type: "manual" }));
  let conversation = await save(
    A,
    "service_conversations",
    "Atendimento atribuído",
    { channel: "webchat", assigneeId: B, customer: "Cliente" },
  );
  const inbound = await row(
    "insert into public.crm_suite_items(workspace_id,kind,title,owner_id,data) values($1,'service_messages','Mensagem',$2,$3::jsonb) returning id",
    [
      TEAM,
      A,
      JSON.stringify({
        conversationId: conversation.id,
        text: "Ajuda",
        direction: "inbound",
      }),
    ],
  );
  ok(
    (await list(B)).some((x) => x.id === conversation.id),
    "Assignee reads conversation owned by channel operator",
  );
  ok(
    (await list(B)).some((x) => x.id === inbound.id),
    "Assignee reads inbound messages through authorized parent conversation",
  );
  const reply = await save(B, "service_messages", "Resposta", {
    conversationId: conversation.id,
    text: "Olá",
    direction: "outbound",
  });
  ok(reply.data.text === "Olá", "Assignee can respond to webchat");
  await fail(() => change(B, reply, { text: "Alterado" }));
  await fail(() => remove(A, reply));
  await fail(() =>
    save(B, "service_messages", "Forge", {
      conversationId: conversation.id,
      text: "Visitante falso",
      direction: "inbound",
    }),
  );
  conversation = await change(B, conversation, { status: "closed" });
  await fail(() =>
    save(B, "service_messages", "Resposta", {
      conversationId: conversation.id,
      text: "Olá",
      direction: "outbound",
    }),
  );
  const external = await save(B, "service_conversations", "Canal externo", {
    channel: "whatsapp",
  });
  await fail(() =>
    save(B, "service_messages", "Forge", {
      conversationId: external.id,
      text: "Falso envio",
      direction: "outbound",
    }),
  );
  await fail(() =>
    save(B, "service_messages", "Forge", {
      conversationId: external.id,
      text: "Falsa recepção",
      direction: "inbound",
    }),
  );
  await db.query(
    "update public.crm_permission_profiles set permissions=jsonb_set(permissions,'{tasks}',$2::jsonb)where workspace_id=$1 and role='user'",
    [
      TEAM,
      JSON.stringify({
        read: "none",
        create: false,
        update: "none",
        delete: "none",
        export: false,
      }),
    ],
  );
  ok(
    !(await list(B)).some((x) => x.id === project.id || x.id === task.id),
    "Revoking task module read removes project and assigned-task visibility",
  );
  await fail(() => action(B, "time_start", null, { taskId: task.id }));
  await db.query(
    "update public.crm_members set active=false where user_id=$1",
    [B],
  );
  await fail(() => list(B));
  ok(
    (await actor(B, () => db.query("select * from public.crm_suite_items")))
      .rows.length === 0,
    "Suspension blocks direct SELECT too",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks,
      engine: "PostgreSQL/PGlite",
      limitations:
        "Auth roles are emulated locally; no external provider or real calendar delivery tested.",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      checks,
      message: error.message,
      code: error.code,
      where: error.where,
      stack: error.stack?.split("\n").slice(0, 3),
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
