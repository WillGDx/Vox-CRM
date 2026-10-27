import { HttpError, readBody, sendJson } from "./domain.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sharedFileTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
};
export function isCollaborationExtraPath(path) {
  return path.startsWith("/api/collaboration-extra/");
}
const fail = (message = "Os dados informados são inválidos.") => {
  throw new HttpError(400, message);
};
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail();
  return value.trim();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  return value;
}
function fields(body, allowed) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    fail("Um campo informado não pode ser alterado.");
}
export function validateExtraAction(action, args) {
  if (action === "groups_create") {
    fields(args, ["title", "memberIds"]);
    if (!Array.isArray(args.memberIds) || args.memberIds.length > 29) fail();
    return {
      title: text(args.title, 120),
      memberIds: [...new Set(args.memberIds.map(id))],
    };
  }
  if (action === "groups_messages") {
    const out = { groupId: id(args.groupId) };
    if (args.before) {
      if (
        typeof args.before !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          args.before,
        ) ||
        !Number.isFinite(Date.parse(args.before))
      )
        fail();
      out.before = args.before;
      out.beforeId = id(args.beforeId);
    }
    return out;
  }
  if (action === "groups_send")
    return { groupId: id(args.groupId), body: text(args.body, 4000) };
  if (action === "polls_create") {
    fields(args, ["question", "options"]);
    if (
      !Array.isArray(args.options) ||
      args.options.length < 2 ||
      args.options.length > 8
    )
      fail();
    const options = args.options.map((x) => text(x, 100));
    if (
      new Set(options.map((x) => x.toLocaleLowerCase())).size !== options.length
    )
      fail("Use opções diferentes.");
    return { question: text(args.question, 300), options };
  }
  if (action === "polls_vote")
    return { pollId: id(args.pollId), optionId: id(args.optionId) };
  if (action === "polls_close") return { pollId: id(args.pollId) };
  if (action === "files_remove") return { id: id(args.id) };
  if (action === "files_register") {
    fields(args, ["name", "path", "mime", "size"]);
    if (
      typeof args.path !== "string" ||
      !/^([0-9a-f-]{36}|local)\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|pdf|txt|csv)$/i.test(
        args.path,
      ) ||
      !Object.hasOwn(sharedFileTypes, args.mime) ||
      !Number.isInteger(args.size) ||
      args.size < 1 ||
      args.size > 10485760
    )
      fail("Envie um arquivo permitido de até 10 MB.");
    return {
      name: text(args.name, 160),
      path: args.path,
      mime: args.mime,
      size: args.size,
    };
  }
  if (action === "state") return {};
  fail();
}
export async function handleExtraRequest({
  path,
  request,
  response,
  access,
  database,
  remote,
  supabaseUrl,
  signPath,
  removeFile,
}) {
  if (!access.role)
    throw new HttpError(403, "Seu acesso precisa ser liberado.");
  const prefix = "/api/collaboration-extra";
  let action,
    args = {};
  const group = /^\/api\/collaboration-extra\/groups\/([^/]+)\/messages$/.exec(
    path,
  );
  const poll =
    /^\/api\/collaboration-extra\/polls\/([^/]+)\/(vote|close)$/.exec(path);
  const file =
    /^\/api\/collaboration-extra\/files\/([^/]+)(?:\/(download))?$/.exec(path);
  if (path === prefix + "/state" && request.method === "GET") action = "state";
  else if (path === prefix + "/groups" && request.method === "POST") {
    action = "groups_create";
    args = await readBody(request);
  } else if (group && request.method === "GET") {
    action = "groups_messages";
    const search = new URL(request.url || "/", "http://internal").searchParams;
    args = {
      groupId: group[1],
      before: search.get("before") || request.query?.before || undefined,
      beforeId: search.get("beforeId") || request.query?.beforeId || undefined,
    };
  } else if (group && request.method === "POST") {
    action = "groups_send";
    const body = await readBody(request);
    fields(body, ["body"]);
    args = { ...body, groupId: group[1] };
  } else if (path === prefix + "/polls" && request.method === "POST") {
    action = "polls_create";
    args = await readBody(request);
  } else if (poll && request.method === "POST") {
    action = poll[2] === "vote" ? "polls_vote" : "polls_close";
    const body = await readBody(request);
    fields(body, poll[2] === "vote" ? ["optionId"] : []);
    args = { ...body, pollId: poll[1] };
  } else if (path === prefix + "/files/register" && request.method === "POST") {
    action = "files_register";
    args = await readBody(request);
  } else if (
    file &&
    ((file[2] === "download" && request.method === "GET") ||
      (!file[2] && request.method === "DELETE"))
  ) {
    id(file[1]);
    const state = await database("/rest/v1/rpc/crm_collaboration_extra", {
      method: "POST",
      body: JSON.stringify({ p_action: "state", p_args: {} }),
    });
    const item = state?.files?.find((x) => x.id === file[1]);
    if (!item) throw new HttpError(404, "Arquivo não encontrado.");
    if (file[2]) {
      let url;
      if (signPath) url = await signPath(item.path);
      else {
        const result = await remote(
          "/storage/v1/object/sign/crm-shared-files/" +
            item.path.split("/").map(encodeURIComponent).join("/"),
          {
            method: "POST",
            body: JSON.stringify({ expiresIn: 300 }),
          },
        );
        if (!result.ok)
          throw new HttpError(502, "Não foi possível preparar o download.");
        const data = await result.json();
        const signed = data.signedURL ?? data.signedUrl;
        if (typeof signed !== "string")
          throw new HttpError(502, "Download inválido.");
        const base = new URL(supabaseUrl);
        const candidate = new URL(
          signed.startsWith("/object/") ? "/storage/v1" + signed : signed,
          base,
        );
        if (
          candidate.origin !== base.origin ||
          decodeURIComponent(candidate.pathname) !==
            "/storage/v1/object/sign/crm-shared-files/" + item.path
        )
          throw new HttpError(502, "Download inválido.");
        candidate.searchParams.set("download", item.name);
        url = candidate.href;
      }
      return sendJson(response, 200, { url });
    }
    if (item.authorId !== access.userId && access.role !== "admin")
      throw new HttpError(
        403,
        "Apenas autor ou administrador pode remover o arquivo.",
      );
    if (removeFile) await removeFile(item.path);
    else {
      const result = await remote("/storage/v1/object/crm-shared-files", {
        method: "DELETE",
        body: JSON.stringify({ prefixes: [item.path] }),
      });
      if (!result.ok)
        throw new HttpError(
          502,
          "Não foi possível remover o arquivo. Tente novamente.",
        );
    }
    action = "files_remove";
    args = { id: file[1] };
  } else throw new HttpError(404, "Ação de colaboração não encontrada.");
  args = validateExtraAction(action, args);
  const result = await database("/rest/v1/rpc/crm_collaboration_extra", {
    method: "POST",
    body: JSON.stringify({ p_action: action, p_args: args }),
  });
  if (!result || typeof result !== "object")
    throw new HttpError(502, "Resposta de colaboração inválida.");
  return sendJson(response, 200, result);
}
