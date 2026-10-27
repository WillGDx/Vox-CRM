import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../server.mjs";
import { handleCopilotRequest } from "../copilot-handler.mjs";
import { HttpError, parsePath, sendJson, localAccess } from "../domain.mjs";
import { createSupabaseHandler } from "../supabase-handler.mjs";

async function fixture(t) {
  const app = createApp({ dbPath: ":memory:" });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (path, method = "GET", body, token) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { api };
}

test("cloud suite conflicts preserve HTTP409 for the application SQLSTATE without retry semantics", async (t) => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  const access = {
    ...localAccess(),
    storage: "supabase",
    userId,
    workspaceId,
    members: [{ userId, role: "admin", active: true, displayName: "Fixture" }],
  };
  for (const upstreamStatus of [409, 500]) {
    let writes = 0;
    const handler = createSupabaseHandler({
      env: {
        SUPABASE_URL: "https://fixture.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
      },
      fetchImpl: async (input) => {
        const path = new URL(input).pathname;
        if (path === "/auth/v1/user") return Response.json({ id: userId });
        if (path === "/rest/v1/rpc/crm_access") return Response.json(access);
        if (path === "/rest/v1/rpc/crm_suite_save") {
          writes++;
          return Response.json(
            { code: "PT409", message: "Revision stale" },
            { status: upstreamStatus },
          );
        }
        assert.fail("Unexpected upstream route");
      },
    });
    const server = createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/suite/quotes/33333333-3333-4333-8333-333333333333`,
        {
          method: "PATCH",
          headers: {
            Authorization: "Bearer fixture-session",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ revision: 1, data: { notes: "Stale edit" } }),
        },
      );
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /registro foi alterado/i);
      assert.equal(writes, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
test("native customer webchat reaches the actual operator inbox and preserves private visitor sessions", async (t) => {
  const { api } = await fixture(t);
  const channel = await api("/api/suite/channels", "POST", {
    title: "Atendimento do site",
    data: { type: "webchat", enabled: true },
  });
  assert.equal(channel.status, 201);
  const id = channel.body.item.id;
  assert.deepEqual((await api(`/api/public/chat/${id}`)).body, {
    id,
    title: "Atendimento do site",
  });
  const start = await api(`/api/public/chat/${id}`, "POST", {
    name: "Cliente",
    email: "cliente@example.invalid",
    message: "Gostaria de uma proposta",
  });
  assert.equal(start.status, 201);
  assert.equal(start.body.token.length, 43);
  const visitor = start.body;
  let session = await api(
    `/api/public/chat/session/${visitor.id}`,
    "GET",
    undefined,
    visitor.token,
  );
  assert.equal(session.body.messages[0].text, "Gostaria de uma proposta");
  const state = (await api("/api/suite/state")).body.items;
  const conversation = state.find(
    (entry) => entry.id === visitor.conversationId,
  );
  assert.equal(conversation.data.customer, "Cliente");
  const reply = await api("/api/suite/service_messages", "POST", {
    title: "Resposta",
    data: {
      conversationId: conversation.id,
      direction: "outbound",
      text: "Vamos preparar sua proposta.",
    },
  });
  assert.equal(reply.status, 201);
  session = await api(
    `/api/public/chat/session/${visitor.id}`,
    "GET",
    undefined,
    visitor.token,
  );
  assert.equal(
    session.body.messages.at(-1).text,
    "Vamos preparar sua proposta.",
  );
  const second = await api(`/api/public/chat/${id}`, "POST", {
    name: "Outra pessoa",
    email: "",
    message: "Outro atendimento",
  });
  assert.equal(
    (
      await api(
        `/api/public/chat/session/${visitor.id}`,
        "GET",
        undefined,
        second.body.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (await api(`/api/public/chat/session/${visitor.id}`)).status,
    401,
  );
  assert.equal(
    (
      await api(
        `/api/public/chat/session/${visitor.id}`,
        "POST",
        { message: "Mais detalhes" },
        visitor.token,
      )
    ).status,
    200,
  );
  const current = (await api("/api/suite/state")).body.items.find(
    (entry) => entry.id === visitor.conversationId,
  );
  assert.equal(
    (
      await api(`/api/suite/service_conversations/${current.id}`, "PATCH", {
        data: { status: "closed" },
        revision: current.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        `/api/public/chat/session/${visitor.id}`,
        "POST",
        { message: "Mensagem após fechamento" },
        visitor.token,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/api/suite/channels/${id}`, "PATCH", {
        data: { enabled: false },
        revision: channel.body.item.revision,
      })
    ).status,
    200,
  );
  assert.equal((await api(`/api/public/chat/${id}`)).status, 404);
});
test("public webchat rejects injected fields, oversized messages, wrong channel types and floods", async (t) => {
  const { api } = await fixture(t);
  const channel = (
    await api("/api/suite/channels", "POST", {
      title: "Site",
      data: { type: "webchat", enabled: true },
    })
  ).body.item;
  assert.equal(
    (
      await api(`/api/public/chat/${channel.id}`, "POST", {
        name: "Cliente",
        email: "",
        message: "Oi",
        workspaceId: "foreign",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(`/api/public/chat/${channel.id}`, "POST", {
        name: "Cliente",
        email: "",
        message: "x".repeat(4001),
      })
    ).status,
    400,
  );
  const manual = (
    await api("/api/suite/channels", "POST", {
      title: "Manual",
      data: { type: "manual", enabled: true },
    })
  ).body.item;
  assert.equal((await api(`/api/public/chat/${manual.id}`)).status, 404);
  const start = (
    await api(`/api/public/chat/${channel.id}`, "POST", {
      name: "Cliente",
      email: "",
      message: "Oi",
    })
  ).body;
  for (let index = 0; index < 19; index++)
    assert.equal(
      (
        await api(
          `/api/public/chat/session/${start.id}`,
          "POST",
          { message: `Mensagem ${index}` },
          start.token,
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await api(
        `/api/public/chat/session/${start.id}`,
        "POST",
        { message: "Limite" },
        start.token,
      )
    ).status,
    429,
  );
});
async function copilotFixture(t, options = {}) {
  const server = createServer(async (request, response) => {
    try {
      await handleCopilotRequest({
        path: parsePath(request),
        request,
        response,
        access: { role: options.role === undefined ? "user" : options.role },
        env: options.env || {},
        fetchImpl: options.fetchImpl,
      });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, {
        error: error.message,
      });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test("Copilot reports unavailable providers honestly and blocks pending accounts before any AI request", async (t) => {
  const base = await copilotFixture(t);
  const status = await (await fetch(base + "/api/integrations/status")).json();
  assert.equal(status.ai.configured, false);
  assert.equal(status.whatsapp.configured, false);
  assert.equal(status.siteChat.configured, true);
  assert.ok(!JSON.stringify(status).includes("API_KEY"));
  assert.equal(
    (await fetch(base + "/api/copilot", { method: "POST" })).status,
    503,
  );
  const denied = await copilotFixture(t, {
    role: null,
    env: { VOX_AI_API_KEY: "test-only" },
    fetchImpl: () => {
      assert.fail("Pending account must never call AI");
    },
  });
  assert.equal(
    (await fetch(denied + "/api/copilot", { method: "POST" })).status,
    403,
  );
});
test("Copilot accepts the existing sensitive variable name without exposing its value and prioritizes the canonical key", async (t) => {
  for (const env of [
    { KeyChatGPT: "fixture-alias-key" },
    {
      KeyChatGPT: "fixture-alias-key",
      VOX_AI_API_KEY: "fixture-canonical-key",
    },
  ]) {
    const base = await copilotFixture(t, {
      env,
      fetchImpl: async (_url, init) => {
        assert.equal(
          init.headers.Authorization,
          `Bearer ${env.VOX_AI_API_KEY || env.KeyChatGPT}`,
        );
        return Response.json({
          choices: [{ message: { content: "Conexão de teste" } }],
        });
      },
    });
    const status = await (
      await fetch(base + "/api/integrations/status")
    ).json();
    assert.deepEqual(status.ai, { configured: true, provider: "openai" });
    assert.ok(!JSON.stringify(status).includes("fixture-"));
    const response = await fetch(base + "/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "summarize", text: "Conteúdo de teste" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, "Conexão de teste");
  }
});

test("Copilot distinguishes exhausted billing quota from temporary rate limits without exposing provider details", async (t) => {
  for (const [code, status, message] of [
    ["insufficient_quota", 402, /faturamento|créditos/],
    ["rate_limit_exceeded", 429, /limite de uso/],
  ]) {
    const base = await copilotFixture(t, {
      env: { KeyChatGPT: "fixture-alias-key" },
      fetchImpl: async () =>
        Response.json(
          { error: { code, type: code, message: "private-provider-detail" } },
          { status: 429 },
        ),
    });
    const response = await fetch(base + "/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "summarize", text: "Conteúdo de teste" }),
    });
    assert.equal(response.status, status);
    const data = await response.json();
    assert.match(data.error, message);
    assert.ok(!JSON.stringify(data).includes("private-provider-detail"));
  }
});

test("Copilot adapters preserve explicit input, audio payloads and upstream error privacy", async (t) => {
  const calls = [];
  const base = await copilotFixture(t, {
    env: { VOX_AI_API_KEY: "test-only" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json(
        url.endsWith("transcriptions")
          ? { text: "Áudio transcrito" }
          : { choices: [{ message: { content: "Resumo revisável" } }] },
      );
    },
  });
  let response = await fetch(base + "/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "summarize",
      text: "Conversa fornecida pelo usuário.",
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "Resumo revisável");
  assert.equal(
    JSON.parse(calls[0].init.body).messages[1].content,
    "Conversa fornecida pelo usuário.",
  );
  assert.equal(
    (
      await fetch(base + "/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "execute", text: "Excluir dados" }),
      })
    ).status,
    400,
  );
  const wav = Buffer.from("RIFF0000WAVEdata1234");
  response = await fetch(base + "/api/copilot/transcribe", {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "Áudio transcrito");
  assert.ok(calls[1].init.body instanceof FormData);
  assert.equal(
    (
      await fetch(base + "/api/copilot/transcribe", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: "not audio",
      })
    ).status,
    400,
  );
  const broken = await copilotFixture(t, {
    env: { VOX_AI_API_KEY: "test-only" },
    fetchImpl: async () =>
      Response.json({ error: "private-provider-detail" }, { status: 401 }),
  });
  response = await fetch(broken + "/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: "draft", text: "Redigir proposta" }),
  });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes("private-provider-detail"));
});
