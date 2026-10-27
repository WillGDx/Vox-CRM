import { randomUUID } from "node:crypto";
import { HttpError } from "./domain.mjs";

const teamId = "00000000-0000-4000-8000-000000000001";
const actor = { id: "local", name: "Você (local)" };
const timestamp = () => new Date().toISOString();
const notFound = () => {
  throw new HttpError(404, "O conteúdo solicitado não foi encontrado.");
};
const ordered = (first, second) =>
  second.createdAt.localeCompare(first.createdAt) ||
  second.id.localeCompare(first.id);

function before(item, args, pinned = false) {
  if (!args.p_before_created_at) return true;
  if (pinned && item.pinned !== args.p_before_pinned)
    return !item.pinned && args.p_before_pinned;
  return (
    item.createdAt < args.p_before_created_at ||
    (item.createdAt === args.p_before_created_at && item.id < args.p_before_id)
  );
}

function initial() {
  return { messages: [], reads: null, posts: [], comments: [], reactions: {} };
}

export function createLocalCollaborationDatabase(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS collaboration_state (id INTEGER PRIMARY KEY CHECK (id=1), payload TEXT NOT NULL)",
  );
  db.prepare(
    "INSERT INTO collaboration_state(id,payload) VALUES(1,?) ON CONFLICT(id) DO NOTHING",
  ).run(JSON.stringify(initial()));
  const select = db.prepare(
    "SELECT payload FROM collaboration_state WHERE id=1",
  );
  const save = db.prepare(
    "UPDATE collaboration_state SET payload=? WHERE id=1",
  );
  return async function localDatabase(endpoint, options = {}) {
    const name = endpoint.replace(/^\/rest\/v1\/rpc\//, "");
    const args = JSON.parse(options.body || "{}");
    db.exec("BEGIN IMMEDIATE");
    try {
      const state = JSON.parse(select.get().payload);
      const activePost = (id) =>
        state.posts.find((item) => item.id === id && !item.deletedAt) ||
        notFound();
      const message = (id) =>
        state.messages.find((item) => item.id === id) || notFound();
      const comment = (id) =>
        state.comments.find((item) => item.id === id && !item.deletedAt) ||
        notFound();
      const presentPost = (item) => {
        const reaction = state.reactions[item.id] || null;
        return {
          ...item,
          commentCount: state.comments.filter(
            (entry) => entry.postId === item.id && !entry.deletedAt,
          ).length,
          reactions: {
            like: reaction === "like" ? 1 : 0,
            celebrate: reaction === "celebrate" ? 1 : 0,
            heart: reaction === "heart" ? 1 : 0,
          },
          myReaction: reaction,
        };
      };
      const requireTeam = () => {
        if (args.p_conversation_id !== teamId) notFound();
      };
      let result;
      switch (name) {
        case "crm_chat_list": {
          const latest = [...state.messages].sort(ordered)[0];
          result = {
            conversations: [
              {
                id: teamId,
                kind: "team",
                title: "Equipe",
                peerId: null,
                lastMessage: latest
                  ? latest.deletedAt
                    ? "Mensagem excluída"
                    : latest.body
                  : null,
                lastMessageAt: latest?.createdAt || null,
                unreadCount: 0,
              },
            ],
            totalUnread: 0,
          };
          break;
        }
        case "crm_chat_open":
          throw new HttpError(
            409,
            "Conversas com colaboradores estão disponíveis no modo Supabase. O ambiente local tem apenas o seu usuário.",
          );
        case "crm_chat_history":
          requireTeam();
          result = state.messages
            .filter((item) => before(item, args))
            .sort(ordered)
            .slice(0, args.p_limit);
          break;
        case "crm_chat_send":
          requireTeam();
          result = {
            id: randomUUID(),
            conversationId: teamId,
            senderId: actor.id,
            senderName: actor.name,
            body: args.p_body,
            createdAt: timestamp(),
            editedAt: null,
            deletedAt: null,
          };
          state.messages.push(result);
          break;
        case "crm_chat_edit": {
          const item = message(args.p_message_id);
          if (item.deletedAt) notFound();
          item.body = args.p_body;
          item.editedAt = timestamp();
          result = item;
          break;
        }
        case "crm_chat_delete": {
          const item = message(args.p_message_id);
          item.body = "";
          item.deletedAt ||= timestamp();
          result = { ok: true };
          break;
        }
        case "crm_chat_mark_read":
          requireTeam();
          state.reads = timestamp();
          result = { ok: true };
          break;
        case "crm_feed_list":
          result = state.posts
            .filter((item) => !item.deletedAt && before(item, args, true))
            .sort(
              (first, second) =>
                Number(second.pinned) - Number(first.pinned) ||
                ordered(first, second),
            )
            .slice(0, args.p_limit)
            .map(presentPost);
          break;
        case "crm_feed_create": {
          const item = {
            id: randomUUID(),
            authorId: actor.id,
            authorName: actor.name,
            body: args.p_body,
            createdAt: timestamp(),
            editedAt: null,
            deletedAt: null,
            pinned: false,
          };
          state.posts.push(item);
          result = presentPost(item);
          break;
        }
        case "crm_feed_edit": {
          const item = activePost(args.p_post_id);
          item.body = args.p_body;
          item.editedAt = timestamp();
          result = presentPost(item);
          break;
        }
        case "crm_feed_delete": {
          const item = activePost(args.p_post_id);
          item.body = "";
          item.deletedAt = timestamp();
          result = { ok: true };
          break;
        }
        case "crm_feed_pin": {
          const item = activePost(args.p_post_id);
          item.pinned = args.p_pinned;
          result = presentPost(item);
          break;
        }
        case "crm_feed_react": {
          const item = activePost(args.p_post_id);
          if (args.p_reaction === null) delete state.reactions[item.id];
          else state.reactions[item.id] = args.p_reaction;
          result = presentPost(item);
          break;
        }
        case "crm_feed_comments":
          activePost(args.p_post_id);
          result = state.comments
            .filter(
              (item) =>
                item.postId === args.p_post_id &&
                !item.deletedAt &&
                before(item, args),
            )
            .sort(ordered)
            .slice(0, args.p_limit);
          break;
        case "crm_feed_comment_create":
          activePost(args.p_post_id);
          result = {
            id: randomUUID(),
            postId: args.p_post_id,
            authorId: actor.id,
            authorName: actor.name,
            body: args.p_body,
            createdAt: timestamp(),
            editedAt: null,
            deletedAt: null,
          };
          state.comments.push(result);
          break;
        case "crm_feed_comment_edit": {
          const item = comment(args.p_comment_id);
          activePost(item.postId);
          item.body = args.p_body;
          item.editedAt = timestamp();
          result = item;
          break;
        }
        case "crm_feed_comment_delete": {
          const item = comment(args.p_comment_id);
          activePost(item.postId);
          item.body = "";
          item.deletedAt = timestamp();
          result = { ok: true };
          break;
        }
        default:
          throw new HttpError(404, "Esta operação de colaboração não existe.");
      }
      save.run(JSON.stringify(state));
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
}
