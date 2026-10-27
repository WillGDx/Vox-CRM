import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vox-crm-test-"));
  const dbPath = join(directory, "crm.sqlite");
  const app = createApp({ dbPath, ...options });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (path, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, directory, dbPath, base, call };
}

test("health and seed expose a complete CRM with linked records", async (t) => {
  const { call } = await fixture(t);
  assert.deepEqual(await call("/api/health"), {
    status: 200,
    body: { status: "ok", database: "sqlite" },
  });
  const { body } = await call("/api/state");
  assert.ok(body.companies.length >= 6);
  assert.ok(body.contacts.length >= 6);
  assert.ok(body.deals.length >= 8);
  assert.ok(body.tasks.length >= 6);
  assert.ok(body.activities.length > 0);
  for (const deal of body.deals) {
    assert.ok(body.companies.some((company) => company.id === deal.companyId));
    assert.ok(body.contacts.some((contact) => contact.id === deal.contactId));
  }
});

test("local access exposes the development administrator and exports actual records", async (t) => {
  const { call, base } = await fixture(t);
  const access = await call("/api/access");
  assert.equal(access.status, 200);
  assert.equal(access.body.storage, "sqlite");
  assert.equal(access.body.role, "admin");
  assert.equal(access.body.permissions.deals.read, "all");
  assert.equal(access.body.permissions.deals.export, true);
  const exported = await fetch(`${base}/api/export/deals`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /text\/csv/);
  const contents = await exported.text();
  assert.match(contents, /Plataforma de vendas/);
  assert.match(contents, /24800/);
  const unsupported = await call("/api/members", "POST", {
    email: "test@example.invalid",
    role: "admin",
  });
  assert.equal(unsupported.status, 409);
});

test("create, edit, move and delete a linked company/contact/deal/task workflow", async (t) => {
  const { call } = await fixture(t);
  const company = await call("/api/companies", "POST", {
    name: "Empresa de teste",
    sector: "Serviços",
  });
  assert.equal(company.status, 201);
  const contact = await call("/api/contacts", "POST", {
    name: "Pessoa de teste",
    email: "teste@example.com",
    companyId: company.body.id,
  });
  assert.equal(contact.status, 201);
  const deal = await call("/api/deals", "POST", {
    title: "Projeto de teste",
    companyId: company.body.id,
    contactId: contact.body.id,
    value: 1234.567,
    dueDate: "2028-02-29",
  });
  assert.equal(deal.status, 201);
  assert.equal(deal.body.value, 1234.57);
  const task = await call("/api/tasks", "POST", {
    title: "Enviar contrato",
    dealId: deal.body.id,
    priority: "high",
  });
  assert.equal(task.status, 201);
  const moved = await call(`/api/deals/${deal.body.id}`, "PUT", {
    stage: "won",
    id: "ignored",
  });
  assert.equal(moved.body.stage, "won");
  assert.equal(moved.body.id, deal.body.id);
  assert.equal(moved.body.companyId, company.body.id);
  assert.equal(
    (await call(`/api/tasks/${task.body.id}`, "PUT", { status: "done" })).body
      .status,
    "done",
  );
  assert.equal(
    (await call(`/api/tasks/${task.body.id}`, "PUT", { status: "pending" }))
      .body.status,
    "pending",
  );
  assert.equal(
    (
      await call(`/api/companies/${company.body.id}`, "PUT", {
        name: "Empresa atualizada",
      })
    ).body.name,
    "Empresa atualizada",
  );
  assert.deepEqual(await call(`/api/companies/${company.body.id}`, "DELETE"), {
    status: 200,
    body: { ok: true },
  });
  let state = (await call("/api/state")).body;
  assert.equal(
    state.contacts.find((item) => item.id === contact.body.id).companyId,
    "",
  );
  assert.equal(
    state.deals.find((item) => item.id === deal.body.id).companyId,
    "",
  );
  assert.equal(
    state.deals.find((item) => item.id === deal.body.id).contactId,
    contact.body.id,
  );
  await call(`/api/contacts/${contact.body.id}`, "DELETE");
  state = (await call("/api/state")).body;
  assert.equal(
    state.deals.find((item) => item.id === deal.body.id).contactId,
    "",
  );
  await call(`/api/deals/${deal.body.id}`, "DELETE");
  state = (await call("/api/state")).body;
  assert.equal(state.tasks.find((item) => item.id === task.body.id).dealId, "");
  assert.ok(
    state.activities.some(
      (item) => item.type === "won" && item.text.includes("Projeto de teste"),
    ),
  );
  assert.ok(
    state.activities.some((item) => item.text.includes("concluiu a tarefa")),
  );
  assert.equal(
    (await call(`/api/tasks/${task.body.id}`, "DELETE")).status,
    200,
  );
});

