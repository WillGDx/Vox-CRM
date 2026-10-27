import { HttpError, readBody, sendJson } from "./domain.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reactions = ["like", "celebrate", "heart"];
const validTime = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const date = new Date(value.slice(0, 10) + "T00:00:00Z");
  return (
    date.toISOString().slice(0, 10) === value.slice(0, 10) &&
    Number(value.slice(0, 4)) > 0
  );
};
const nullableTime = (value) => value === null || validTime(value);
const nullableId = (value) =>
  value === null || (typeof value === "string" && uuid.test(value));
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function isCollaborationPath(path) {
  return /^\/api\/(chat|feed)(?:\/|$)/.test(path);
}

function identifier(value) {
  if (typeof value !== "string" || !uuid.test(value))
    throw new HttpError(400, "O identificador informado é inválido.");
  return value;
}

function text(value, maximum) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  ) {
    throw new HttpError(
      400,
      `Escreva um texto entre 1 e ${maximum} caracteres.`,
    );
  }
  return value.trim();
}

function boolean(value) {
  if (typeof value !== "boolean")
    throw new HttpError(400, "Informe uma opção válida.");
  return value;
}

function invalidResponse() {
  throw new HttpError(
    502,
    "O serviço de colaboração retornou uma resposta inválida.",
  );
}

function entity(value, type, local = false) {
  if (
    !value ||
    typeof value !== "object" ||
    !uuid.test(value.id) ||
    typeof value.body !== "string" ||
    !validTime(value.createdAt) ||
    !nullableTime(value.editedAt) ||
    !nullableTime(value.deletedAt)
  )
    invalidResponse();
  if (type === "message") {
    if (
      !uuid.test(value.conversationId) ||
      !(nullableId(value.senderId) || (local && value.senderId === "local")) ||
      typeof value.senderName !== "string"
    )
      invalidResponse();
  } else {
    if (
      !(nullableId(value.authorId) || (local && value.authorId === "local")) ||
      typeof value.authorName !== "string"
    )
      invalidResponse();
    if (type === "comment" && !uuid.test(value.postId)) invalidResponse();
    if (
      type === "post" &&
      (typeof value.pinned !== "boolean" ||
        !count(value.commentCount) ||
        !value.reactions ||
        !reactions.every((name) => count(value.reactions[name])) ||
        !(value.myReaction === null || reactions.includes(value.myReaction)))
    )
      invalidResponse();
  }
  return value;
}

function conversation(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !uuid.test(value.id) ||
    !["team", "direct"].includes(value.kind) ||
    typeof value.title !== "string" ||
    !nullableId(value.peerId) ||
    !(value.lastMessage === null || typeof value.lastMessage === "string") ||
    !nullableTime(value.lastMessageAt) ||
    !count(value.unreadCount)
  )
    invalidResponse();
  return value;
}

function queryValue(request, name) {
  const params = new URL(request.url || "/", "http://internal").searchParams;
  const values = params.getAll(name);
  if (values.length > 1 || Array.isArray(request.query?.[name]))
    throw new HttpError(400, "Os parâmetros de paginação são inválidos.");
  return values[0] ?? request.query?.[name];
}

function pagination(request, fallback, pinned) {
  const requested = queryValue(request, "limit");
  if (
    requested !== undefined &&
    (typeof requested !== "string" || !/^\d{1,2}$/.test(requested))
  )
    throw new HttpError(400, "Informe um limite entre 1 e 50 registros.");
  const limit = requested === undefined ? fallback : Number(requested);
  if (limit < 1 || limit > 50)
    throw new HttpError(400, "Informe um limite entre 1 e 50 registros.");
  const cursor = queryValue(request, "before");
  let position = null;
  if (cursor !== undefined) {
    if (
      typeof cursor !== "string" ||
      cursor.length > 800 ||
      !/^[A-Za-z0-9_-]+$/.test(cursor)
    )
      throw new HttpError(400, "A posição da paginação é inválida.");
    try {
      position = JSON.parse(Buffer.from(cursor, "base64url").toString());
    } catch {
      throw new HttpError(400, "A posição da paginação é inválida.");
    }
    if (
      !position ||
      typeof position !== "object" ||
      !uuid.test(position.id) ||
      !validTime(position.createdAt) ||
      (pinned && typeof position.pinned !== "boolean")
    )
      throw new HttpError(400, "A posição da paginação é inválida.");
  }
  return { limit, position };
}

function page(rows, settings, type, local = false) {
  if (!Array.isArray(rows) || rows.length > settings.limit + 1)
    invalidResponse();
  for (const row of rows) entity(row, type, local);
  const items = rows.slice(0, settings.limit);
  const last = items.at(-1);
  const position = last
    ? {
        createdAt: last.createdAt,
        id: last.id,
        ...(type === "post" ? { pinned: last.pinned } : {}),
      }
    : null;
  return {
    items,
    nextCursor:
      rows.length > settings.limit && position
        ? Buffer.from(JSON.stringify(position)).toString("base64url")
        : null,
  };
}

function positionArgs(settings, pinned = false) {
  return {
    p_before_created_at: settings.position?.createdAt ?? null,
    p_before_id: settings.position?.id ?? null,
    ...(pinned ? { p_before_pinned: settings.position?.pinned ?? null } : {}),
    p_limit: settings.limit + 1,
  };
}

function ok(value) {
  if (!value || value.ok !== true) invalidResponse();
  return { ok: true };
}

