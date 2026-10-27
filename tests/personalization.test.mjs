import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createSupabaseHandler } from "../supabase-handler.mjs";
import { createApp } from "../server.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const peerId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const imageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherImage = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const modules = ["companies", "contacts", "deals", "tasks"];
const full = Object.fromEntries(
  modules.map((name) => [
    name,
    { read: "all", create: true, update: "all", delete: "all", export: true },
  ]),
);

async function fixture(t, options = {}) {
  let user = {
    id: userId,
    email: "person@example.invalid",
    user_metadata: {
      full_name: "Pessoa Original",
      retained: { useful: true },
      crm_preferences: { customExisting: "keep" },
    },
  };
  let currentRole = options.role || "user";
  let workspaceName = "Empresa original";
  let directoryRows;
  let signingResponse;
  let authUpdateFailure;
  let beforeAuthUpdate;
  const calls = [];
  const access = () => ({
    storage: "supabase",
    userId,
    workspaceId: workspace,
    workspaceName,
    role: currentRole,
    permissions: full,
    profiles: { admin: full, manager: full, user: full },
    members: [
      {
        userId,
        displayName: user.user_metadata.full_name,
        role: currentRole || "user",
        active: true,
      },
      { userId: peerId, displayName: "Colega", role: "user", active: true },
    ],
  });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method: init.method || "GET", body });
    if (url.pathname === "/auth/v1/user") {
      if (init.method === "PUT") {
        if (authUpdateFailure)
          return Response.json(
            { error: "private-upstream-detail" },
            { status: authUpdateFailure },
          );
        if (beforeAuthUpdate) {
          user = {
            ...user,
            user_metadata: { ...user.user_metadata, ...beforeAuthUpdate },
          };
          beforeAuthUpdate = undefined;
        }
        user = {
          ...user,
          user_metadata: { ...user.user_metadata, ...body.data },
        };
      }
      return Response.json(user);
    }
    if (url.pathname === "/rest/v1/rpc/crm_access")
      return Response.json(access());
    if (url.pathname === "/rest/v1/rpc/crm_profile_directory")
      return Response.json(
        directoryRows || [
          {
            userId,
            displayName: user.user_metadata.full_name,
            avatarPath: user.user_metadata.avatar_path || null,
          },
          {
            userId: peerId,
            displayName: "Colega",
            avatarPath: `${peerId}/avatar/${otherImage}.webp`,
          },
        ],
      );
    if (url.pathname === "/rest/v1/rpc/crm_set_workspace_name") {
      workspaceName = body.p_name;
      return Response.json({
        workspace: { id: workspace, name: workspaceName },
      });
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/"))
      return Response.json(
        signingResponse || {
          signedURL:
            url.pathname.replace("/storage/v1", "") +
            "?token=test-only-image-signature",
        },
      );
    throw new Error("Unexpected mock endpoint: " + url.pathname);
  };
  const server = createServer(
    createSupabaseHandler({
      env: {
        SUPABASE_URL: "https://test-project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_testonly",
      },
      fetchImpl,
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = "GET", body, authenticated = true) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(authenticated ? { Authorization: "Bearer fixture-session" } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  return {
    call,
    calls,
    user: () => user,
    role: (role) => (currentRole = role),
    directory: (rows) => (directoryRows = rows),
    signing: (data) => (signingResponse = data),
    failAuth: (status) => (authUpdateFailure = status),
    concurrentMetadata: (data) => (beforeAuthUpdate = data),
  };
}

test("personal profile is scoped to the verified account and preserves unrelated Auth metadata", async (t) => {
  const app = await fixture(t);
  const initial = await app.call("/api/me");
  assert.equal(initial.status, 200);
  assert.equal(initial.data.userId, userId);
  assert.equal(initial.data.profile.fullName, "Pessoa Original");
  assert.equal(initial.data.preferences.theme, "light");
  assert.equal(initial.data.workspace.canEdit, false);
  const updated = await app.call("/api/me/profile", "PATCH", {
    fullName: "  Novo nome  ",
    jobTitle: "Desenvolvimento",
    department: "Produto",
    phone: "+55 11 1234",
    location: "São Paulo",
    bio: "Linha 1\nLinha 2",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.profile.fullName, "Novo nome");
  assert.equal(updated.data.directory[0].displayName, "Novo nome");
  assert.equal(updated.data.profile.bio, "Linha 1\nLinha 2");
  assert.deepEqual(app.user().user_metadata.retained, { useful: true });
  assert.equal(app.user().user_metadata.crm_preferences.customExisting, "keep");
  assert.equal((await app.call("/api/me")).data.profile.fullName, "Novo nome");
  assert.equal("user_metadata" in updated.data, false);
  const authWrite = app.calls.find((call) => call.method === "PUT");
  assert.deepEqual(Object.keys(authWrite.body.data).sort(), [
    "bio",
    "department",
    "full_name",
    "job_title",
    "location",
    "phone",
  ]);
});

test("saving a profile preserves a theme changed after the authenticated metadata snapshot", async (t) => {
  const app = await fixture(t);
  app.concurrentMetadata({
    crm_preferences: { theme: "dark", accent: "blue" },
    retained: { changedInAnotherTab: true },
  });
  const updated = await app.call("/api/me/profile", "PATCH", {
    fullName: "Nome atual",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.profile.fullName, "Nome atual");
  assert.equal(updated.data.preferences.theme, "dark");
  assert.equal(updated.data.preferences.accent, "blue");
  assert.deepEqual(app.user().user_metadata.retained, {
    changedInAnotherTab: true,
  });
  assert.deepEqual(app.calls.find((call) => call.method === "PUT").body, {
    data: { full_name: "Nome atual" },
  });
  app.concurrentMetadata({ full_name: "Nome de outra aba" });
  const appearance = await app.call("/api/me/preferences", "PATCH", {
    accent: "rose",
  });
  assert.equal(appearance.status, 200);
  assert.equal(appearance.data.profile.fullName, "Nome de outra aba");
  assert.deepEqual(
    Object.keys(
      app.calls.filter((call) => call.method === "PUT").at(-1).body.data,
    ),
    ["crm_preferences"],
  );
});

test("personal appearance persists independently without accepting arbitrary CSS, URLs or foreign media", async (t) => {
  const app = await fixture(t);
  const path = `${userId}/background/${imageId}.webp`;
  const response = await app.call("/api/me/preferences", "PATCH", {
    theme: "dark",
    accent: "purple",
    backgroundPreset: "aurora",
    backgroundPath: path,
    backgroundOpacity: 0.45,
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.preferences.theme, "dark");
  assert.equal(response.data.preferences.accent, "purple");
  assert.equal(response.data.preferences.backgroundPath, path);
  assert.match(
    response.data.preferences.backgroundUrl,
    /^https:\/\/test-project\.supabase\.co\/storage\/v1\/object\/sign\/crm-personal-media\//,
  );
  assert.equal(app.user().user_metadata.crm_preferences.customExisting, "keep");
  const before = structuredClone(app.user());
  for (const body of [
    { theme: "javascript:alert(1)" },
    { accent: "#fff; background:url(evil)" },
    { backgroundPreset: "custom-url" },
    { backgroundOpacity: -1 },
    { backgroundOpacity: 0.71 },
    { backgroundOpacity: "0.2" },
    { backgroundPath: `${peerId}/background/${imageId}.webp` },
    { backgroundPath: `${userId}/avatar/${imageId}.webp` },
    { backgroundPath: "https://foreign.example/image.png" },
    { backgroundPath: "data:image/png;base64,abc" },
    { role: "admin" },
  ])
    assert.equal(
      (await app.call("/api/me/preferences", "PATCH", body)).status,
      400,
    );
  assert.deepEqual(app.user(), before);
  assert.equal(
    (await app.call("/api/me/preferences", "PATCH", { backgroundPath: null }))
      .data.preferences.backgroundPath,
    null,
  );
});

test("only owned avatar paths and authorized colleague avatars receive trusted signed URLs", async (t) => {
  const app = await fixture(t);
  const own = `${userId}/avatar/${imageId}.png`;
  const saved = await app.call("/api/me/profile", "PATCH", { avatarPath: own });
  assert.equal(saved.status, 200);
  assert.match(saved.data.profile.avatarUrl, /crm-personal-media/);
  assert.equal(app.calls.filter((item) => item.path.endsWith(own)).length, 1);
  const before = app.calls.length;
  app.directory([
    { userId, displayName: "Own", avatarPath: own },
    {
      userId: peerId,
      displayName: "Allowed colleague",
      avatarPath: `${peerId}/background/${otherImage}.webp`,
    },
    {
      userId: otherId,
      displayName: "Outside workspace",
      avatarPath: `${otherId}/avatar/${otherImage}.webp`,
    },
  ]);
  const result = await app.call("/api/me");
  assert.equal(result.data.directory.length, 2);
  assert.equal(
    result.data.directory.find((row) => row.userId === peerId).avatarUrl,
    null,
  );
  assert.equal(
    app.calls.slice(before).some((call) => call.path.includes("/background/")),
    false,
  );
  assert.equal(
    app.calls.slice(before).some((call) => call.path.includes(otherId)),
    false,
  );
  app.signing({ signedURL: "https://evil.example/private-image" });
  assert.equal((await app.call("/api/me")).data.profile.avatarUrl, null);
  for (const avatarPath of [
    "../../avatar.png",
    `${peerId}/avatar/${imageId}.png`,
    `${userId}/background/${imageId}.png`,
    `${userId}/avatar/${imageId}.svg`,
  ]) {
    assert.equal(
      (await app.call("/api/me/profile", "PATCH", { avatarPath })).status,
      400,
    );
  }
});

test("profile field validation and access failures never change another account or bypass membership", async (t) => {
  const app = await fixture(t);
  const original = structuredClone(app.user());
  for (const body of [
    { fullName: " " },
    { fullName: "x".repeat(121) },
    { bio: "x".repeat(1001) },
    { phone: 123 },
    { userId: peerId },
    { email: "other@example.invalid" },
    { role: "admin" },
  ]) {
    assert.equal(
      (await app.call("/api/me/profile", "PATCH", body)).status,
      400,
    );
  }
  assert.deepEqual(app.user(), original);
  assert.equal(
    (await app.call("/api/me", "GET", undefined, false)).status,
    401,
  );
  app.role(null);
  assert.equal((await app.call("/api/me")).status, 403);
  app.role("user");
  app.failAuth(401);
  const denied = await app.call("/api/me/profile", "PATCH", {
    fullName: "Not written",
  });
  assert.equal(denied.status, 401);
  assert.equal(
    JSON.stringify(denied).includes("private-upstream-detail"),
    false,
  );
  assert.deepEqual(app.user(), original);
});

test("general workspace naming is admin-only and accepts only the reviewed RPC shape", async (t) => {
  const app = await fixture(t);
  assert.equal(
    (
      await app.call("/api/workspace/settings", "PATCH", {
        name: "Outra empresa",
      })
    ).status,
    403,
  );
  assert.equal(
    app.calls.some((call) => call.path.endsWith("crm_set_workspace_name")),
    false,
  );
  app.role("admin");
  assert.equal((await app.call("/api/me")).data.workspace.canEdit, true);
  for (const body of [
    { name: "" },
    { name: "x".repeat(121) },
    { name: "Allowed", role: "admin" },
  ])
    assert.equal(
      (await app.call("/api/workspace/settings", "PATCH", body)).status,
      400,
    );
  const renamed = await app.call("/api/workspace/settings", "PATCH", {
    name: "  Nova empresa  ",
  });
  assert.deepEqual(renamed, {
    status: 200,
    data: { workspace: { id: workspace, name: "Nova empresa" } },
  });
  assert.equal((await app.call("/api/me")).data.workspace.name, "Nova empresa");
});

test("local me routes share the same metadata validators and preserve updates across requests", async (t) => {
  const app = createApp({ dbPath: ":memory:" });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const before = await (await fetch(base + "/api/me")).json();
  assert.equal(before.profile.fullName, "Usuário local");
  const change = await fetch(base + "/api/me/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme: "dark", accent: "rose" }),
  });
  assert.equal(change.status, 200);
  assert.equal((await change.json()).preferences.theme, "dark");
  const rename = await fetch(base + "/api/workspace/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Empresa local" }),
  });
  assert.equal(rename.status, 200);
  assert.equal(
    (await (await fetch(base + "/api/access")).json()).workspaceName,
    "Empresa local",
  );
  const invalid = await fetch(base + "/api/me/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "admin" }),
  });
  assert.equal(invalid.status, 400);
});
