import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { createSupabaseHandler } from "../supabase-handler.mjs";

async function running(t, app) {
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, method = "GET", body, token) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, call };
}

async function local(t) {
  const directory = await mkdtemp(join(tmpdir(), "vox-collaboration-"));
  const dbPath = join(directory, "crm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { ...(await running(t, createApp({ dbPath }))), dbPath };
}

test("local team chat has real message CRUD, tombstones, pagination and persistence without fake colleagues", async (t) => {
  const { app, call, dbPath } = await local(t);
  const listed = await call("/api/chat/conversations");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.conversations.length, 1);
  assert.equal(listed.body.conversations[0].kind, "team");
  assert.equal(listed.body.totalUnread, 0);
  const id = listed.body.conversations[0].id;
  const first = await call(`/api/chat/conversations/${id}/messages`, "POST", {
    body: "Primeira mensagem",
    senderId: "forged",
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.senderId, "local");
  assert.equal(first.body.senderName, "Você (local)");
  const second = await call(`/api/chat/conversations/${id}/messages`, "POST", {
    body: "Segunda mensagem",
  });
  assert.equal(second.status, 201);
  const one = await call(`/api/chat/conversations/${id}/messages?limit=1`);
  assert.equal(one.body.items.length, 1);
  assert.equal(typeof one.body.nextCursor, "string");
  const two = await call(
    `/api/chat/conversations/${id}/messages?limit=1&before=${one.body.nextCursor}`,
  );
  assert.equal(two.body.nextCursor, null);
  assert.equal(new Set([one.body.items[0].id, two.body.items[0].id]).size, 2);
  const edited = await call(`/api/chat/messages/${first.body.id}`, "PATCH", {
    body: "Texto corrigido",
  });
  assert.equal(edited.body.body, "Texto corrigido");
  assert.ok(edited.body.editedAt);
  assert.deepEqual(
    (await call(`/api/chat/conversations/${id}/read`, "POST")).body,
    { ok: true },
  );
  assert.equal(
    (
      await call("/api/chat/conversations", "POST", {
        peerId: "11111111-1111-4111-8111-111111111111",
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(`/api/chat/messages/${second.body.id}`, "DELETE")).status,
    200,
  );
  const history = (await call(`/api/chat/conversations/${id}/messages`)).body
    .items;
  assert.equal(history.find((item) => item.id === second.body.id).body, "");
  assert.ok(history.find((item) => item.id === second.body.id).deletedAt);
  await app.close();
  const reopened = await running(t, createApp({ dbPath }));
  const persisted = await reopened.call(
    `/api/chat/conversations/${id}/messages`,
  );
  assert.equal(persisted.body.items.length, 2);
  assert.equal(
    persisted.body.items.find((item) => item.id === first.body.id).body,
    "Texto corrigido",
  );
});

test("local feed persists posts, comments, reaction switches and pinned pagination", async (t) => {
  const { app, call, dbPath } = await local(t);
  const first = await call("/api/feed/posts", "POST", {
    body: "Comunicado da empresa",
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.authorId, "local");
  const post = first.body.id;
  const comment = await call(`/api/feed/posts/${post}/comments`, "POST", {
    body: "Comentário da equipe",
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.authorName, "Você (local)");
  const edited = await call(`/api/feed/comments/${comment.body.id}`, "PATCH", {
    body: "Comentário editado",
  });
  assert.equal(edited.body.body, "Comentário editado");
  const liked = await call(`/api/feed/posts/${post}/reactions`, "POST", {
    reaction: "like",
  });
  assert.equal(liked.body.reactions.like, 1);
  assert.equal(liked.body.commentCount, 1);
  const switched = await call(`/api/feed/posts/${post}/reactions`, "POST", {
    reaction: "heart",
  });
  assert.equal(switched.body.reactions.like, 0);
  assert.equal(switched.body.reactions.heart, 1);
  const removed = await call(`/api/feed/posts/${post}/reactions`, "POST", {
    reaction: null,
  });
  assert.equal(removed.body.myReaction, null);
  await call(`/api/feed/posts/${post}`, "PATCH", {
    body: "Comunicado atualizado",
  });
  await call("/api/feed/posts", "POST", { body: "Publicação mais nova" });
  await call(`/api/feed/posts/${post}/pin`, "POST", { pinned: true });
  const page = await call("/api/feed/posts?limit=1");
  assert.equal(page.body.items[0].id, post);
  assert.equal(page.body.items[0].pinned, true);
  const next = await call(
    `/api/feed/posts?limit=1&before=${page.body.nextCursor}`,
  );
  assert.equal(next.body.items.length, 1);
  assert.notEqual(next.body.items[0].id, post);
  assert.equal(next.body.nextCursor, null);
  await app.close();
  const reopened = await running(t, createApp({ dbPath }));
  assert.equal(
    (await reopened.call("/api/feed/posts")).body.items[0].body,
    "Comunicado atualizado",
  );
  assert.equal(
    (await reopened.call(`/api/feed/posts/${post}/comments`)).body.items[0]
      .body,
    "Comentário editado",
  );
  await reopened.call(`/api/feed/comments/${comment.body.id}`, "DELETE");
  assert.equal(
    (await reopened.call(`/api/feed/posts/${post}/comments`)).body.items.length,
    0,
  );
  await reopened.call(`/api/feed/posts/${post}`, "DELETE");
  assert.equal(
    (await reopened.call("/api/feed/posts")).body.items.some(
      (item) => item.id === post,
    ),
    false,
  );
  assert.equal(
    (
      await reopened.call(`/api/feed/posts/${post}/comments`, "POST", {
        body: "Não deve criar",
      })
    ).status,
    404,
  );
});

test("collaboration input validation rejects malformed cursors, IDs, text and methods before mutation", async (t) => {
  const { call } = await local(t);
  const team = (await call("/api/chat/conversations")).body.conversations[0].id;
  for (const [path, method, body] of [
    ["/api/chat/conversations", "POST", { peerId: "not-uuid" }],
    [`/api/chat/conversations/${team}/messages`, "POST", { body: " \n " }],
    [
      `/api/chat/conversations/${team}/messages`,
      "POST",
      { body: "a".repeat(4001) },
    ],
    ["/api/feed/posts", "POST", { body: 1 }],
    ["/api/feed/posts", "POST", { body: "a".repeat(8001) }],
    ["/api/feed/posts?limit=0", "GET"],
    ["/api/feed/posts?limit=51", "GET"],
    ["/api/feed/posts?before=notjson", "GET"],
    ["/api/feed/posts?before=x&before=y", "GET"],
    ["/api/chat/messages/not-uuid", "DELETE"],
  ])
    assert.equal((await call(path, method, body)).status, 400, path);
  const badDate = Buffer.from(
    JSON.stringify({
      id: team,
      createdAt: "2026-02-31T00:00:00Z",
      pinned: true,
    }),
  ).toString("base64url");
  assert.equal((await call(`/api/feed/posts?before=${badDate}`)).status, 400);
  assert.equal(
    (await call("/api/feed/posts", "PUT", { body: "Wrong method" })).status,
    405,
  );
  assert.equal((await call("/api/feed/unknown")).status, 404);
  assert.equal((await call("/api/feed/posts")).body.items.length, 0);
});

const userId = "11111111-1111-4111-8111-111111111111";
const peerId = "22222222-2222-4222-8222-222222222222";
const teamId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "534341de-9a86-4d96-b7f8-57fd96be6e3a";
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};
const at = "2026-10-26T12:00:00.123456+00:00";
const reply = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function remote() {
  const calls = [];
  let role = "user";
  let rpcFailure = null;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    assert.equal(headers.get("apikey"), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(headers.get("authorization"), "Bearer member-token");
    const args = options.body ? JSON.parse(options.body) : {};
    calls.push({ path: url.pathname, args });
    if (url.pathname === "/auth/v1/user") return reply({ id: userId });
    if (url.pathname.endsWith("/crm_access"))
      return reply({
        storage: "supabase",
        userId,
        workspaceId: role ? workspaceId : null,
        workspaceName: "Equipe",
        role,
        permissions: Object.fromEntries(
          ["companies", "contacts", "deals", "tasks"].map((name) => [
            name,
            {
              read: "none",
              create: false,
              update: "none",
              delete: "none",
              export: false,
            },
          ]),
        ),
        members: [],
        profiles: {},
      });
    if (rpcFailure)
      return reply({ code: "42501", message: "private provider detail" }, 403);
    const message = {
      id: peerId,
      conversationId: teamId,
      senderId: userId,
      senderName: "Colaborador",
      body: args.p_body || "Mensagem",
      createdAt: at,
      editedAt: null,
      deletedAt: null,
    };
    if (url.pathname.endsWith("/crm_chat_list"))
      return reply({
        conversations: [
          {
            id: teamId,
            kind: "team",
            title: "Equipe",
            peerId: null,
            lastMessage: null,
            lastMessageAt: null,
            unreadCount: 2,
          },
        ],
        totalUnread: 2,
      });
    if (url.pathname.endsWith("/crm_chat_open"))
      return reply({
        id: teamId,
        kind: "direct",
        title: "Colega",
        peerId,
        lastMessage: null,
        lastMessageAt: null,
        unreadCount: 0,
      });
    if (url.pathname.endsWith("/crm_chat_history"))
      return reply(
        args.p_before_id ? [] : [message, { ...message, id: userId }],
      );
    if (
      url.pathname.endsWith("/crm_chat_send") ||
      url.pathname.endsWith("/crm_chat_edit")
    )
      return reply(message);
    if (
      url.pathname.endsWith("/crm_chat_mark_read") ||
      url.pathname.endsWith("/crm_chat_delete")
    )
      return reply({ ok: true });
    const post = {
      id: peerId,
      authorId: userId,
      authorName: "Colaborador",
      body: args.p_body || "Publicação",
      createdAt: at,
      editedAt: null,
      deletedAt: null,
      pinned: false,
      commentCount: 0,
      reactions: { like: 0, celebrate: 0, heart: 0 },
      myReaction: null,
    };
    if (url.pathname.endsWith("/crm_feed_list"))
      return reply(args.p_before_id ? [] : [post, { ...post, id: userId }]);
    if (/\/crm_feed_(create|edit|pin|react)$/.test(url.pathname))
      return reply(post);
    if (url.pathname.endsWith("/crm_feed_comments")) return reply([]);
    if (/\/crm_feed_comment_(create|edit)$/.test(url.pathname))
      return reply({
        id: peerId,
        postId: teamId,
        authorId: userId,
        authorName: "Colaborador",
        body: args.p_body,
        createdAt: at,
        editedAt: null,
        deletedAt: null,
      });
    if (/\/crm_feed_(delete|comment_delete)$/.test(url.pathname))
      return reply({ ok: true });
    throw new Error("Unexpected remote endpoint " + url.pathname);
  };
  return {
    calls,
    fetchImpl,
    role: (value) => {
      role = value;
    },
    failure: (value) => {
      rpcFailure = value;
    },
  };
}

async function cloud(t) {
  const service = remote();
  const server = createServer(
    createSupabaseHandler({ env, fetchImpl: service.fetchImpl }),
  );
  return {
    ...(await running(t, {
      server,
      close: () => new Promise((resolve) => server.close(resolve)),
    })),
    service,
  };
}

test("cloud collaboration uses the verified member and canonical RPC arguments, with microsecond-safe composite cursors", async (t) => {
  const { call, service } = await cloud(t);
  const request = (path, method, body) =>
    call(path, method, body, "member-token");
  assert.equal((await request("/api/chat/conversations")).body.totalUnread, 2);
  assert.equal(
    (await request("/api/chat/conversations", "POST", { peerId })).status,
    201,
  );
  const sent = await request(
    `/api/chat/conversations/${teamId}/messages`,
    "POST",
    { body: " Olá equipe ", senderId: peerId, workspaceId: peerId },
  );
  assert.equal(sent.status, 201);
  assert.deepEqual(service.calls.at(-1).args, {
    p_conversation_id: teamId,
    p_body: "Olá equipe",
  });
  const first = await request(
    `/api/chat/conversations/${teamId}/messages?limit=1`,
  );
  assert.equal(first.body.items.length, 1);
  const cursor = JSON.parse(Buffer.from(first.body.nextCursor, "base64url"));
  assert.equal(cursor.createdAt, at);
  assert.equal(cursor.id, peerId);
  await request(
    `/api/chat/conversations/${teamId}/messages?limit=1&before=${first.body.nextCursor}`,
  );
  assert.deepEqual(service.calls.at(-1).args, {
    p_conversation_id: teamId,
    p_before_created_at: at,
    p_before_id: peerId,
    p_limit: 2,
  });
  const feed = await request("/api/feed/posts?limit=1");
  assert.equal(
    JSON.parse(Buffer.from(feed.body.nextCursor, "base64url")).pinned,
    false,
  );
  await request(`/api/feed/posts?limit=1&before=${feed.body.nextCursor}`);
  assert.equal(service.calls.at(-1).args.p_before_pinned, false);
  assert.equal(
    (
      await request(`/api/feed/posts/${teamId}/comments`, "POST", {
        body: "Comentário",
      })
    ).body.authorName,
    "Colaborador",
  );
  assert.equal(
    (
      await request(`/api/feed/posts/${teamId}/reactions`, "POST", {
        reaction: null,
      })
    ).status,
    200,
  );
  assert.equal(service.calls.at(-1).args.p_reaction, null);
});

test("cloud collaboration denies anonymous/pending access, keeps DM privacy at the SQL boundary and restricts pinning", async (t) => {
  const { call, service } = await cloud(t);
  assert.equal((await call("/api/chat/conversations")).status, 401);
  assert.equal(service.calls.length, 0);
  service.role(null);
  assert.equal(
    (await call("/api/feed/posts", "GET", undefined, "member-token")).status,
    403,
  );
  assert.equal(
    service.calls.some((item) => item.path.endsWith("/crm_feed_list")),
    false,
  );
  service.role("user");
  assert.equal(
    (
      await call(
        `/api/feed/posts/${teamId}/pin`,
        "POST",
        { pinned: true },
        "member-token",
      )
    ).status,
    403,
  );
  assert.equal(
    service.calls.some((item) => item.path.endsWith("/crm_feed_pin")),
    false,
  );
  service.failure(true);
  const privateConversation = await call(
    `/api/chat/conversations/${teamId}/messages`,
    "GET",
    undefined,
    "member-token",
  );
  assert.equal(privateConversation.status, 403);
  assert.equal(
    JSON.stringify(privateConversation.body).includes(
      "private provider detail",
    ),
    false,
  );
  service.failure(null);
  service.role("admin");
  assert.equal(
    (
      await call(
        `/api/feed/posts/${teamId}/pin`,
        "POST",
        { pinned: true },
        "member-token",
      )
    ).status,
    200,
  );
  assert.equal(service.calls.at(-1).args.p_pinned, true);
});
