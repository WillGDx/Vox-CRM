import { randomUUID } from "node:crypto";
import { HttpError } from "./domain.mjs";
export function createLocalWebchatDatabase(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS webchat_sessions(id TEXT PRIMARY KEY,payload TEXT NOT NULL)",
  );
  const rows = () =>
    db
      .prepare("SELECT payload FROM suite_items")
      .all()
      .map((row) => JSON.parse(row.payload));
  const save = (item) =>
    db
      .prepare(
        "INSERT INTO suite_items(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(item.id, JSON.stringify(item));
  const item = (kind, title, data) => {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      workspaceId: "local",
      ownerId: "local",
      kind,
      title,
      data,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
  };
  return async (endpoint, options) => {
    if (endpoint !== "/rest/v1/rpc/crm_webchat_public")
      throw new HttpError(404, "Operação não encontrada.");
    const {
      p_action: action,
      p_id: id,
      p_token_hash: hash,
      p_args: args = {},
    } = JSON.parse(options.body);
    let session, channel, conversation;
    const all = rows();
    if (["config", "start"].includes(action))
      channel = all.find(
        (entry) => entry.id === id && entry.kind === "channels",
      );
    else {
      const row = db
        .prepare("SELECT payload FROM webchat_sessions WHERE id=?")
        .get(id);
      session = row && JSON.parse(row.payload);
      if (!session || session.hash !== hash || session.expiresAt < Date.now())
        throw new HttpError(404, "Atendimento não encontrado ou expirado.");
      channel = all.find(
        (entry) => entry.id === session.channelId && entry.kind === "channels",
      );
      conversation = all.find(
        (entry) =>
          entry.id === session.conversationId &&
          entry.kind === "service_conversations",
      );
    }
    if (
      !channel ||
      channel.data.type !== "webchat" ||
      channel.data.enabled !== true
    )
      throw new HttpError(404, "Este canal de atendimento está indisponível.");
    if (action === "config") return { id: channel.id, title: channel.title };
    if (action === "start") {
      const recent = db
        .prepare("SELECT payload FROM webchat_sessions")
        .all()
        .map((row) => JSON.parse(row.payload))
        .filter(
          (entry) =>
            entry.channelId === channel.id &&
            entry.expiresAt - 7 * 86400000 > Date.now() - 3600000,
        );
      if (recent.length >= 60)
        throw new HttpError(
          429,
          "Este canal atingiu seu limite temporário. Tente mais tarde.",
        );
      conversation = item("service_conversations", args.name, {
        channel: "webchat",
        customer: args.name,
        email: args.email,
        phone: "",
        status: "open",
        assigneeId: "",
        leadId: "",
      });
      save(conversation);
      session = {
        id: randomUUID(),
        channelId: channel.id,
        conversationId: conversation.id,
        hash,
        expiresAt: Date.now() + 7 * 86400000,
      };
      db.prepare("INSERT INTO webchat_sessions(id,payload) VALUES(?,?)").run(
        session.id,
        JSON.stringify(session),
      );
    }
    if (!conversation) throw new HttpError(404, "Atendimento não encontrado.");
    if (["start", "send"].includes(action)) {
      if (conversation.data.status === "closed")
        throw new HttpError(409, "Este atendimento foi encerrado.");
      if (
        all.filter(
          (entry) =>
            entry.kind === "service_messages" &&
            entry.data.conversationId === conversation.id &&
            entry.data.direction === "inbound" &&
            Date.parse(entry.createdAt) > Date.now() - 60000,
        ).length >= 20
      )
        throw new HttpError(
          429,
          "Aguarde um momento antes de enviar outra mensagem.",
        );
      save(
        item("service_messages", args.message.slice(0, 120), {
          conversationId: conversation.id,
          text: args.message,
          direction: "inbound",
        }),
      );
      save({
        ...conversation,
        revision: conversation.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      if (action === "start")
        return { id: session.id, conversationId: conversation.id };
    }
    const messages = rows()
      .filter(
        (entry) =>
          entry.kind === "service_messages" &&
          entry.data.conversationId === conversation.id,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      id: session.id,
      title: channel.title,
      status: conversation.data.status,
      messages: messages
        .slice(-200)
        .map((entry) => ({
          id: entry.id,
          ...entry.data,
          createdAt: entry.createdAt,
        })),
      hasMore: messages.length > 200,
    };
  };
}
