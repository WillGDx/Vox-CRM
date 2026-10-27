import { createHash, randomBytes } from "node:crypto";
import { HttpError, readBody, sendJson } from "./domain.mjs";

export const isWebchatPublicPath = (path) =>
  path.startsWith("/api/public/chat/");
export async function handleWebchatPublicRequest({
  path,
  request,
  response,
  database,
}) {
  const match = /^\/api\/public\/chat\/(session\/)?([0-9a-f-]{36})$/.exec(path);
  if (
    !match ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      match[2],
    )
  )
    throw new HttpError(404, "Este atendimento não foi encontrado.");
  if (!["GET", "POST"].includes(request.method))
    throw new HttpError(405, "Método não permitido.");
  let token,
    args = {},
    hash = null;
  if (match[1]) {
    const auth = request.headers.authorization;
    if (typeof auth !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth))
      throw new HttpError(401, "Reabra o atendimento para continuar.");
    token = auth.slice(7);
    hash = createHash("sha256").update(token).digest("hex");
  } else if (request.method === "POST") {
    token = randomBytes(32).toString("base64url");
    hash = createHash("sha256").update(token).digest("hex");
  }
  if (request.method === "POST") {
    const body = await readBody(request);
    const fields = match[1] ? ["message"] : ["name", "email", "message"];
    if (Object.keys(body).some((key) => !fields.includes(key)))
      throw new HttpError(400, "Um dos campos enviados não é permitido.");
    if (
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.length > 4000
    )
      throw new HttpError(
        400,
        "Escreva uma mensagem com até 4.000 caracteres.",
      );
    args.message = body.message.trim();
    if (!match[1]) {
      if (
        typeof body.name !== "string" ||
        body.name.trim().length < 2 ||
        body.name.length > 120 ||
        typeof body.email !== "string" ||
        body.email.length > 254 ||
        (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
      )
        throw new HttpError(
          400,
          "Informe seu nome e um e-mail válido, se desejar.",
        );
      args.name = body.name.trim();
      args.email = body.email.trim();
    }
  }
  const action = match[1]
    ? request.method === "GET"
      ? "session"
      : "send"
    : request.method === "GET"
      ? "config"
      : "start";
  const result = await database("/rest/v1/rpc/crm_webchat_public", {
    method: "POST",
    body: JSON.stringify({
      p_action: action,
      p_id: match[2],
      p_token_hash: hash,
      p_args: args,
    }),
  });
  return sendJson(
    response,
    action === "start" ? 201 : 200,
    action === "start" ? { ...result, token } : result,
  );
}
