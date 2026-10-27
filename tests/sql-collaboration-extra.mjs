import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const db = new PGlite();
let checks = 0;
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333",
  D = "44444444-4444-4444-8444-444444444444",
  E = "55555555-5555-4555-8555-555555555555";
const TEAM = "534341de-9a86-4d96-b7f8-57fd96be6e3a",
  OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  FILE = "77777777-7777-4777-8777-777777777777";
const check = (condition, label) => {
  assert.ok(condition, label);
  checks++;
};
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
async function as(id, fn, role = "authenticated") {
  await db.exec("set role " + role);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || "",
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function reject(fn) {
  let failed = false;
  try {
    await fn();
  } catch {
    failed = true;
  }
  check(failed, "Unauthorized or invalid action must fail");
}
const rpc = (who, action, args = {}) =>
  as(
    who,
    async () =>
      (
        await row(
          "select public.crm_collaboration_extra($1,$2::jsonb) as result",
          [action, JSON.stringify(args)],
        )
      ).result,
  );
const load = (name) =>
  readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb default '{}',unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select on storage.objects to anon,authenticated;grant insert,update,delete on storage.objects to authenticated;
 create policy legacy_broad on storage.objects for all to public using(true) with check(true);
 insert into storage.buckets values('unrelated','Unrelated',true,10,null);insert into storage.objects(bucket_id,name)values('unrelated','kept.txt');`);
  await db.exec(await load("20261026000000_crm_workspaces.sql"));
  await db.exec(await load("20261026010000_crm_roles.sql"));
  for (const id of [A, B, C, D, E])
    await db.query("insert into auth.users values($1,$2,now(),$3)", [
      id,
      id + "@example.invalid",
      JSON.stringify({ full_name: "Pessoa " + id[0] }),
    ]);
  await db.query(
    "insert into public.crm_teams(id,name,seeded)values($1,'Outra',true)",
    [OTHER],
  );
  for (const [id, team, role, active] of [
    [A, TEAM, "user", true],
    [B, TEAM, "admin", true],
    [C, OTHER, "manager", true],
    [D, TEAM, "user", true],
    [E, TEAM, "user", false],
  ])
    await db.query(
      "insert into public.crm_members(workspace_id,user_id,role,active)values($1,$2,$3,$4)",
      [team, id, role, active],
    );
  const sql = await load("20261026050000_crm_collaboration_extra.sql");
  await db.exec(sql);
  check(
    (
      await row(
        "select public from storage.buckets where id='crm-shared-files'",
      )
    ).public === false,
    "Bucket private",
  );
  await reject(() =>
    as(
      null,
      () => db.query("select public.crm_collaboration_extra('state')"),
      "anon",
    ),
  );
  await reject(() => rpc(E, "state"));
  const group = await rpc(A, "groups_create", {
    title: "Projeto privado",
    memberIds: [D],
  });
  check(!!group.id, "Group created");
  check((await rpc(A, "state")).groups.length === 1, "Author sees group");
  check(
    (await rpc(D, "state")).groups[0].memberIds.length === 2,
    "Participant sees membership",
  );
  check(
    (await rpc(B, "state")).groups.length === 0,
    "Nonparticipant admin cannot discover group",
  );
  check(
    (await rpc(C, "state")).groups.length === 0,
    "Other workspace cannot discover group",
  );
  await reject(() => rpc(A, "groups_create", { title: "Bad", memberIds: [C] }));
  await reject(() => rpc(A, "groups_create", { title: "Bad", memberIds: [E] }));
  await rpc(A, "groups_send", { groupId: group.id, body: "Primeira mensagem" });
  await rpc(D, "groups_send", { groupId: group.id, body: "Resposta" });
  const history = await rpc(D, "groups_messages", { groupId: group.id });
  check(history.items.length === 2, "Participant gets history");
  check(history.items[0].senderId === A, "Server owns sender identity");
  await reject(() => rpc(B, "groups_messages", { groupId: group.id }));
  await reject(() =>
    rpc(C, "groups_send", { groupId: group.id, body: "Invadir" }),
  );
  check(
    (
      await as(B, () =>
        row("select count(*)::int n from public.crm_extra_messages"),
      )
    ).n === 0,
    "RLS hides messages from nonparticipant admin",
  );
  check(
    (
      await as(D, () =>
        row("select count(*)::int n from public.crm_extra_messages"),
      )
    ).n === 2,
    "RLS permits group participant",
  );
  await reject(() =>
    as(A, () =>
      db.query(
        "insert into public.crm_extra_messages(workspace_id,group_id,sender_id,sender_name,body)values($1,$2,$3,'forge','forge')",
        [TEAM, group.id, D],
      ),
    ),
  );
  // Equal timestamps exercise the UUID cursor tie-breaker.
  await db.query(
    "update public.crm_extra_messages set created_at='2026-01-01T00:00:00Z' where group_id=$1",
    [group.id],
  );
  const ordered = await rpc(A, "groups_messages", { groupId: group.id });
  const second = ordered.items[1];
  check(
    (
      await rpc(A, "groups_messages", {
        groupId: group.id,
        before: second.createdAt,
        beforeId: second.id,
      })
    ).items.length === 1,
    "History cursor preserves equal timestamp messages",
  );
  const poll = await rpc(A, "polls_create", {
    question: "Quando reunir?",
    options: ["Segunda", "Terça"],
  });
  const state = await rpc(D, "state"),
    p = state.polls.find((p) => p.id === poll.id);
  check(p.options.length === 2, "Poll options carry server IDs");
  await rpc(D, "polls_vote", { pollId: p.id, optionId: p.options[0].id });
  await rpc(D, "polls_vote", { pollId: p.id, optionId: p.options[1].id });
  const after = (await rpc(A, "state")).polls[0];
  check(
    after.options[0].votes === 0 && after.options[1].votes === 1,
    "Changing vote replaces own vote",
  );
  check(
    after.myOptionId === null,
    "Voter identity is not exposed to another account",
  );
  check(
    (
      await as(A, () =>
        row("select count(*)::int n from public.crm_extra_votes"),
      )
    ).n === 0,
    "Direct table RLS hides peers votes",
  );
  await reject(() => rpc(D, "polls_close", { pollId: p.id }));
  await reject(() =>
    rpc(C, "polls_vote", { pollId: p.id, optionId: p.options[0].id }),
  );
  check(
    (
      await as(C, () =>
        row("select count(*)::int n from public.crm_extra_polls"),
      )
    ).n === 0,
    "Cross-workspace poll RLS",
  );
  await rpc(B, "polls_close", { pollId: p.id });
  await reject(() =>
    rpc(A, "polls_vote", { pollId: p.id, optionId: p.options[0].id }),
  );
  const path = TEAM + "/" + FILE + ".txt";
  await as(A, () =>
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id,metadata)values('crm-shared-files',$1,$2,$3)",
      [path, A, JSON.stringify({ mimetype: "text/plain", size: 5 })],
    ),
  );
  const file = await rpc(A, "files_register", {
    name: "plano.txt",
    path,
    mime: "text/plain",
    size: 5,
  });
  check(!!file.id, "Own uploaded file registered");
  check(
    (await rpc(D, "state")).files.length === 1,
    "Colleague sees org shared files",
  );
  check(
    (await rpc(C, "state")).files.length === 0,
    "Other org has no file metadata",
  );
  check(
    (
      await as(D, () =>
        row(
          "select count(*)::int n from storage.objects where bucket_id='crm-shared-files'",
        ),
      )
    ).n === 1,
    "Same org storage reads allowed",
  );
  check(
    (
      await as(C, () =>
        row(
          "select count(*)::int n from storage.objects where bucket_id='crm-shared-files'",
        ),
      )
    ).n === 0,
    "Broad legacy policies cannot expose other org files",
  );
  check(
    (
      await as(
        null,
        () =>
          row(
            "select count(*)::int n from storage.objects where bucket_id='crm-shared-files'",
          ),
        "anon",
      )
    ).n === 0,
    "Anonymous storage denied despite broad policy",
  );
  check(
    (
      await as(
        null,
        () =>
          row(
            "select count(*)::int n from storage.objects where bucket_id='unrelated'",
          ),
        "anon",
      )
    ).n === 1,
    "Other buckets are preserved",
  );
  await reject(() =>
    rpc(D, "files_register", {
      name: "stolen.txt",
      path,
      mime: "text/plain",
      size: 5,
    }),
  );
  await reject(() => rpc(D, "files_remove", { id: file.id }));
  await reject(() =>
    as(C, () =>
      db.query(
        "insert into storage.objects(bucket_id,name,owner_id)values('crm-shared-files',$1,$2)",
        [TEAM + "/88888888-8888-4888-8888-888888888888.txt", C],
      ),
    ),
  );
  await reject(() =>
    as(A, () =>
      db.query(
        "insert into storage.objects(bucket_id,name,owner_id)values('crm-shared-files',$1,$2)",
        [TEAM + "/99999999-9999-4999-8999-999999999999.txt", B],
      ),
    ),
  );
  check(
    (
      await as(D, () =>
        db.query(
          "delete from storage.objects where bucket_id='crm-shared-files' returning id",
        ),
      )
    ).rows.length === 0,
    "Colleague cannot delete own peers files",
  );
  check(
    (
      await as(A, () =>
        db.query(
          "update storage.objects set name=$1 where bucket_id='crm-shared-files' returning id",
          [path],
        ),
      )
    ).rows.length === 0,
    "Shared files cannot be replaced after publication",
  );
  await db.query(
    "update public.crm_members set active=false where user_id=$1",
    [A],
  );
  await reject(() => rpc(A, "state"));
  check(
    (
      await as(A, () =>
        row(
          "select count(*)::int n from storage.objects where bucket_id='crm-shared-files'",
        ),
      )
    ).n === 0,
    "Suspended user loses new storage reads",
  );
  await db.query("update public.crm_members set active=true where user_id=$1", [
    A,
  ]);
  await rpc(B, "files_remove", { id: file.id });
  check(
    (await rpc(A, "state")).files.length === 0,
    "Admin may moderate shared metadata",
  );
  await db.exec(sql);
  check(
    (await rpc(A, "state")).groups.length === 1,
    "Migration repeat preserves existing groups",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks,
      engine: "PostgreSQL/PGlite",
      limitations:
        "Auth and Storage are emulated locally; video is an external Jitsi room link.",
    }),
  );
} finally {
  await db.close();
}
