// Anonymous website-chat policy checks, using only an emulated local database.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const db = new PGlite();
const M = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  O = "33333333-3333-4333-8333-333333333333";
const TEAM = "534341de-9a86-4d96-b7f8-57fd96be6e3a",
  OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HASH = "a".repeat(64),
  OTHER_HASH = "b".repeat(64);
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
async function fail(fn, code) {
  let e;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  assert.ok(e, "Expected SQL rejection");
  assert.ok(
    ["42501", "22023", "P0002", "54000"].includes(e.code),
    `Unexpected SQL failure ${e.message} ${e.code}`,
  );
  if (code) assert.equal(e.code, code);
  checks++;
}
const chat = (action, id, hash = null, args = {}) =>
  actor(
    "",
    async () =>
      (
        await row(
          "select public.crm_webchat_public($1,$2,$3,$4::jsonb) as result",
          [action, id, hash, JSON.stringify(args)],
        )
      ).result,
    "anon",
  );
const save = (actorId, kind, title, data = {}, prev = null) =>
  actor(
    actorId,
    async () =>
      (
        await row(
          "select public.crm_suite_save($1,$2,$3,$4::jsonb,$5) as result",
          [
            kind,
            prev?.id || null,
            title,
            JSON.stringify(data),
            prev?.revision ?? null,
          ],
        )
      ).result,
  );
