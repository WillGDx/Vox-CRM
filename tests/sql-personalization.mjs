// PostgreSQL policy regression checks with locally emulated Supabase Auth/Storage.
// No network, real accounts, photos, tokens or credentials are used.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const db = new PGlite();
const app = new URL("../", import.meta.url);
const load = (name) =>
  readFile(new URL(`supabase/migrations/${name}`, app), "utf8");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const F = "66666666-6666-4666-8666-666666666666";
const TEAM = "534341de-9a86-4d96-b7f8-57fd96be6e3a";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUCKET = "crm-personal-media";
const FILE = "77777777-7777-4777-8777-777777777777";
const path = (id, kind, suffix = "webp") => `${id}/${kind}/${FILE}.${suffix}`;
let checks = 0;

function ok(value, message) {
  assert.ok(value, message);
  checks += 1;
}
async function row(sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}
async function actor(id, fn, role = "authenticated") {
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || "",
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function denied(
  fn,
  pattern = /permission denied|row-level security|acesso|administrador/i,
) {
  let error;
  try {
    await fn();
  } catch (cause) {
    error = cause;
  }
  assert.ok(error, "Expected operation to be rejected");
  assert.match(error.message, pattern);
  checks += 1;
}
async function put(id, kind, options = {}) {
  return actor(id, () =>
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id)values($1,$2,$3) returning id",
      [
        options.bucket || BUCKET,
        Object.hasOwn(options, "name") ? options.name : path(id, kind),
        Object.hasOwn(options, "owner") ? options.owner : id,
      ],
    ),
  );
}
async function visible(id, name) {
  return actor(
    id,
    async () =>
      (
        await row(
          "select count(*)::int as n from storage.objects where bucket_id=$1 and name=$2",
          [BUCKET, name],
        )
      ).n,
  );
}
async function directory(id) {
  return actor(
    id,
    async () =>
      (await row("select public.crm_profile_directory() as directory"))
        .directory,
  );
}

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,owner_id text,metadata jsonb default '{}'::jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select on storage.objects to anon,authenticated;
    grant insert,update,delete on storage.objects to authenticated;
    create policy unrelated_public_read on storage.objects for select to anon,authenticated using(bucket_id='unrelated-public');
    create policy legacy_broad_read on storage.objects for select to public using(true);
    create policy legacy_broad_all on storage.objects for all to authenticated using(true) with check(true);
    insert into storage.buckets values('unrelated-public','Preserved public bucket',true,12345,array['text/plain']);
    insert into storage.objects(bucket_id,name)values('unrelated-public','preserved.txt');
  `);
  await db.exec(await load("20261026000000_crm_workspaces.sql"));
  await db.exec(await load("20261026010000_crm_roles.sql"));
  for (const [id, name] of [
    [A, "Ana"],
    [B, "Bruno"],
    [C, "Carla"],
    [D, "Pendente"],
    [E, "Suspenso"],
    [F, "Felipe"],
  ]) {
    await db.query("insert into auth.users values($1,$2,now(),$3::jsonb)", [
      id,
      `${name.toLowerCase()}@example.invalid`,
      JSON.stringify({
        full_name: name,
        phone: "private",
        bio: "private",
        role: "admin",
        crm_preferences: { backgroundPath: path(id, "background") },
      }),
    ]);
  }
  await db.query(
    "insert into public.crm_teams(id,name,seeded)values($1,'Other team',true)",
    [OTHER],
  );
  for (const [id, team, role, active] of [
    [A, TEAM, "user", true],
    [B, TEAM, "admin", true],
    [C, OTHER, "manager", true],
    [E, TEAM, "user", false],
    [F, TEAM, "user", true],
  ]) {
    await db.query(
      "insert into public.crm_members(workspace_id,user_id,role,active)values($1,$2,$3,$4)",
      [team, id, role, active],
    );
  }
  const migration = await load("20261026030000_crm_personalization.sql");
  await db.exec(migration);
  const bucket = await row("select * from storage.buckets where id=$1", [
    BUCKET,
  ]);
  ok(
    bucket && bucket.public === false,
    "personal media bucket remains private",
  );
  ok(
    Number(bucket.file_size_limit) === 8_388_608,
    "storage API receives an eight-MiB limit",
  );
  assert.deepEqual([...bucket.allowed_mime_types].sort(), [
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  checks++;
  ok(
    (await row("select * from storage.buckets where id='unrelated-public'"))
      .file_size_limit === 12345,
    "unrelated bucket configuration preserved",
  );
  ok(
    (
      await row(
        "select count(*)::int as n from pg_policies where schemaname='storage' and tablename='objects' and policyname='unrelated_public_read'",
      )
    ).n === 1,
    "unrelated storage policy preserved",
  );

  await put(A, "avatar");
  await put(A, "background");
  await put(B, "avatar");
  await put(B, "background");
  await put(C, "avatar");
  await put(C, "background");
  ok((await visible(A, path(A, "avatar"))) === 1, "owner reads avatar");
  ok(
    (await visible(A, path(A, "background"))) === 1,
    "owner reads personal background",
  );
  ok(
    (await visible(A, path(B, "avatar"))) === 1,
    "active colleague reads avatar",
  );
  ok(
    (await visible(A, path(B, "background"))) === 0,
    "colleague cannot read background",
  );
  ok(
    (await visible(B, path(A, "background"))) === 0,
    "CRM administrator has no background override",
  );
  ok(
    (await visible(C, path(A, "avatar"))) === 0,
    "other organization cannot read avatar",
  );
  ok(
    (await visible(C, path(C, "background"))) === 1,
    "other organization member reads only own background",
  );
  ok(
    (await visible(D, path(A, "avatar"))) === 0,
    "pending account cannot read coworker avatar",
  );
  ok(
    (await visible(E, path(A, "avatar"))) === 0,
    "suspended account cannot read coworker avatar",
  );
  ok(
    (
      await actor(
        null,
        () =>
          db.query("select * from storage.objects where bucket_id=$1", [
            BUCKET,
          ]),
        "anon",
      )
    ).rows.length === 0,
    "anonymous cannot read private media",
  );
  ok(
    (
      await actor(
        null,
        () =>
          db.query(
            "select * from storage.objects where bucket_id='unrelated-public'",
          ),
        "anon",
      )
    ).rows.length === 1,
    "existing public bucket read is preserved",
  );

  await denied(() => put(A, "avatar", { name: path(B, "avatar", "png") }));
  await denied(() => put(A, "avatar", { name: path(A, "avatar", "svg") }));
  await denied(() =>
    put(A, "avatar", { name: `${A}/avatar/../../secret.webp` }),
  );
  await denied(() => put(A, "avatar", { name: `${A}/avatar/not-a-uuid.webp` }));
  await denied(() =>
    put(A, "avatar", { name: `${A}/avatar/${FILE}.webp/extra` }),
  );
  await denied(() => put(A, "avatar", { name: path(A, "avatar", "PNG") }));
  await denied(() =>
    put(A, "avatar", {
      name: `${A}/avatar/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.webp`,
    }),
  );
  await denied(() => put(A, "other"));
  await denied(() =>
    put(A, "avatar", { name: path(A, "avatar", "png"), owner: B }),
  );
  await denied(() =>
    put(A, "avatar", { name: path(A, "avatar", "png"), owner: null }),
  );
  await denied(
    () => put(A, "avatar", { name: null }),
    /null|constraint|row-level security/i,
  );
  await denied(() => put(D, "avatar"));
  await denied(() => put(E, "avatar"));
  await denied(() =>
    actor(
      null,
      () =>
        db.query(
          "insert into storage.objects(bucket_id,name,owner_id)values($1,$2,$3)",
          [BUCKET, path(A, "avatar", "png"), A],
        ),
      "anon",
    ),
  );
  const unrelated = await put(A, "avatar", {
    bucket: "unrelated-public",
    name: "legacy-policy-permitted.txt",
  });
  ok(
    unrelated.rows.length === 1,
    "existing unrelated-bucket insert remains permitted by its legacy policy",
  );
  ok(
    (
      await actor(A, () =>
        db.query(
          "update storage.objects set metadata='{}' where bucket_id='unrelated-public' and name='legacy-policy-permitted.txt' returning id",
        ),
      )
    ).rows.length === 1,
    "existing unrelated-bucket update remains permitted",
  );
  ok(
    (
      await actor(A, () =>
        db.query(
          "delete from storage.objects where bucket_id='unrelated-public' and name='legacy-policy-permitted.txt' returning id",
        ),
      )
    ).rows.length === 1,
    "existing unrelated-bucket delete remains permitted",
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id)values($1,$2,$3),($1,$4,null),($1,$5,$6)",
    [
      BUCKET,
      path(A, "avatar", "png"),
      B,
      path(A, "avatar", "jpg"),
      "not-a-valid-owner/avatar/not-a-uuid.webp",
      A,
    ],
  );
  ok(
    (await visible(A, path(A, "avatar", "png"))) === 0,
    "owner/path disagreement denies even the path owner",
  );
  ok(
    (await visible(B, path(A, "avatar", "png"))) === 0,
    "owner/path disagreement denies the forged owner",
  );
  ok(
    (await visible(A, path(A, "avatar", "jpg"))) === 0,
    "missing stored ownership cannot expose a legacy object",
  );
  ok(
    (await visible(A, "not-a-valid-owner/avatar/not-a-uuid.webp")) === 0,
    "invalid stored UUID path safely denies without cast error",
  );
  await db.query(
    "delete from storage.objects where bucket_id=$1 and name=any($2::text[])",
    [
      BUCKET,
      [
        path(A, "avatar", "png"),
        path(A, "avatar", "jpg"),
        "not-a-valid-owner/avatar/not-a-uuid.webp",
      ],
    ],
  );

  ok(
    (
      await actor(A, () =>
        db.query(
          "update storage.objects set metadata='{\"verified\":true}' where bucket_id=$1 and name=$2 returning id",
          [BUCKET, path(A, "background")],
        ),
      )
    ).rows.length === 1,
    "owner updates own object",
  );
  ok(
    (
      await actor(A, () =>
        db.query(
          "update storage.objects set metadata='{\"forged\":true}' where bucket_id=$1 and name=$2 returning id",
          [BUCKET, path(B, "avatar")],
        ),
      )
    ).rows.length === 0,
    "colleague read does not allow update",
  );
  await denied(() =>
    actor(A, () =>
      db.query(
        "update storage.objects set name=$1 where bucket_id=$2 and name=$3",
        [path(B, "background", "png"), BUCKET, path(A, "background")],
      ),
    ),
  );
  await denied(() =>
    actor(A, () =>
      db.query(
        "update storage.objects set owner_id=$1 where bucket_id=$2 and name=$3",
        [B, BUCKET, path(A, "background")],
      ),
    ),
  );
  await denied(() =>
    actor(A, () =>
      db.query(
        "update storage.objects set owner_id=null where bucket_id=$1 and name=$2",
        [BUCKET, path(A, "background")],
      ),
    ),
  );
  ok(
    (
      await actor(A, () =>
        db.query(
          "delete from storage.objects where bucket_id=$1 and name=$2 returning id",
          [BUCKET, path(B, "avatar")],
        ),
      )
    ).rows.length === 0,
    "colleague cannot delete another avatar",
  );
  ok(
    (
      await actor(A, () =>
        db.query(
          "delete from storage.objects where bucket_id=$1 and name=$2 returning id",
          [BUCKET, path(A, "background")],
        ),
      )
    ).rows.length === 1,
    "owner deletes own background",
  );
  await put(A, "background");

  await db.query(
    "update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('avatar_path',$2::text) where id=$1",
    [A, path(A, "avatar")],
  );
  await db.query(
    "update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('avatar_path',$2::text) where id=$1",
    [B, path(A, "background")],
  );
  await db.query(
    "update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('avatar_path',$2::text) where id=$1",
    [C, path(C, "avatar")],
  );
  await db.query(
    "update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('avatar_path',$2::text) where id=$1",
    [F, path(F, "avatar", "svg")],
  );
  await db.query(
    'update auth.users set raw_user_meta_data=raw_user_meta_data||\'{"full_name":"   "}\'::jsonb where id=$1',
    [F],
  );
  const dir = await directory(A);
  assert.deepEqual(dir.map((item) => item.userId).sort(), [A, B, F].sort());
  checks++;
  ok(
    dir.find((item) => item.userId === A).avatarPath === path(A, "avatar"),
    "directory exposes own valid avatar path",
  );
  ok(
    dir.find((item) => item.userId === B).avatarPath === null,
    "directory rejects a forged background/other-owner path",
  );
  ok(
    dir.find((item) => item.userId === F).avatarPath === null,
    "directory rejects SVG avatar metadata",
  );
  ok(
    dir.find((item) => item.userId === F).displayName === "Colaborador",
    "missing name does not leak any part of a private email",
  );
  ok(
    dir.every(
      (item) =>
        Object.keys(item).sort().join(",") === "avatarPath,displayName,userId",
    ),
    "directory excludes private profile fields and preferences",
  );
  await denied(() => directory(D));
  await denied(() => directory(E));
  await denied(
    () =>
      actor(
        null,
        () => db.query("select public.crm_profile_directory()"),
        "anon",
      ),
    /permission denied/i,
  );

  await db.query(
    "update public.crm_members set active=false where user_id=$1",
    [A],
  );
  ok(
    (await visible(A, path(A, "avatar"))) === 0,
    "suspension prevents reading own media",
  );
  ok(
    (await visible(B, path(A, "avatar"))) === 0,
    "new access to a suspended colleague's avatar is blocked",
  );
  await db.query("update public.crm_members set active=true where user_id=$1", [
    A,
  ]);

  await db.exec(
    "drop policy legacy_broad_all on storage.objects; drop policy legacy_broad_read on storage.objects",
  );
  await put(A, "avatar", { name: path(A, "avatar", "jpeg") });
  ok(
    (await visible(A, path(A, "avatar", "jpeg"))) === 1,
    "new policies grant owner access without any legacy permissive grant",
  );
  ok(
    (
      await actor(A, () =>
        db.query(
          "update storage.objects set metadata='{}' where bucket_id=$1 and name=$2 returning id",
          [BUCKET, path(A, "avatar", "jpeg")],
        ),
      )
    ).rows.length === 1,
    "new policies grant own object updates",
  );
  ok(
    (
      await actor(A, () =>
        db.query(
          "delete from storage.objects where bucket_id=$1 and name=$2 returning id",
          [BUCKET, path(A, "avatar", "jpeg")],
        ),
      )
    ).rows.length === 1,
    "new policies grant own object deletion",
  );
  await db.exec(
    "create policy legacy_broad_all on storage.objects for all to authenticated using(true) with check(true); create policy legacy_broad_read on storage.objects for select to public using(true)",
  );

  const before = await row("select count(*)::int as n from public.crm_members");
  const renamed = await actor(
    B,
    async () =>
      (
        await row("select public.crm_set_workspace_name($1) as result", [
          "  Equipe personalizada  ",
        ])
      ).result,
  );
  assert.deepEqual(renamed, {
    workspace: { id: TEAM, name: "Equipe personalizada" },
  });
  checks++;
  ok(
    (await row("select name from public.crm_teams where id=$1", [OTHER]))
      .name === "Other team",
    "rename does not affect another organization",
  );
  ok(
    (await row("select count(*)::int as n from public.crm_members")).n ===
      before.n,
    "rename preserves memberships",
  );
  await denied(() =>
    actor(A, () => db.query("select public.crm_set_workspace_name('Denied')")),
  );
  await denied(() =>
    actor(C, () => db.query("select public.crm_set_workspace_name('Denied')")),
  );
  await denied(() =>
    actor(D, () => db.query("select public.crm_set_workspace_name('Denied')")),
  );
  await denied(() =>
    actor(E, () => db.query("select public.crm_set_workspace_name('Denied')")),
  );
  await denied(
    () =>
      actor(B, () => db.query("select public.crm_set_workspace_name('   ')")),
    /nome|name|inválido|invalid/i,
  );
  await denied(
    () =>
      actor(B, () =>
        db.query("select public.crm_set_workspace_name($1)", ["x".repeat(121)]),
      ),
    /nome|name|inválido|invalid/i,
  );
  await denied(
    () =>
      actor(B, () => db.query("select public.crm_set_workspace_name(null)")),
    /nome|name|inválido|invalid/i,
  );
  await denied(
    () =>
      actor(A, () =>
        db.query("update public.crm_teams set name='Bypass' where id=$1", [
          TEAM,
        ]),
      ),
    /permission denied/i,
  );

  const count = (
    await row(
      "select count(*)::int as n from storage.objects where bucket_id=$1",
      [BUCKET],
    )
  ).n;
  await db.exec(migration);
  ok(
    (
      await row(
        "select count(*)::int as n from storage.objects where bucket_id=$1",
        [BUCKET],
      )
    ).n === count,
    "reapplying migration preserves personal images",
  );
  ok(
    (await row("select name from public.crm_teams where id=$1", [TEAM]))
      .name === "Equipe personalizada",
    "reapplying migration preserves organization name",
  );
  ok(
    (await row("select * from storage.buckets where id='unrelated-public'"))
      .public === true,
    "reapplying preserves unrelated bucket",
  );
  ok(
    (
      await row(
        "select count(*)::int as n from pg_policies where schemaname='storage' and tablename='objects' and policyname in('legacy_broad_all','legacy_broad_read')",
      )
    ).n === 2,
    "reapplying preserves unrelated legacy policies",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks,
      engine: "PostgreSQL/PGlite",
      limitations:
        "Supabase Auth and Storage tables/roles are locally emulated; binary upload/storage service behavior is not tested here.",
    }),
  );
} finally {
  await db.close();
}
