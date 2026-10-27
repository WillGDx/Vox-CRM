import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HttpError, parsePath, sendJson } from "../domain.mjs";
import {
  handleExtraRequest,
  validateExtraAction,
} from "../collaboration-extra-handler.mjs";
import { createLocalCollaborationExtra } from "../local-collaboration-extra.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "vox-extra-")),
    dbPath = join(dir, "crm.sqlite"),
    db = new DatabaseSync(dbPath),
    adapter = createLocalCollaborationExtra(db);
  const access = {
    role: "admin",
    userId: "local",
    workspaceId: "local",
    storage: "sqlite",
  };
  const server = createServer(async (request, response) => {
    try {
      const path = parsePath(request);
      if (await adapter.handleUpload({ path, request, response, access }))
        return;
      await handleExtraRequest({
        path,
        request,
        response,
        access,
        database: adapter.database,
        signPath: adapter.signPath,
        removeFile: adapter.removeFile,
      });
    } catch (e) {
      sendJson(response, e instanceof HttpError ? e.status : 500, {
        error: e.message,
      });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + server.address().port + "/api/collaboration-extra";
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const api = async (path, method = "GET", body) => {
    const r = await fetch(base + path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    return { status: r.status, body: await r.json() };
  };
  return { api, base, adapter, db, dbPath };
}
test("private group and poll local flows persist with actual requests and one dev actor", async (t) => {
  const { api, dbPath } = await fixture(t);
  let r = await api("/groups", "POST", { title: "Projeto", memberIds: [] });
  assert.equal(r.status, 200);
  const groupId = r.body.id;
  assert.equal(
    (
      await api("/groups/" + groupId + "/messages", "POST", {
        body: "Conversa persistida",
      })
    ).status,
    200,
  );
  const history = await api("/groups/" + groupId + "/messages");
  assert.equal(history.body.items[0].senderId, "local");
  assert.equal(history.body.items[0].body, "Conversa persistida");
  assert.equal(
    (
      await api("/groups", "POST", {
        title: "Inventar colega",
        memberIds: ["11111111-1111-4111-8111-111111111111"],
      })
    ).status,
    409,
  );
  r = await api("/polls", "POST", {
    question: "Horário?",
    options: ["Manhã", "Tarde"],
  });
  assert.equal(r.status, 200);
  const pollId = r.body.id;
  let state = (await api("/state")).body;
  const choices = state.polls[0].options;
  await api("/polls/" + pollId + "/vote", "POST", { optionId: choices[0].id });
  await api("/polls/" + pollId + "/vote", "POST", { optionId: choices[1].id });
  state = (await api("/state")).body;
  assert.deepEqual(
    state.polls[0].options.map((x) => x.votes),
    [0, 1],
  );
  assert.equal(state.groups[0].memberIds[0], "local");
  assert.equal(
    (await api("/polls/" + pollId + "/close", "POST", {})).status,
    200,
  );
  assert.equal(
    (
      await api("/polls/" + pollId + "/vote", "POST", {
        optionId: choices[0].id,
      })
    ).status,
    409,
  );
  const reopened = new DatabaseSync(dbPath);
  try {
    const second = createLocalCollaborationExtra(reopened);
    const persisted = await second.database(
      "/rest/v1/rpc/crm_collaboration_extra",
      { body: JSON.stringify({ p_action: "state" }) },
    );
    assert.equal(persisted.groups[0].title, "Projeto");
    assert.equal(persisted.polls[0].closed, true);
  } finally {
    reopened.close();
  }
});
test("shared local uploads validate bytes, download as attachment and delete both metadata and BLOB", async (t) => {
  const { api, base, db } = await fixture(t);
  const content = Buffer.from("Plano da equipe\nLinha dois");
  const response = await fetch(base + "/upload?name=plano.txt", {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
  assert.equal(response.status, 200);
  const uploaded = await response.json();
  assert.equal(uploaded.size, content.length);
  const registered = await api("/files/register", "POST", uploaded);
  assert.equal(registered.status, 200);
  const download = await api("/files/" + registered.body.id + "/download");
  assert.equal(download.status, 200);
  const bytes = await fetch(
    base.replace("/api/collaboration-extra", "") + download.body.url,
  );
  assert.equal(bytes.status, 200);
  assert.match(bytes.headers.get("content-disposition"), /^attachment/);
  assert.equal(bytes.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), content);
  assert.equal(
    (await api("/files/" + registered.body.id, "DELETE")).status,
    200,
  );
  assert.equal(
    db.prepare("select count(*) n from collaboration_extra_files").get().n,
    0,
  );
  assert.equal((await api("/state")).body.files.length, 0);
  const invalid = await fetch(base + "/upload?name=x.png", {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: Buffer.from("<svg></svg>"),
  });
  assert.equal(invalid.status, 400);
  const html = await fetch(base + "/upload?name=x.html", {
    method: "PUT",
    headers: { "Content-Type": "text/html" },
    body: Buffer.from("<html>"),
  });
  assert.equal(html.status, 400);
  const binary = await fetch(base + "/upload?name=x.txt", {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: Buffer.from([0, 255]),
  });
  assert.equal(binary.status, 400);
  const missing = await api("/files/register", "POST", {
    name: "fake.txt",
    path: "local/11111111-1111-4111-8111-111111111111.txt",
    mime: "text/plain",
    size: 1,
  });
  assert.equal(missing.status, 400);
});
test("collaboration extra validators reject injected authors, malformed cursors and duplicate choices", () => {
  assert.throws(() =>
    validateExtraAction("groups_create", {
      title: "Group",
      memberIds: [],
      creatorId: "admin",
    }),
  );
  assert.throws(() =>
    validateExtraAction("groups_create", {
      title: "Group",
      memberIds: ["local"],
    }),
  );
  assert.throws(() =>
    validateExtraAction("polls_create", {
      question: "Q",
      options: ["one", " One "],
    }),
  );
  assert.throws(() =>
    validateExtraAction("groups_messages", {
      groupId: "11111111-1111-4111-8111-111111111111",
      before: "2026-01-01T00:00:00Z",
    }),
  );
  assert.throws(() =>
    validateExtraAction("files_register", {
      name: "x.html",
      mime: "text/html",
      size: 1,
      path: "local/11111111-1111-4111-8111-111111111111.html",
    }),
  );
});
test("cloud extra downloads sign only selected organization file and reject foreign origins", async (t) => {
  const access = {
    role: "user",
    userId: "11111111-1111-4111-8111-111111111111",
  };
  const fileId = "22222222-2222-4222-8222-222222222222",
    path =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/33333333-3333-4333-8333-333333333333.pdf";
  let signed = "/object/sign/crm-shared-files/" + path + "?token=fixture",
    remoteCalls = 0;
  const database = async () => ({
    files: [{ id: fileId, name: "plan.pdf", path, authorId: access.userId }],
  });
  const remote = async () => {
    remoteCalls++;
    return Response.json({ signedURL: signed });
  };
  const server = createServer(async (request, response) => {
    try {
      await handleExtraRequest({
        path: parsePath(request),
        request,
        response,
        access,
        database,
        remote,
        supabaseUrl: "https://project.supabase.co",
      });
    } catch (e) {
      sendJson(response, e.status || 500, { error: e.message });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base =
    "http://127.0.0.1:" +
    server.address().port +
    "/api/collaboration-extra/files/";
  let r = await fetch(base + fileId + "/download");
  assert.equal(r.status, 200);
  assert.match(
    (await r.json()).url,
    /^https:\/\/project.supabase.co\/storage\/v1\/object\/sign\/crm-shared-files\//,
  );
  signed = "https://other.example/steal";
  r = await fetch(base + fileId + "/download");
  assert.equal(r.status, 502);
  r = await fetch(base + "44444444-4444-4444-8444-444444444444/download");
  assert.equal(r.status, 404);
  assert.equal(remoteCalls, 2);
  access.role = null;
  r = await fetch(base + fileId + "/download");
  assert.equal(r.status, 403);
  assert.equal(remoteCalls, 2);
});