const list = (id) =>
  actor(
    id,
    async () => (await row("select public.crm_suite_list() as items")).items,
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
  await db.query(
    "insert into public.crm_teams(id,name,seeded)values($1,$2,true)",
    [OTHER, "Outra organização"],
  );
  for (const [id, role, team] of [
    [M, "manager", TEAM],
    [B, "user", TEAM],
    [O, "manager", OTHER],
  ]) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())",
      [id, id[0] + "@example.invalid"],
    );
    await db.query(
      "insert into public.crm_members(workspace_id,user_id,role)values($1,$2,$3)",
      [team, id, role],
    );
  }
  await db.query(
    "insert into public.crm_permission_profiles(workspace_id,role,permissions)select $1,r,public.crm_default_permissions(r)from unnest(array['admin','manager','user'])r on conflict do nothing",
    [OTHER],
  );
  for (const file of [
    "20261026040000_crm_suite.sql",
    "20261026060000_crm_webchat.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261026060000_crm_webchat.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const channel = await save(M, "channels", "Atendimento do site", {
    type: "webchat",
  });
  const publicConfig = await chat("config", channel.id);
  ok(
    publicConfig.id === channel.id &&
      publicConfig.title === channel.title &&
      Object.keys(publicConfig).length === 2,
    "Public widget config reveals only channel ID/title",
  );
  const session = await chat("start", channel.id, HASH, {
    name: "Cliente Alfa",
    email: "alfa@example.invalid",
    message: "Primeira mensagem",
  });
  ok(
    session.id && session.conversationId,
    "Visitor can create isolated website session",
  );
  const stored = await row(
    "select token_hash,workspace_id,conversation_id from public.crm_webchat_sessions where id=$1",
    [session.id],
  );
  ok(
    stored.token_hash === HASH &&
      stored.workspace_id === TEAM &&
      stored.conversation_id === session.conversationId,
    "Session stores only token hash and authoritative tenant",
  );
  await fail(
    () =>
      actor(
        "",
        () => db.query("select * from public.crm_webchat_sessions"),
        "anon",
      ),
    "42501",
  );
  await fail(
    () => actor(M, () => db.query("select * from public.crm_webchat_sessions")),
    "42501",
  );
  await fail(
    () =>
      actor("", () => db.query("select * from public.crm_suite_items"), "anon"),
    "42501",
  );
  let history = await chat("session", session.id, HASH);
  ok(
    history.messages.length === 1 &&
      history.messages[0].text === "Primeira mensagem" &&
      history.messages[0].direction === "inbound",
    "Visitor sees own inbound history",
  );
  ok(
    !JSON.stringify(history).includes("alfa@example.invalid") &&
      !("token_hash" in history) &&
      !("workspaceId" in history),
    "Public history omits account and visitor metadata",
  );
  const session2 = await chat("start", channel.id, OTHER_HASH, {
    name: "Cliente Beta",
    email: "beta@example.invalid",
    message: "Segunda sessão privada",
  });
  ok(
    session2.id !== session.id &&
      session2.conversationId !== session.conversationId,
    "Each visitor session gets a distinct conversation",
  );
  await fail(() => chat("session", session.id, OTHER_HASH), "P0002");
  await fail(
    () => chat("send", session.id, OTHER_HASH, { message: "Invadir" }),
    "P0002",
  );
  await fail(() => chat("session", session.id, "not-a-hash"), "P0002");
  await fail(() => chat("session", session.id, null), "P0002");
  history = await chat("session", session.id, HASH);
  ok(
    !JSON.stringify(history).includes("Segunda sessão privada"),
    "Session history never includes another visitor conversation",
  );
  const operator = await list(M);
  ok(
    operator.some((x) => x.id === session.conversationId) &&
      operator.some(
        (x) =>
          x.kind === "service_messages" && x.data.text === "Primeira mensagem",
      ),
    "Authorized operator receives actual inbound conversation/message",
  );
  ok(
    !(await list(O)).some((x) => x.id === session.conversationId),
    "Other organization cannot see inbound conversation",
  );
  ok(
    !(await list(B)).some((x) => x.id === session.conversationId),
    "Unassigned ordinary staff cannot see operator private queue",
  );
  const reply = await save(M, "service_messages", "Resposta", {
    conversationId: session.conversationId,
    text: "Resposta real do operador",
    direction: "outbound",
  });
  history = await chat("session", session.id, HASH);
  ok(
    history.messages.some(
      (x) =>
        x.id === reply.id &&
        x.text === "Resposta real do operador" &&
        x.direction === "outbound",
    ),
    "Visitor receives stored operator response",
  );
  const conv = (await list(M)).find((x) => x.id === session.conversationId);
  const closed = await save(
    M,
    "service_conversations",
    null,
    { status: "closed" },
    conv,
  );
  await fail(
    () => chat("send", session.id, HASH, { message: "Após encerrar" }),
    "22023",
  );
  ok(
    (await chat("session", session.id, HASH)).status === "closed",
    "Closed session retains readable history but rejects new messages",
  );
  await fail(
    () =>
      chat("start", channel.id, HASH, {
        name: "X",
        email: "",
        message: "Inválida",
      }),
    "22023",
  );
  await fail(
    () =>
      chat("start", channel.id, HASH, {
        name: "Pessoa",
        email: "bad-email",
        message: "Inválida",
      }),
    "22023",
  );
  await fail(
    () =>
      chat("start", channel.id, HASH, {
        name: "Pessoa",
        email: "",
        message: "x".repeat(4001),
      }),
    "22023",
  );
  await fail(
    () =>
      chat("start", channel.id, HASH, {
        name: "Pessoa",
        email: "",
        message: "",
      }),
    "22023",
  );
  const currentChannel = (await list(M)).find((x) => x.id === channel.id);
  const disabled = await save(
    M,
    "channels",
    null,
    { enabled: false },
    currentChannel,
  );
  await fail(() => chat("config", channel.id), "P0002");
  await fail(
    () =>
      chat("start", channel.id, HASH, {
        name: "Pessoa",
        email: "",
        message: "Olá",
      }),
    "P0002",
  );
  await fail(() => chat("session", session2.id, OTHER_HASH), "P0002");
  await save(M, "channels", null, { enabled: true }, disabled);
  await db.query(
    "update public.crm_webchat_sessions set expires_at=clock_timestamp()-interval '1 second'where id=$1",
    [session2.id],
  );
  await fail(() => chat("session", session2.id, OTHER_HASH), "P0002");
  const manual = await save(M, "channels", "Manual", { type: "manual" });
  await fail(() => chat("config", manual.id), "P0002");
  await db.query(
    "update public.crm_members set active=false where user_id=$1",
    [M],
  );
  await fail(() => chat("config", channel.id), "P0002");
  await fail(
    () =>
      chat("start", channel.id, HASH, {
        name: "Pessoa",
        email: "",
        message: "Olá",
      }),
    "P0002",
  );
  await db.query("update public.crm_members set active=true where user_id=$1", [
    M,
  ]);
  // Rate checks use scoped local fixtures, not loops that contact any real service.
  const limitChannel = await save(M, "channels", "Limites", {
    type: "webchat",
  });
  const limitSession = await chat("start", limitChannel.id, HASH, {
    name: "Pessoa Limite",
    email: "",
    message: "Primeira",
  });
  await db.query(
    "insert into public.crm_suite_items(workspace_id,kind,title,data,owner_id)select $1,'service_messages','Mensagem',$2::jsonb,$3 from generate_series(1,19)",
    [
      TEAM,
      JSON.stringify({
        conversationId: limitSession.conversationId,
        text: "Mensagem dentro de um minuto",
        direction: "inbound",
      }),
      M,
    ],
  );
  await fail(
    () => chat("send", limitSession.id, HASH, { message: "Excesso" }),
    "54000",
  );
  await db.query(
    "insert into public.crm_webchat_sessions(channel_id,workspace_id,conversation_id,token_hash)select $1,$2,$3,$4 from generate_series(1,59)",
    [limitChannel.id, TEAM, limitSession.conversationId, HASH],
  );
  await fail(
    () =>
      chat("start", limitChannel.id, HASH, {
        name: "Pessoa Limite",
        email: "",
        message: "Nova sessão excessiva",
      }),
    "54000",
  );
  const sessionCount = (
    await row("select count(*)::int n from public.crm_webchat_sessions")
  ).n;
  const messagesCount = (
    await row(
      "select count(*)::int n from public.crm_suite_items where kind='service_messages'",
    )
  ).n;
  ok(
    sessionCount === 62 && messagesCount === 23,
    "Rejected rate-limit attempts create no session or message",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks,
      engine: "PostgreSQL/PGlite",
      limitations:
        "Auth roles are emulated locally; no production visitors or external provider calls.",
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
