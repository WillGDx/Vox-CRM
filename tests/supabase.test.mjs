import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import { createSupabaseHandler } from "../supabase-handler.mjs";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};
const users = {
  "user-a": "11111111-1111-4111-8111-111111111111",
  "user-b": "22222222-2222-4222-8222-222222222222",
  "user-c": "33333333-3333-4333-8333-333333333333",
  "user-pending": "44444444-4444-4444-8444-444444444444",
};
const workspaceId = "534341de-9a86-4d96-b7f8-57fd96be6e3a";
const collections = ["companies", "contacts", "deals", "tasks"];
const fullPermission = {
  read: "all",
  create: true,
  update: "all",
  delete: "all",
  export: true,
};
const ownPermission = {
  read: "own",
  create: true,
  update: "own",
  delete: "none",
  export: false,
};
const deniedPermission = {
  read: "none",
  create: false,
  update: "none",
  delete: "none",
  export: false,
};
const profile = (permission) =>
  Object.fromEntries(
    collections.map((key) => [key, structuredClone(permission)]),
  );
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

function remote() {
  const records = new Map();
  const activities = [];
  const calls = [];
  const profiles = {
    admin: profile(fullPermission),
    manager: profile(fullPermission),
    user: profile(ownPermission),
  };
  const members = [
    {
      userId: users["user-a"],
      email: "admin@example.com",
      displayName: "Admin A",
      role: "admin",
      active: true,
    },
    {
      userId: users["user-b"],
      email: "user@example.com",
      displayName: "User B",
      role: "user",
      active: true,
    },
    {
      userId: users["user-c"],
      email: "manager@example.com",
      displayName: "Manager C",
      role: "manager",
      active: true,
    },
  ];
  let seeded = false;
  let conflict = false;
  let fail = false;
  const keyFor = (collection, id) => `${collection}:${id}`;
  const memberFor = (id) =>
    members.find((member) => member.userId === id && member.active);
  const can = (user, row, action) => {
    const member = memberFor(user);
    if (!member) return false;
    const permission = profiles[member.role][row.collection][action];
    return (
      permission === true ||
      permission === "all" ||
      (permission === "own" && row.owner_id === user)
    );
  };
  const seed = (state) => {
    if (seeded) return;
    seeded = true;
    for (const collection of collections) {
      for (const item of state[collection]) {
        records.set(keyFor(collection, item.id), {
          workspace_id: workspaceId,
          collection,
          id: item.id,
          owner_id: users["user-a"],
          payload: structuredClone(item),
          version: 0,
        });
      }
    }
    for (const activity of state.activities)
      activities.push({
        ...structuredClone(activity),
        created_at: activity.createdAt,
        workspace_id: workspaceId,
        collection: "deals",
        record_owner_id: users["user-a"],
      });
  };
  const access = (user) => {
    const member = memberFor(user);
    return {
      storage: "supabase",
      userId: user,
      workspaceId: member ? workspaceId : null,
      workspaceName: "Vox Workspace",
      role: member?.role ?? null,
      permissions: structuredClone(
        member ? profiles[member.role] : profile(deniedPermission),
      ),
      members: member
        ? members.map((item) =>
            member.role === "admin"
              ? { ...item }
              : {
                  userId: item.userId,
                  displayName: item.displayName,
                  role: item.role,
                  active: item.active,
                },
          )
        : [],
      profiles: member?.role === "admin" ? structuredClone(profiles) : {},
    };
  };
  function log(user, row, previous, deleted = false) {
    const title = row.payload.title || row.payload.name;
    let type =
      row.collection === "deals"
        ? "deal"
        : row.collection === "tasks"
          ? "task"
          : "contact";
    if (
      row.collection === "deals" &&
      previous &&
      row.payload.stage !== previous.payload.stage
    )
      type = row.payload.stage === "won" ? "won" : "stage";
    activities.unshift({
      id: `activity-${activities.length + 1}`,
      workspace_id: workspaceId,
      collection: row.collection,
      record_owner_id: row.owner_id,
      text: `${memberFor(user).displayName} ${deleted ? "excluiu" : "atualizou"} ${title}`,
      type,
      created_at: new Date().toISOString(),
    });
  }
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || "GET";
    const headers = new Headers(options.headers);
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(headers.get("apikey"), env.SUPABASE_PUBLISHABLE_KEY);
    const token = headers.get("authorization")?.replace(/^Bearer /, "");
    const user = users[token];
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({
      path: url.pathname,
      method,
      user,
      search: url.search,
      body: structuredClone(body),
    });
    if (fail) throw new Error("upstream credential=must-not-be-returned");
    if (url.pathname === "/auth/v1/user")
      return user
        ? response({
            id: user,
            email: memberFor(user)?.email ?? "pending@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          })
        : response({ message: "JWT expired" }, 401);
    if (!user) return response({ message: "Not authorized" }, 401);
    if (url.pathname === "/rest/v1/rpc/crm_access") {
      assert.equal(method, "POST");
      assert.ok(body.p_seed);
      if (memberFor(user)) seed(body.p_seed);
      return response(access(user));
    }
    if (url.pathname === "/rest/v1/rpc/crm_set_member") {
      assert.equal(method, "POST");
      if (memberFor(user)?.role !== "admin")
        return response({ message: "Admin only" }, 403);
      const member = members.find((item) => item.email === body.p_email);
      if (!member)
        return response({ message: "Account must register first" }, 400);
      if (
        member.role === "admin" &&
        (body.p_role !== "admin" || body.p_active === false) &&
        members.filter((item) => item.role === "admin" && item.active)
          .length === 1
      )
        return response({ message: "Last admin" }, 409);
      member.role = body.p_role;
      member.active = body.p_active;
      return response(access(user));
    }
    if (url.pathname === "/rest/v1/rpc/crm_save_profile") {
      assert.equal(method, "POST");
      if (memberFor(user)?.role !== "admin")
        return response({ message: "Admin only" }, 403);
      if (!["manager", "user"].includes(body.p_role))
        return response({ message: "Admin profile is fixed" }, 400);
      profiles[body.p_role] = structuredClone(body.p_permissions);
      return response(access(user));
    }
    if (method !== "POST")
      assert.equal(
        url.searchParams.get("workspace_id"),
        `eq.${workspaceId}`,
        "data requests must select only the authorized organization",
      );
    if (url.pathname === "/rest/v1/crm_activities") {
      assert.equal(method, "GET");
      return response(
        activities.filter((item) =>
          can(
            user,
            { collection: item.collection, owner_id: item.record_owner_id },
            "read",
          ),
        ),
      );
    }
    assert.equal(url.pathname, "/rest/v1/crm_records");
    const collection = url.searchParams.get("collection")?.replace(/^eq\./, "");
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    const row =
      id && collection ? records.get(keyFor(collection, id)) : undefined;
    if (method === "GET")
      return response(
        [...records.values()].filter(
          (item) =>
            (!collection || item.collection === collection) &&
            (!id || item.id === id) &&
            can(user, item, "read"),
        ),
      );
    if (method === "POST") {
      const created = Array.isArray(body) ? body[0] : body;
      if (created.workspace_id !== workspaceId || !can(user, created, "create"))
        return response({ message: "RLS" }, 403);
      const member = memberFor(user);
      if (
        created.owner_id !== user &&
        profiles[member.role][created.collection].update !== "all"
      )
        return response({ message: "Cannot assign another owner" }, 403);
      if (!memberFor(created.owner_id))
        return response({ message: "Unknown owner" }, 400);
      const inserted = { ...structuredClone(created), version: 0 };
      records.set(keyFor(inserted.collection, inserted.id), inserted);
      log(user, inserted);
      return response([inserted], 201);
    }
    if (!row || !can(user, row, method === "PATCH" ? "update" : "delete"))
      return response([]);
    if (method === "PATCH") {
      assert.match(headers.get("prefer") || "", /return=representation/);
      const expected = Number(
        url.searchParams.get("version")?.replace(/^eq\./, ""),
      );
      assert.ok(Number.isSafeInteger(expected));
      assert.deepEqual(Object.keys(body).sort(), ["owner_id", "payload"]);
      if (conflict || row.version !== expected) return response([]);
      if (
        body.owner_id !== user &&
        profiles[memberFor(user).role][row.collection].update !== "all"
      )
        return response({ message: "Cannot reassign owner" }, 403);
      const next = {
        ...row,
        ...structuredClone(body),
        version: row.version + 1,
      };
      records.set(keyFor(row.collection, row.id), next);
      log(user, next, row);
      return response([next]);
    }
    assert.equal(method, "DELETE");
    records.delete(keyFor(row.collection, row.id));
    const reference = {
      companies: "companyId",
      contacts: "contactId",
      deals: "dealId",
    }[row.collection];
    if (reference)
      for (const child of records.values())
        if (child.payload[reference] === row.id) {
          child.payload[reference] = "";
          child.version++;
        }
    log(user, row, row, true);
    return response([row]);
  };
  return {
    fetchImpl,
    records,
    activities,
    calls,
    profiles,
    members,
    access,
    setConflict: (value) => {
      conflict = value;
    },
    setFail: (value) => {
      fail = value;
    },
  };
}
async function fixture(t, { database = remote(), environment = env } = {}) {
  const server = createServer(
    createSupabaseHandler({ env: environment, fetchImpl: database.fetchImpl }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, method = "GET", body, token = "user-a") {
    const result = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: result.status,
      body: (result.headers.get("content-type") || "").includes(
        "application/json",
      )
        ? await result.json()
        : await result.text(),
    };
  }
  return { call, database };
}

test("Supabase exposes only publishable configuration and rejects missing or privileged keys", async (t) => {
  const { call, database } = await fixture(t);
  assert.deepEqual(await call("/api/config", "GET", undefined, null), {
    status: 200,
    body: {
      storage: "supabase",
      authRequired: true,
      configured: true,
      url: env.SUPABASE_URL,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    },
  });
  assert.equal(database.calls.length, 0);
  assert.equal(
    (await call("/api/health", "GET", undefined, null)).body.database,
    "supabase",
  );
  for (const environment of [
    {},
    { ...env, SUPABASE_URL: "http://project.supabase.co" },
    { ...env, SUPABASE_PUBLISHABLE_KEY: "sb_secret_never-return-this" },
    {
      ...env,
      SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.test`,
    },
  ]) {
    const denied = await fixture(t, { environment });
    const result = await denied.call("/api/config", "GET", undefined, null);
    assert.equal(result.status, 503);
    assert.equal(typeof result.body.error, "string");
    if (environment.SUPABASE_PUBLISHABLE_KEY) {
      assert.equal(
        JSON.stringify(result.body).includes(
          environment.SUPABASE_PUBLISHABLE_KEY,
        ),
        false,
      );
    }
  }
});

test("Supabase requires a verified session before reading or changing the workspace", async (t) => {
  const { call, database } = await fixture(t);
  assert.equal((await call("/api/state", "GET", undefined, null)).status, 401);
  assert.equal((await call("/api/access", "GET", undefined, null)).status, 401);
  assert.equal(database.calls.length, 0);
  assert.equal(
    (await call("/api/state", "GET", undefined, "expired-token")).status,
    401,
  );
  assert.equal(
    database.calls.filter((entry) => entry.path.startsWith("/rest/v1/")).length,
    0,
  );
  assert.equal(
    (await call("/api/companies", "POST", { name: "Unauthorized" }, null))
      .status,
    401,
  );
  assert.equal(database.records.size, 0);
});

test("authenticated remote CRUD keeps links, activities, ownership and survives new handlers", async (t) => {
  const { call, database } = await fixture(t);
  const initial = await call("/api/state");
  assert.equal(initial.status, 200);
  assert.ok(initial.body.companies.length >= 6);
  const company = await call("/api/companies", "POST", {
    name: "Cloud company",
  });
  assert.equal(company.status, 201);
  const contact = await call("/api/contacts", "POST", {
    name: "Cloud person",
    email: "cloud@example.com",
    companyId: company.body.id,
  });
  assert.equal(contact.status, 201);
  const deal = await call("/api/deals", "POST", {
    title: "Cloud deal",
    value: 1234.56,
    companyId: company.body.id,
    contactId: contact.body.id,
  });
  assert.equal(deal.status, 201);
  const task = await call("/api/tasks", "POST", {
    title: "Cloud task",
    dealId: deal.body.id,
  });
  assert.equal(task.status, 201);
  assert.equal(
    (await call(`/api/deals/${deal.body.id}`, "PUT", { stage: "won" })).body
      .stage,
    "won",
  );
  assert.equal(
    (await call(`/api/tasks/${task.body.id}`, "PUT", { status: "done" })).body
      .status,
    "done",
  );
  assert.equal(
    (await call(`/api/companies/${company.body.id}`, "DELETE")).status,
    200,
  );
  const snapshot = (await call("/api/state")).body;
  assert.equal(
    snapshot.contacts.find((row) => row.id === contact.body.id).companyId,
    "",
  );
  assert.equal(
    snapshot.deals.find((row) => row.id === deal.body.id).companyId,
    "",
  );
  assert.equal(
    snapshot.deals.find((row) => row.id === deal.body.id).contactId,
    contact.body.id,
  );
  assert.ok(
    snapshot.activities.some(
      (item) => item.type === "won" && item.text.includes("Cloud deal"),
    ),
  );
  const other = (await call("/api/state", "GET", undefined, "user-b")).body;
  assert.equal(
    other.deals.some((row) => row.id === deal.body.id),
    false,
  );
  assert.ok(database.records.size > 2);
  const next = await fixture(t, { database });
  const restored = await next.call("/api/state");
  assert.equal(
    restored.body.deals.find((row) => row.id === deal.body.id).stage,
    "won",
  );
  assert.equal(
    restored.body.tasks.find((row) => row.id === task.body.id).status,
    "done",
  );
});

test("remote compare-and-swap conflicts never overwrite another update", async (t) => {
  const { call, database } = await fixture(t);
  await call("/api/state");
  const before = structuredClone([...database.records]);
  database.setConflict(true);
  const failed = await call("/api/companies/company-1", "PUT", {
    name: "Conflicting company",
  });
  assert.equal(failed.status, 409);
  assert.equal(typeof failed.body.error, "string");
  assert.deepEqual([...database.records], before);
});

test("remote validation and upstream failures return useful errors without leaking credentials", async (t) => {
  const { call, database } = await fixture(t);
  await call("/api/state");
  const before = structuredClone([...database.records]);
  assert.equal(
    (await call("/api/deals", "POST", { title: "Invalid", value: -1 })).status,
    400,
  );
  assert.equal(
    (
      await call("/api/deals", "POST", {
        title: "Invalid",
        contactId: "missing",
      })
    ).status,
    400,
  );
  assert.deepEqual([...database.records], before);
  database.setFail(true);
  const failed = await call("/api/state");
  assert.ok([502, 503, 504].includes(failed.status), JSON.stringify(failed));
  assert.doesNotMatch(
    JSON.stringify(failed.body),
    /must-not-be-returned|sb_publishable_test|user-a/,
  );
});

test("Vercel pre-parsed bodies work with an exhausted request stream and retain validation", async () => {
  const database = remote();
  const handler = createSupabaseHandler({ env, fetchImpl: database.fetchImpl });
  async function parsedCall(
    body,
    { contentType = "application/json", parsingError = false } = {},
  ) {
    const request = Readable.from([]);
    for await (const _ of request) {
      /* Vercel consumed the incoming stream. */
    }
    request.url = "/api/index?route=companies";
    request.method = "POST";
    request.headers = {
      authorization: "Bearer user-a",
      ...(contentType === undefined ? {} : { "content-type": contentType }),
    };
    let reads = 0;
    Object.defineProperty(request, "body", {
      get() {
        reads++;
        if (parsingError) throw new Error("Invalid JSON from framework parser");
        return body;
      },
    });
    request[Symbol.asyncIterator] = () => {
      throw new Error("Consumed stream must not be read again");
    };
    let status, payload;
    const response = {
      headersSent: false,
      writeHead(code) {
        status = code;
        this.headersSent = true;
      },
      end(value) {
        payload = JSON.parse(value);
      },
    };
    await handler(request, response);
    assert.ok(reads <= 1, "the framework body getter must be evaluated once");
    return { status, body: payload };
  }
  for (const [label, body] of [
    ["object", { name: "Parsed object" }],
    ["string", JSON.stringify({ name: "Parsed string" })],
    ["buffer", Buffer.from(JSON.stringify({ name: "Parsed buffer" }))],
  ]) {
    const result = await parsedCall(body);
    assert.equal(result.status, 201, label);
    assert.match(result.body.name, /^Parsed /);
  }
  const before = structuredClone([...database.records]);
  for (const [body, options, status] of [
    [[], {}, 400],
    [null, {}, 400],
    [42, {}, 400],
    [new Date(), {}, 400],
    ["{", {}, 400],
    [{ name: "x".repeat(70000) }, {}, 413],
    [JSON.stringify({ name: "é".repeat(40000) }), {}, 413],
    [{ name: "Wrong content type" }, { contentType: "text/plain" }, 415],
    [{ name: "Framework parse failed" }, { parsingError: true }, 400],
  ]) {
    assert.equal((await parsedCall(body, options)).status, status);
  }
  assert.deepEqual(
    [...database.records],
    before,
    "invalid parsed bodies must not write records",
  );
});

test("Supabase normalizes only exact canonical or NEXT_PUBLIC dotenv assignments at its configuration boundary", async (t) => {
  const configurations = [
    env,
    {
      SUPABASE_URL: `SUPABASE_URL=${env.SUPABASE_URL}`,
      SUPABASE_PUBLISHABLE_KEY: `SUPABASE_PUBLISHABLE_KEY=${env.SUPABASE_PUBLISHABLE_KEY}`,
    },
    {
      SUPABASE_URL: `NEXT_PUBLIC_SUPABASE_URL=${env.SUPABASE_URL}`,
      SUPABASE_PUBLISHABLE_KEY: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.SUPABASE_PUBLISHABLE_KEY}`,
    },
  ];
  for (const environment of configurations) {
    const { call, database } = await fixture(t, { environment });
    assert.deepEqual((await call("/api/config")).body, {
      storage: "supabase",
      authRequired: true,
      configured: true,
      url: env.SUPABASE_URL,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    });
    const state = await call("/api/state");
    assert.equal(state.status, 200);
    assert.ok(state.body.companies.length >= 6);
    assert.ok(database.calls.some((entry) => entry.path === "/auth/v1/user"));
  }
  const padded = await fixture(t, {
    environment: {
      ...env,
      SUPABASE_PUBLISHABLE_KEY:
        "SUPABASE_PUBLISHABLE_KEY=sb_publishable_test=preserved==",
    },
  });
  assert.equal(
    (await padded.call("/api/config")).body.publishableKey,
    "sb_publishable_test=preserved==",
    "only the first assignment separator may be removed",
  );
  for (const environment of [
    { ...env, SUPABASE_URL: `WRONG_SUPABASE_URL=${env.SUPABASE_URL}` },
    {
      ...env,
      SUPABASE_URL: `NEXT_PUBLIC_SUPABASE_URL_EXTRA=${env.SUPABASE_URL}`,
    },
    { ...env, SUPABASE_URL: `export SUPABASE_URL=${env.SUPABASE_URL}` },
    {
      ...env,
      SUPABASE_PUBLISHABLE_KEY: `SUPABASE_ANON_KEY=${env.SUPABASE_PUBLISHABLE_KEY}`,
    },
    {
      ...env,
      SUPABASE_PUBLISHABLE_KEY: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_EXTRA=${env.SUPABASE_PUBLISHABLE_KEY}`,
    },
    {
      ...env,
      SUPABASE_PUBLISHABLE_KEY:
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_secret_keep-private",
    },
    { ...env, SUPABASE_URL: "SUPABASE_URL=http://project.supabase.co" },
  ]) {
    const { call, database } = await fixture(t, { environment });
    const result = await call("/api/config");
    assert.equal(result.status, 503);
    const message = JSON.stringify(result.body);
    for (const value of Object.values(environment))
      assert.equal(
        message.includes(value),
        false,
        "configuration failures must not expose their values",
      );
    assert.equal(
      database.calls.length,
      0,
      "invalid configuration must fail before making remote requests",
    );
  }
});

test("pending accounts cannot read CRM data or promote themselves", async (t) => {
  const { call, database } = await fixture(t);
  const access = await call("/api/access", "GET", undefined, "user-pending");
  assert.equal(access.status, 200);
  assert.equal(access.body.role, null);
  assert.equal(access.body.workspaceId, null);
  assert.equal(
    (await call("/api/state", "GET", undefined, "user-pending")).status,
    403,
  );
  assert.equal(
    (await call("/api/companies", "POST", { name: "Denied" }, "user-pending"))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/members",
        "POST",
        { email: "pending@example.com", role: "admin", active: true },
        "user-pending",
      )
    ).status,
    403,
  );
  assert.equal(database.records.size, 0);
  assert.equal(
    database.calls.some((entry) => entry.path.endsWith("/crm_set_member")),
    false,
  );
});

test("ordinary users read and update their own records and cannot forge ownership or administration", async (t) => {
  const { call, database } = await fixture(t);
  await call("/api/state");
  const ordinary = await call("/api/access", "GET", undefined, "user-b");
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.body.role, "user");
  assert.equal(
    ordinary.body.members.some((member) => Object.hasOwn(member, "email")),
    false,
  );
  const initial = await call("/api/state", "GET", undefined, "user-b");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.companies.length, 0);
  const own = await call(
    "/api/companies",
    "POST",
    { name: "Owned by B", owner: "Spoofed administrator" },
    "user-b",
  );
  assert.equal(own.status, 201);
  assert.equal(own.body.ownerId, users["user-b"]);
  assert.equal(own.body.owner, "User B");
  assert.equal(
    (
      await call(
        `/api/companies/${own.body.id}`,
        "PUT",
        { name: "B updated" },
        "user-b",
      )
    ).status,
    200,
  );
  const before = structuredClone([...database.records]);
  assert.equal(
    (
      await call(
        `/api/companies/${own.body.id}`,
        "PUT",
        { ownerId: users["user-a"] },
        "user-b",
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(`/api/companies/${own.body.id}`, "DELETE", undefined, "user-b"))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/members",
        "POST",
        { email: "user@example.com", role: "admin", active: true },
        "user-b",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/profiles/user",
        "PUT",
        { permissions: profile(fullPermission) },
        "user-b",
      )
    ).status,
    403,
  );
  assert.deepEqual([...database.records], before);
  assert.equal(
    database.members.find((member) => member.userId === users["user-b"]).role,
    "user",
  );
  assert.equal(
    database.calls.some(
      (entry) =>
        entry.path.endsWith("/crm_set_member") ||
        entry.path.endsWith("/crm_save_profile"),
    ),
    false,
  );
});

test("module permissions are enforced before writes and restrict edits of another user's records", async (t) => {
  const database = remote();
  database.profiles.user.companies = {
    read: "all",
    create: false,
    update: "own",
    delete: "none",
    export: false,
  };
  database.profiles.user.deals = { ...deniedPermission };
  const { call } = await fixture(t, { database });
  await call("/api/state");
  const list = await call("/api/state", "GET", undefined, "user-b");
  assert.equal(list.status, 200);
  assert.ok(list.body.companies.length > 0);
  assert.equal(list.body.deals.length, 0);
  const before = structuredClone([...database.records]);
  const writesBefore = database.calls.filter(
    (entry) => entry.path === "/rest/v1/crm_records" && entry.method !== "GET",
  ).length;
  assert.equal(
    (
      await call(
        "/api/companies",
        "POST",
        { name: "Forbidden create" },
        "user-b",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/companies/company-1",
        "PUT",
        { name: "Forbidden edit" },
        "user-b",
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/companies/company-1", "DELETE", undefined, "user-b"))
      .status,
    403,
  );
  assert.equal(
    (await call("/api/deals", "POST", { title: "Forbidden module" }, "user-b"))
      .status,
    403,
  );
  assert.equal(
    database.calls.filter(
      (entry) =>
        entry.path === "/rest/v1/crm_records" && entry.method !== "GET",
    ).length,
    writesBefore,
  );
  assert.deepEqual([...database.records], before);
});

test("administrators manage registered members and editable profiles while manager cannot manage access", async (t) => {
  const { call, database } = await fixture(t);
  const access = await call("/api/access");
  assert.equal(access.body.role, "admin");
  assert.ok(access.body.members.every((member) => member.email));
  assert.equal(
    (
      await call("/api/members", "POST", {
        email: "user@example.com",
        role: "manager",
        active: true,
      })
    ).status,
    200,
  );
  assert.equal(
    database.members.find((member) => member.userId === users["user-b"]).role,
    "manager",
  );
  assert.equal(
    (
      await call(
        "/api/members",
        "POST",
        { email: "user@example.com", role: "admin", active: true },
        "user-c",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/profiles/user", "PUT", {
        permissions: profile(fullPermission),
      })
    ).status,
    200,
  );
  assert.equal(database.profiles.user.companies.update, "all");
  for (const permissions of [
    {},
    { companies: { read: "root" } },
    profile({ ...fullPermission, create: "yes" }),
  ]) {
    assert.equal(
      (await call("/api/profiles/user", "PUT", { permissions })).status,
      400,
    );
  }
  assert.equal(
    (
      await call("/api/members", "POST", {
        email: "user@example.com",
        role: "superadmin",
        active: true,
      })
    ).status,
    400,
  );
  assert.ok(
    [400, 403].includes(
      (
        await call("/api/profiles/admin", "PUT", {
          permissions: profile(deniedPermission),
        })
      ).status,
    ),
  );
  assert.equal(
    (
      await call("/api/members", "POST", {
        email: "admin@example.com",
        role: "user",
        active: true,
      })
    ).status,
    409,
  );
  assert.equal(
    database.members.find((member) => member.userId === users["user-a"]).role,
    "admin",
  );
});

test("CSV export checks module permission and escapes spreadsheet formula cells", async (t) => {
  const { call } = await fixture(t);
  await call("/api/state");
  await call("/api/companies", "POST", { name: "=SUM(1;2)" });
  const csv = await call("/api/export/companies");
  assert.equal(csv.status, 200);
  assert.equal(typeof csv.body, "string");
  assert.ok(csv.body.includes("'=SUM(1;2)"));
  assert.equal(
    (await call("/api/export/companies", "GET", undefined, "user-b")).status,
    403,
  );
  assert.equal(
    (await call("/api/export/companies", "GET", undefined, "user-c")).status,
    200,
  );
});
