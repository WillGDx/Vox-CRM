// Local PostgreSQL regression checks. Supabase Auth roles/users are emulated.
// No network requests, real accounts, tokens or credentials are used.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const db = new PGlite();
const app = new URL("../", import.meta.url);
const sql1 = await readFile(
  new URL("supabase/migrations/20261026000000_crm_workspaces.sql", app),
  "utf8",
);
const sql2 = await readFile(
  new URL("supabase/migrations/20261026010000_crm_roles.sql", app),
  "utf8",
);
const { initialState } = await import("../seed.mjs");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";
const O = "44444444-4444-4444-8444-444444444444";
const U = "55555555-5555-4555-8555-555555555555";
const TEAM = "534341de-9a86-4d96-b7f8-57fd96be6e3a";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
}
async function fail(fn, expected) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error, "Expected denial");
  if (expected) assert.match(error.message, expected);
  checks++;
}
async function actor(id, fn) {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}
async function access(id, seed = initialState()) {
  return actor(
    id,
    async () =>
      (
        await db.query("select public.crm_access($1::jsonb) as access", [
          JSON.stringify(seed),
        ])
      ).rows[0].access,
  );
}
async function row(query, params = []) {
  return (await db.query(query, params)).rows[0];
}
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;`);
  for (const [id, email, confirmed] of [
    [A, "owner@example.invalid", true],
    [B, "user@example.invalid", true],
    [M, "manager@example.invalid", true],
    [O, "other@example.invalid", true],
    [U, "unconfirmed@example.invalid", false],
  ]) {
    await db.query("insert into auth.users values($1,$2,$3,$4::jsonb)", [
      id,
      email,
      confirmed ? new Date().toISOString() : null,
      JSON.stringify({ full_name: email.split("@")[0] }),
    ]);
  }
  await db.exec(sql1);
  await db.exec(sql2);
  ok(
    (
      await row(
        `select count(*)::int as n from pg_policies where tablename='crm_records'`,
      )
    ).n === 4,
    "record policies installed",
  );
  await db.query(
    "insert into public.crm_admin_bootstrap(workspace_id,email)values($1,$2)",
    [TEAM, "owner@example.invalid"],
  );
  const legacy = initialState();
  legacy.companies[0].name = "Preserved company";
  await db.query(
    "insert into public.crm_workspaces(user_id,state)values($1,$2::jsonb)",
    [A, JSON.stringify(legacy)],
  );
  const pending = await access(B);
  ok(
    pending.role === null && pending.workspaceId === null,
    "public signup cannot become administrator",
  );
  await db.query(
    "insert into public.crm_admin_bootstrap(workspace_id,email)values($1,$2)on conflict(workspace_id)do update set email=excluded.email",
    [TEAM, "unconfirmed@example.invalid"],
  );
  ok(
    (await access(U)).role === null,
    "unconfirmed reserved account cannot claim",
  );
  await db.query(
    "update public.crm_admin_bootstrap set email=$2 where workspace_id=$1",
    [TEAM, "owner@example.invalid"],
  );
  const admin = await access(A);
  ok(
    admin.role === "admin" && admin.userId === A,
    "verified reserved account claims administrator",
  );
  ok(
    (
      await row(
        `select payload->>'name' as n from public.crm_records where workspace_id=$1 and id='company-1'`,
        [TEAM],
      )
    ).n === "Preserved company",
    "legacy takes precedence over seed",
  );
  ok(
    (
      await row(
        "select count(*)::int as n from public.crm_records where workspace_id=$1",
        [TEAM],
      )
    ).n === 28,
    "seeded all business records",
  );
  ok(
    (
      await row(
        "select state->'companies'->0->>'name' as n from public.crm_workspaces where user_id=$1",
        [A],
      )
    ).n === "Preserved company",
    "legacy table unaltered",
  );
  ok(
    admin.members[0].email === "owner@example.invalid",
    "admin sees member email",
  );
  await actor(A, async () => {
    await db.query("select public.crm_set_member($1,$2,true)", [
      "user@example.invalid",
      "user",
    ]);
    await db.query("select public.crm_set_member($1,$2,true)", [
      "manager@example.invalid",
      "manager",
    ]);
  });
  const user = await access(B);
  ok(
    user.role === "user" && !("email" in user.members[0]),
    "member access omits directory emails",
  );
  ok(
    (await actor(B, () => db.query("select * from public.crm_records"))).rows
      .length === 0,
    "own-scope sees no administrator records",
  );
  await fail(
    () =>
      actor(B, () =>
        db.query("select public.crm_set_member($1,$2,true)", [
          "user@example.invalid",
          "admin",
        ]),
      ),
    /administrador/i,
  );
  await fail(
    () =>
      actor(B, () =>
        db.query(
          "update public.crm_members set role='admin' where user_id=$1",
          [B],
        ),
      ),
    /permission denied/i,
  );
  await fail(
    () =>
      actor(B, () =>
        db.query(
          "update public.crm_permission_profiles set permissions=public.crm_default_permissions('admin') where role='user'",
        ),
      ),
    /permission denied/i,
  );
  await actor(B, () =>
    db.query(
      "insert into public.crm_records(workspace_id,collection,id,owner_id,payload)values($1,'companies','own-company',$2,$3::jsonb)",
      [TEAM, B, JSON.stringify({ id: "own-company", name: "Own company" })],
    ),
  );
  ok(
    (await actor(B, () => db.query("select * from public.crm_records"))).rows
      .length === 1,
    "user owns new record",
  );
  await fail(
    () =>
      actor(B, () =>
        db.query(
          "insert into public.crm_records(workspace_id,collection,id,owner_id,payload)values($1,'companies','forged-owner',$2,$3::jsonb)",
          [TEAM, A, JSON.stringify({ id: "forged-owner", name: "Forged" })],
        ),
      ),
    /row-level security/i,
  );
  await fail(
    () =>
      actor(B, () =>
        db.query(
          "update public.crm_records set owner_id=$1 where id='own-company'",
          [A],
        ),
      ),
    /row-level security/i,
  );
  const updated = await actor(B, () =>
    db.query(
      "update public.crm_records set payload=payload||'{\"name\":\"Edited own\"}'::jsonb where id='own-company' returning version",
    ),
  );
  ok(updated.rows[0].version === 1, "own update increments version");
  ok(
    (
      await actor(B, () =>
        db.query(
          "update public.crm_records set payload=payload where id='own-company' and version=0 returning id",
        ),
      )
    ).rows.length === 0,
    "CAS mismatch does not write",
  );
  await fail(
    () =>
      actor(B, () =>
        db.query(
          "update public.crm_records set version=12 where id='own-company'",
        ),
      ),
    /permission denied/i,
  );
  ok(
    (
      await actor(B, () =>
        db.query(
          "delete from public.crm_records where id='own-company' returning id",
        ),
      )
    ).rows.length === 0,
    "user cannot delete",
  );
  ok(
    (
      await actor(B, () => db.query("select * from public.crm_activities"))
    ).rows.every((x) => x.record_owner_id === B),
    "activity RLS follows ownership",
  );
  ok(
    (
      await actor(M, () =>
        db.query("select count(*)::int as n from public.crm_records"),
      )
    ).rows[0].n === 29,
    "manager reads whole organization",
  );
  await actor(M, () =>
    db.query("update public.crm_records set owner_id=$1 where id='company-1'", [
      B,
    ]),
  );
  ok(
    (
      await actor(B, () =>
        db.query("select * from public.crm_records where id='company-1'"),
      )
    ).rows.length === 1,
    "manager can reassign to active member",
  );
  await fail(
    () =>
      actor(M, () =>
        db.query(
          "select public.crm_save_profile($1,public.crm_permissions($2::uuid))",
          ["user", TEAM],
        ),
      ),
    /administrador/i,
  );
  await fail(
    () =>
      actor(A, () =>
        db.query("select public.crm_set_member($1,$2,false)", [
          "owner@example.invalid",
          "admin",
        ]),
      ),
    /pelo menos/i,
  );
  await fail(
    () =>
      actor(A, () =>
        db.query("select public.crm_set_member($1,$2,true)", [
          "owner@example.invalid",
          "user",
        ]),
      ),
    /pelo menos/i,
  );
  await fail(
    () =>
      actor(A, () =>
        db.query("select public.crm_save_profile($1,$2::jsonb)", [
          "admin",
          JSON.stringify(admin.permissions),
        ]),
      ),
    /fixo/i,
  );
  const restricted = structuredClone(user.permissions);
  restricted.companies.update = "none";
  await actor(A, () =>
    db.query("select public.crm_save_profile($1,$2::jsonb)", [
      "user",
      JSON.stringify(restricted),
    ]),
  );
  ok(
    (
      await actor(B, () =>
        db.query(
          "update public.crm_records set payload=payload where id='own-company' returning id",
        ),
      )
    ).rows.length === 0,
    "profile change immediately enforced",
  );
  await actor(A, () =>
    db.query("select public.crm_set_member($1,$2,false)", [
      "user@example.invalid",
      "user",
    ]),
  );
  ok(
    (await access(B)).role === null,
    "suspended member loses workspace access",
  );
  ok(
    (await actor(B, () => db.query("select * from public.crm_records"))).rows
      .length === 0,
    "suspended token cannot read records directly",
  );
  await actor(A, () =>
    db.query("select public.crm_set_member($1,$2,true)", [
      "user@example.invalid",
      "user",
    ]),
  );
  await db.query(
    "insert into public.crm_teams(id,name,seeded)values($1,'Other',true)",
    [OTHER],
  );
  await db.query(
    "insert into public.crm_members(workspace_id,user_id,role)values($1,$2,'admin')",
    [OTHER, O],
  );
  await db.query(
    "insert into public.crm_records(workspace_id,collection,id,owner_id,payload)values($1,'companies','other-company',$2,$3::jsonb)",
    [OTHER, O, JSON.stringify({ id: "other-company", name: "Other company" })],
  );
  ok(
    (
      await actor(M, () =>
        db.query("select * from public.crm_records where workspace_id=$1", [
          OTHER,
        ]),
      )
    ).rows.length === 0,
    "manager cannot cross organizations",
  );
  await fail(
    () =>
      actor(M, () =>
        db.query(
          "insert into public.crm_records(workspace_id,collection,id,owner_id,payload)values($1,'companies','cross-workspace',$2,$3::jsonb)",
          [
            OTHER,
            M,
            JSON.stringify({ id: "cross-workspace", name: "Blocked" }),
          ],
        ),
      ),
    /row-level security|responsável/i,
  );
  await fail(
    () =>
      actor(M, () =>
        db.query(
          "insert into public.crm_records(workspace_id,collection,id,owner_id,payload)values($1,'deals','cross-reference',$2,$3::jsonb)",
          [
            TEAM,
            M,
            JSON.stringify({
              id: "cross-reference",
              title: "Blocked",
              companyId: "other-company",
            }),
          ],
        ),
      ),
    /vínculo/i,
  );
  await actor(A, () =>
    db.query("delete from public.crm_records where id='company-1'"),
  );
  ok(
    (
      await row(
        `select payload->>'companyId' as parent from public.crm_records where workspace_id=$1 and id='contact-1'`,
        [TEAM],
      )
    ).parent === "",
    "deleting parent unlinks related records",
  );
  const incoherent = structuredClone(user.permissions);
  incoherent.companies.read = "none";
  await fail(
    () =>
      actor(A, () =>
        db.query("select public.crm_save_profile($1,$2::jsonb)", [
          "user",
          JSON.stringify(incoherent),
        ]),
      ),
    /inválid/i,
  );
  const widerThanRead = structuredClone(user.permissions);
  widerThanRead.companies.update = "all";
  await fail(
    () =>
      actor(A, () =>
        db.query("select public.crm_save_profile($1,$2::jsonb)", [
          "user",
          JSON.stringify(widerThanRead),
        ]),
      ),
    /inválid/i,
  );
  await actor(A, () =>
    db.query("select public.crm_set_member($1,$2,true)", [
      "manager@example.invalid",
      "admin",
    ]),
  );
  await actor(A, () =>
    db.query("select public.crm_set_member($1,$2,true)", [
      "owner@example.invalid",
      "user",
    ]),
  );
  ok(
    (await access(A)).role === "user",
    "claimed bootstrap never regrants administrator after demotion",
  );
  await actor(M, () =>
    db.query("select public.crm_set_member($1,$2,true)", [
      "owner@example.invalid",
      "admin",
    ]),
  );
  await actor(A, () =>
    db.query("select public.crm_set_member($1,$2,true)", [
      "manager@example.invalid",
      "manager",
    ]),
  );
  await fail(
    () =>
      actor(B, () =>
        db.query(
          "insert into public.crm_activities(workspace_id,collection,text,type)values($1,'companies','Forged audit','company')",
          [TEAM],
        ),
      ),
    /permission denied/i,
  );
  await fail(
    () =>
      actor(A, () =>
        db.query(
          "insert into public.crm_records(workspace_id,collection,id,owner_id,payload)values($1,'companies','invalid-schema',$2,$3::jsonb)",
          [TEAM, A, JSON.stringify({ id: "invalid-schema", name: 42 })],
        ),
      ),
    /Tipo inválido/i,
  );
  const before = (
    await row("select count(*)::int as n from public.crm_records")
  ).n;
  await db.exec(sql2);
  ok(
    (await row("select count(*)::int as n from public.crm_records")).n ===
      before,
    "idempotent migration preserves records",
  );
  ok(
    (await access(B)).permissions.companies.update === "none",
    "idempotent migration preserves edited permissions",
  );
  await db.exec("set role anon;");
  await fail(
    () => db.query("select * from public.crm_records"),
    /permission denied/i,
  );
  await db.exec("reset role;");
  console.log(
    JSON.stringify({
      status: "passed",
      checks,
      engine: "PostgreSQL/PGlite",
      limitations:
        "Supabase Auth roles and users are locally emulated; no remote API used.",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.message,
      code: error.code,
      position: error.position,
      where: error.where,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
