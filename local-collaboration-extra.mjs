import { randomUUID } from "node:crypto";
import { HttpError, sendJson } from "./domain.mjs";
import { sharedFileTypes } from "./collaboration-extra-handler.mjs";
const maximum = 10485760;
const now = () => new Date().toISOString();
const missing = () => {
  throw new HttpError(404, "Conteúdo não encontrado.");
};
function validBytes(bytes, mime) {
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  if (mime === "application/pdf")
    return bytes.toString("ascii", 0, 5) === "%PDF-";
  if (mime === "text/plain" || mime === "text/csv") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return !bytes.includes(0);
    } catch {
      return false;
    }
  }
  return false;
}
export function createLocalCollaborationExtra(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS collaboration_extra_state(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS collaboration_extra_files(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL)",
  );
  db.prepare(
    "INSERT INTO collaboration_extra_state VALUES(1,?) ON CONFLICT(id) DO NOTHING",
  ).run(JSON.stringify({ groups: [], messages: [], polls: [], files: [] }));
  const read = db.prepare(
      "SELECT payload FROM collaboration_extra_state WHERE id=1",
    ),
    write = db.prepare(
      "UPDATE collaboration_extra_state SET payload=? WHERE id=1",
    );
  const file = db.prepare(
    "SELECT * FROM collaboration_extra_files WHERE path=?",
  );
  const signPath = async (path) => {
    const row = file.get(path);
    if (!row) return null;
    return "/api/collaboration-extra/media/" + row.id;
  };
  const removeFile = async (path) => {
    db.prepare("DELETE FROM collaboration_extra_files WHERE path=?").run(path);
  };
  async function handleUpload({ path, request, response }) {
    const media = /^\/api\/collaboration-extra\/media\/([0-9a-f-]{36})$/.exec(
      path,
    );
    if (media && request.method === "GET") {
      const row = db
        .prepare("SELECT * FROM collaboration_extra_files WHERE id=?")
        .get(media[1]);
      if (!row) missing();
      response.writeHead(200, {
        "content-type": row.mime,
        "content-disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(row.name),
        "content-length": row.bytes.length,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(row.bytes);
      return true;
    }
    if (
      path === "/api/collaboration-extra/uploads" &&
      request.method === "DELETE"
    ) {
      const pathValue = new URL(
        request.url,
        "http://internal",
      ).searchParams.get("path");
      if (
        typeof pathValue !== "string" ||
        !/^local\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|pdf|txt|csv)$/.test(
          pathValue,
        )
      )
        throw new HttpError(400, "Arquivo inválido.");
      await removeFile(pathValue);
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (path !== "/api/collaboration-extra/upload" || request.method !== "PUT")
      return false;
    const mime = (request.headers["content-type"] || "").split(";")[0];
    const name = new URL(request.url, "http://internal").searchParams.get(
      "name",
    );
    if (!Object.hasOwn(sharedFileTypes, mime) || !name || name.length > 160)
      throw new HttpError(
        400,
        "Use PNG, JPEG, WebP, PDF, TXT ou CSV, com até 10 MB.",
      );
    let size = 0,
      chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size <= maximum) chunks.push(chunk);
      else chunks = [];
    }
    if (size > maximum) throw new HttpError(413, "O arquivo excede 10 MB.");
    const bytes = Buffer.concat(chunks);
    if (!size || !validBytes(bytes, mime))
      throw new HttpError(
        400,
        "O conteúdo do arquivo não corresponde ao tipo informado.",
      );
    const id = randomUUID(),
      objectPath = "local/" + id + "." + sharedFileTypes[mime];
    db.prepare("INSERT INTO collaboration_extra_files VALUES(?,?,?,?,?)").run(
      id,
      objectPath,
      name,
      mime,
      bytes,
    );
    sendJson(response, 200, { path: objectPath, name, mime, size });
    return true;
  }
  async function database(endpoint, options = {}) {
    if (endpoint !== "/rest/v1/rpc/crm_collaboration_extra") missing();
    const { p_action: action, p_args: a = {} } = JSON.parse(
      options.body || "{}",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      const state = JSON.parse(read.get().payload);
      let result;
      if (action === "state")
        result = {
          groups: state.groups,
          polls: state.polls.map((p) => ({
            ...p,
            options: p.options.map((o) => ({
              ...o,
              votes: o.id === p.myOptionId ? 1 : 0,
            })),
          })),
          files: state.files,
        };
      else if (action === "groups_create") {
        if (a.memberIds.length)
          throw new HttpError(
            409,
            "O modo local tem apenas seu usuário. Adicione colegas na versão Supabase.",
          );
        const group = {
          id: randomUUID(),
          title: a.title,
          memberIds: ["local"],
          creatorId: "local",
          createdAt: now(),
          videoRoom: randomUUID(),
        };
        state.groups.unshift(group);
        result = { id: group.id };
      } else if (action === "groups_messages" || action === "groups_send") {
        if (!state.groups.some((g) => g.id === a.groupId)) missing();
        if (action === "groups_messages")
          result = {
            items: state.messages
              .filter(
                (m) =>
                  m.groupId === a.groupId &&
                  (!a.before ||
                    m.createdAt < a.before ||
                    (m.createdAt === a.before && m.id < a.beforeId)),
              )
              .sort(
                (x, y) =>
                  x.createdAt.localeCompare(y.createdAt) ||
                  x.id.localeCompare(y.id),
              )
              .slice(-50),
          };
        else {
          const msg = {
            id: randomUUID(),
            groupId: a.groupId,
            senderId: "local",
            senderName: "Você (local)",
            body: a.body,
            createdAt: now(),
          };
          state.messages.push(msg);
          result = { id: msg.id };
        }
      } else if (action === "polls_create") {
        const poll = {
          id: randomUUID(),
          question: a.question,
          options: a.options.map((label) => ({ id: randomUUID(), label })),
          myOptionId: null,
          closed: false,
          authorId: "local",
          authorName: "Você (local)",
          createdAt: now(),
        };
        state.polls.unshift(poll);
        result = { id: poll.id };
      } else if (action === "polls_vote" || action === "polls_close") {
        const poll = state.polls.find((p) => p.id === a.pollId) || missing();
        if (action === "polls_close") poll.closed = true;
        else {
          if (poll.closed)
            throw new HttpError(409, "A enquete já foi encerrada.");
          if (!poll.options.some((o) => o.id === a.optionId))
            throw new HttpError(400, "Opção inválida.");
          poll.myOptionId = a.optionId;
        }
        result = { ok: true };
      } else if (action === "files_register") {
        const stored = file.get(a.path);
        if (
          !stored ||
          stored.name !== a.name ||
          stored.mime !== a.mime ||
          stored.bytes.length !== a.size
        )
          throw new HttpError(400, "Envie o arquivo antes de publicar.");
        if (state.files.some((f) => f.path === a.path))
          throw new HttpError(409, "Arquivo já publicado.");
        const record = {
          id: randomUUID(),
          ...a,
          authorId: "local",
          createdAt: now(),
        };
        state.files.unshift(record);
        result = { id: record.id };
      } else if (action === "files_remove") {
        const item = state.files.find((f) => f.id === a.id) || missing();
        state.files = state.files.filter((f) => f.id !== a.id);
        result = { ok: true, path: item.path };
      } else missing();
      write.run(JSON.stringify(state));
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return { database, handleUpload, signPath, removeFile };
}
