import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError, sendJson, parsePath } from "../domain.mjs";
import { createLocalPersonalization } from "../local-personalization.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "vox-personal-local-"));
  const dbPath = join(directory, "crm.sqlite");
  const db = new DatabaseSync(dbPath);
  const adapter = createLocalPersonalization(db);
  const server = createServer(async (request, response) => {
    try {
      if (
        !(await adapter.handleMedia({
          path: parsePath(request),
          request,
          response,
        }))
      )
        sendJson(response, 404, { error: "missing" });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, {
        error: error.message,
      });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { db, dbPath, adapter, base };
}

test("local profile, preferences and workspace survive a fresh adapter without fake staff", async (t) => {
  const { adapter, dbPath } = await fixture(t);
  assert.equal(adapter.user().user_metadata.full_name, "Usuário local");
  assert.equal(adapter.workspaceName(), "Workspace local");
  await adapter.remote("/auth/v1/user", {
    method: "PUT",
    body: JSON.stringify({
      data: {
        full_name: "Pessoa local",
        custom_marker: "preserved",
        crm_preferences: { theme: "dark", accent: "purple" },
      },
    }),
  });
  await adapter.remote("/auth/v1/user", {
    method: "PUT",
    body: JSON.stringify({ data: { bio: "Meu perfil" } }),
  });
  assert.deepEqual(
    await adapter.database("/rest/v1/rpc/crm_set_workspace_name", {
      body: JSON.stringify({ p_name: "Organização local" }),
    }),
    { workspace: { id: "local", name: "Organização local" } },
  );
  const another = new DatabaseSync(dbPath);
  try {
    const reopened = createLocalPersonalization(another);
    assert.equal(reopened.user().user_metadata.full_name, "Pessoa local");
    assert.equal(reopened.user().user_metadata.custom_marker, "preserved");
    assert.equal(reopened.user().user_metadata.crm_preferences.theme, "dark");
    assert.equal(reopened.workspaceName(), "Organização local");
    assert.deepEqual(
      await reopened.database("/rest/v1/rpc/crm_profile_directory"),
      [{ userId: "local", displayName: "Pessoa local", avatarPath: null }],
    );
  } finally {
    another.close();
  }
});

test("local image upload validates signatures and returns durable private image URLs", async (t) => {
  const { adapter, dbPath, base } = await fixture(t);
  const uploaded = await fetch(base + "/api/me/media?kind=avatar", {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: png,
  });
  assert.equal(uploaded.status, 201);
  const { path } = await uploaded.json();
  assert.match(path, /^local\/avatar\/[0-9a-f-]+\.png$/);
  const imageUrl = await adapter.signPath(path);
  const image = await fetch(base + imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.match(image.headers.get("cache-control"), /private/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const head = await fetch(base + imageUrl, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const another = new DatabaseSync(dbPath);
  try {
    assert.equal(
      await createLocalPersonalization(another).signPath(path),
      imageUrl,
    );
  } finally {
    another.close();
  }
  assert.equal(await adapter.signPath(path.replace("local/", "other/")), null);
  assert.equal(
    await adapter.signPath(
      "local/avatar/00000000-0000-0000-0000-000000000000.png",
    ),
    null,
  );
  const removed = await fetch(
    base + "/api/me/media?path=" + encodeURIComponent(path),
    { method: "DELETE" },
  );
  assert.equal(removed.status, 200);
  assert.equal((await fetch(base + imageUrl)).status, 404);
});

test("local media rejects SVG, mismatched content, invalid paths and size overflows without inserts", async (t) => {
  const { db, adapter, base } = await fixture(t);
  const upload = (query, mime, body) =>
    fetch(base + "/api/me/media" + query, {
      method: "PUT",
      headers: { "content-type": mime },
      body,
    });
  assert.equal(
    (await upload("?kind=avatar", "image/svg+xml", "<svg></svg>")).status,
    415,
  );
  assert.equal(
    (await upload("?kind=avatar", "image/png", "not an image")).status,
    415,
  );
  assert.equal(
    (await upload("?kind=avatar", "image/png", Buffer.alloc(0))).status,
    400,
  );
  assert.equal((await upload("?kind=other", "image/png", png)).status, 400);
  assert.equal(
    (await upload("?kind=avatar&kind=background", "image/png", png)).status,
    400,
  );
  assert.equal(
    (
      await upload(
        "?kind=avatar",
        "image/png",
        Buffer.alloc(2 * 1024 * 1024 + 1),
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await upload(
        "?kind=background",
        "image/png",
        Buffer.alloc(8 * 1024 * 1024 + 1),
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await fetch(
        base + "/api/me/media?path=" + encodeURIComponent("local/../secret"),
        { method: "DELETE" },
      )
    ).status,
    400,
  );
  assert.equal(await adapter.signPath("local/../secret"), null);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM personal_media").get().count,
    0,
  );
  await assert.rejects(
    adapter.remote("/auth/v1/user", { method: "PUT", body: "{" }),
    /JSON/,
  );
  await assert.rejects(
    adapter.database("/rest/v1/rpc/crm_set_workspace_name", {
      body: JSON.stringify({ p_name: " " }),
    }),
    /nome/,
  );
});