export async function handleCollaborationRequest({
  path,
  request,
  response,
  access,
  database,
}) {
  if (!isCollaborationPath(path)) return false;
  if (!access.role)
    throw new HttpError(
      403,
      "Seu acesso está aguardando a liberação de um administrador.",
    );
  const rpc = (name, args = {}) =>
    database(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  const send = (value, status = 200) => {
    sendJson(response, status, value);
    return true;
  };
  const body = async () => readBody(request);
  const checkEntity = (value, type) =>
    entity(value, type, access.storage === "sqlite");
  let match;

  if (path === "/api/chat/conversations") {
    if (request.method === "GET") {
      const value = await rpc("crm_chat_list");
      if (
        !value ||
        !Array.isArray(value.conversations) ||
        !count(value.totalUnread)
      )
        invalidResponse();
      value.conversations.forEach(conversation);
      return send(value);
    }
    if (request.method === "POST") {
      const input = await body();
      const peer = identifier(input.peerId);
      if (peer === access.userId)
        throw new HttpError(400, "Escolha outro colaborador para conversar.");
      return send(
        conversation(await rpc("crm_chat_open", { p_peer_id: peer })),
        201,
      );
    }
  } else if (
    (match = /^\/api\/chat\/conversations\/([^/]+)\/messages$/.exec(path))
  ) {
    const id = identifier(match[1]);
    if (request.method === "GET") {
      const settings = pagination(request, 30, false);
      return send(
        page(
          await rpc("crm_chat_history", {
            p_conversation_id: id,
            ...positionArgs(settings),
          }),
          settings,
          "message",
          access.storage === "sqlite",
        ),
      );
    }
    if (request.method === "POST") {
      const input = await body();
      return send(
        checkEntity(
          await rpc("crm_chat_send", {
            p_conversation_id: id,
            p_body: text(input.body, 4000),
          }),
          "message",
        ),
        201,
      );
    }
  } else if (
    (match = /^\/api\/chat\/conversations\/([^/]+)\/read$/.exec(path))
  ) {
    const id = identifier(match[1]);
    if (request.method === "POST")
      return send(
        ok(await rpc("crm_chat_mark_read", { p_conversation_id: id })),
      );
  } else if ((match = /^\/api\/chat\/messages\/([^/]+)$/.exec(path))) {
    const id = identifier(match[1]);
    if (request.method === "PATCH") {
      const input = await body();
      return send(
        checkEntity(
          await rpc("crm_chat_edit", {
            p_message_id: id,
            p_body: text(input.body, 4000),
          }),
          "message",
        ),
      );
    }
    if (request.method === "DELETE")
      return send(ok(await rpc("crm_chat_delete", { p_message_id: id })));
  } else if (path === "/api/feed/posts") {
    if (request.method === "GET") {
      const settings = pagination(request, 20, true);
      return send(
        page(
          await rpc("crm_feed_list", positionArgs(settings, true)),
          settings,
          "post",
          access.storage === "sqlite",
        ),
      );
    }
    if (request.method === "POST") {
      const input = await body();
      return send(
        checkEntity(
          await rpc("crm_feed_create", { p_body: text(input.body, 8000) }),
          "post",
        ),
        201,
      );
    }
  } else if ((match = /^\/api\/feed\/posts\/([^/]+)\/comments$/.exec(path))) {
    const id = identifier(match[1]);
    if (request.method === "GET") {
      const settings = pagination(request, 20, false);
      return send(
        page(
          await rpc("crm_feed_comments", {
            p_post_id: id,
            ...positionArgs(settings),
          }),
          settings,
          "comment",
          access.storage === "sqlite",
        ),
      );
    }
    if (request.method === "POST") {
      const input = await body();
      return send(
        checkEntity(
          await rpc("crm_feed_comment_create", {
            p_post_id: id,
            p_body: text(input.body, 2000),
          }),
          "comment",
        ),
        201,
      );
    }
  } else if (
    (match = /^\/api\/feed\/posts\/([^/]+)\/(pin|reactions)$/.exec(path))
  ) {
    const id = identifier(match[1]);
    if (request.method === "POST") {
      const input = await body();
      if (match[2] === "pin") {
        if (access.role !== "admin")
          throw new HttpError(
            403,
            "Somente administradores podem fixar publicações.",
          );
        return send(
          checkEntity(
            await rpc("crm_feed_pin", {
              p_post_id: id,
              p_pinned: boolean(input.pinned),
            }),
            "post",
          ),
        );
      }
      if (!(input.reaction === null || reactions.includes(input.reaction)))
        throw new HttpError(400, "Escolha uma reação válida.");
      return send(
        checkEntity(
          await rpc("crm_feed_react", {
            p_post_id: id,
            p_reaction: input.reaction,
          }),
          "post",
        ),
      );
    }
  } else if ((match = /^\/api\/feed\/posts\/([^/]+)$/.exec(path))) {
    const id = identifier(match[1]);
    if (request.method === "PATCH") {
      const input = await body();
      return send(
        checkEntity(
          await rpc("crm_feed_edit", {
            p_post_id: id,
            p_body: text(input.body, 8000),
          }),
          "post",
        ),
      );
    }
    if (request.method === "DELETE")
      return send(ok(await rpc("crm_feed_delete", { p_post_id: id })));
  } else if ((match = /^\/api\/feed\/comments\/([^/]+)$/.exec(path))) {
    const id = identifier(match[1]);
    if (request.method === "PATCH") {
      const input = await body();
      return send(
        checkEntity(
          await rpc("crm_feed_comment_edit", {
            p_comment_id: id,
            p_body: text(input.body, 2000),
          }),
          "comment",
        ),
      );
    }
    if (request.method === "DELETE")
      return send(
        ok(await rpc("crm_feed_comment_delete", { p_comment_id: id })),
      );
  } else throw new HttpError(404, "Esta rota de colaboração não existe.");

  throw new HttpError(405, "Método não permitido nesta rota de colaboração.");
}