test("invalid names, fields, amounts, enum values, dates and references are rejected without writes", async (t) => {
  const { call } = await fixture(t);
  const before = (await call("/api/state")).body;
  const cases = [
    ["companies", { name: "   " }],
    ["companies", { name: "Teste", website: "javascript:alert(1)" }],
    ["companies", { name: "Teste", phone: 123 }],
    ["contacts", { name: "Teste", email: "inválido" }],
    ["contacts", { name: "Teste", companyId: "missing" }],
    ["deals", { title: "Teste", value: -1 }],
    ["deals", { title: "Teste", value: "123" }],
    ["deals", { title: "Teste", stage: "__proto__" }],
    ["deals", { title: "Teste", contactId: "missing" }],
    ["deals", { title: "Teste", dueDate: "2027-02-29" }],
    ["deals", { title: "Teste", dueDate: "2026-13-01" }],
    ["tasks", { title: "Teste", priority: "urgent" }],
    ["tasks", { title: "Teste", status: "unknown" }],
    ["tasks", { title: "Teste", dealId: "missing" }],
    ["tasks", { title: "Teste", owner: "" }],
  ];
  for (const [collection, body] of cases) {
    const result = await call(`/api/${collection}`, "POST", body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(typeof result.body.error, "string");
  }
  const after = (await call("/api/state")).body;
  assert.deepEqual(after, before);
});

test("the API preserves data after closing and reopening the SQLite database", async (t) => {
  const { app, dbPath, call } = await fixture(t);
  const created = await call("/api/companies", "POST", {
    name: "Persistência",
  });
  await app.close();
  assert.ok((await readFile(dbPath)).length > 0);
  const reopened = createApp({ dbPath });
  reopened.server.listen(0, "127.0.0.1");
  await once(reopened.server, "listening");
  t.after(() => reopened.close());
  const state = await (
    await fetch(`http://127.0.0.1:${reopened.server.address().port}/api/state`)
  ).json();
  assert.equal(
    state.companies.filter((company) => company.id === created.body.id).length,
    1,
  );
  assert.ok(
    state.activities.some((item) => item.text.includes("Persistência")),
  );
  assert.equal(state.companies.length, 7);
});

test("the API reports malformed JSON, oversized payloads, missing records and unsupported routes", async (t) => {
  const { call, base } = await fixture(t);
  assert.equal((await call("/api/does-not-exist")).status, 404);
  assert.equal((await call("/api/deals/missing", "DELETE")).status, 404);
  assert.equal(
    (await call("/api/deals/missing", "PUT", { title: "Teste" })).status,
    404,
  );
  assert.equal((await call("/api/deals")).status, 405);
  const malformed = await fetch(`${base}/api/deals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal(
    (await fetch(`${base}/api/deals`, { method: "POST", body: "title=Teste" }))
      .status,
    415,
  );
  assert.equal((await call("/api/deals", "POST", [])).status, 400);
  assert.equal(
    (await call("/api/deals", "POST", { title: "x".repeat(70_000) })).status,
    413,
  );
});

test("static assets, SPA fallback, HEAD and traversal protections work independently of Vite", async (t) => {
  const files = await mkdtemp(join(tmpdir(), "vox-crm-dist-"));
  t.after(() => rm(files, { recursive: true, force: true }));
  const dist = join(files, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(
    join(dist, "index.html"),
    "<!doctype html><title>Vox CRM</title>",
  );
  await writeFile(join(dist, "assets", "app.js"), 'console.log("crm")');
  await writeFile(join(files, "private.txt"), "not public");
  await symlink(join(files, "private.txt"), join(dist, "private.txt"));
  const { base } = await fixture(t, { distPath: dist });
  const homepage = await fetch(base);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /Vox CRM/);
  const fallback = await fetch(`${base}/deals`);
  assert.equal(fallback.status, 200);
  assert.match(await fallback.text(), /Vox CRM/);
  const asset = await fetch(`${base}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  assert.match(asset.headers.get("cache-control"), /immutable/);
  const head = await fetch(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/private.txt`)).status, 403);
  const raw = (path) =>
    new Promise((resolveResponse, reject) => {
      const req = request(`${base}/`, { path }, (response) => {
        response.resume();
        response.on("end", () => resolveResponse(response.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
  assert.equal(await raw("/%2e%2e/private.txt"), 403);
  assert.equal(await raw("/assets/%2e%2e/%2e%2e/private.txt"), 403);
  assert.equal(await raw("/%5cprivate.txt"), 403);
  assert.equal(await raw("/%zz"), 400);
});
