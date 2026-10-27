import { HttpError, readBody, sendJson } from "./domain.mjs";
import {
  plainObject,
  presentSuiteItem,
  suiteKinds,
  suiteIdentifier,
  suiteRevision,
  suiteTitle,
  validateBookingInput,
  validateSuiteAction,
  validateSuiteData,
} from "./suite-domain.mjs";

export const isSuitePath = (path) => /^\/api\/suite(?:\/|$)/.test(path);
export const isSuitePublicPath = (path) => /^\/api\/booking\//.test(path);
function keys(body, allowed) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "Um dos campos informados não pode ser alterado.");
}
function revisionQuery(request) {
  const params = new URL(request.url || "/", "http://internal").searchParams;
  const values = params.getAll("revision");
  const raw = values[0] ?? request.query?.revision;
  if (
    values.length > 1 ||
    Array.isArray(raw) ||
    typeof raw !== "string" ||
    !/^[1-9]\d{0,9}$/.test(raw)
  )
    throw new HttpError(400, "Informe a versão atual do registro.");
  return suiteRevision(Number(raw));
}
export async function handleSuiteRequest({
  path,
  request,
  response,
  access,
  database,
}) {
  if (!access.role)
    throw new HttpError(
      403,
      "Seu acesso precisa ser liberado por um administrador.",
    );
  const local = access.storage === "sqlite";
  const rpc = (name, args = {}) =>
    database(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  const item = (value) => {
    const row = presentSuiteItem(value, local);
    if (row.workspaceId !== access.workspaceId)
      throw new HttpError(
        502,
        "O registro retornado pertence a outra organização.",
      );
    return row;
  };
  if (path === "/api/suite/state" && request.method === "GET") {
    const rows = await rpc("crm_suite_list");
    if (!Array.isArray(rows))
      throw new HttpError(502, "A lista de módulos está inválida.");
    return sendJson(response, 200, { items: rows.map(item) });
  }
  const action = /^\/api\/suite\/actions\/([a-z_]+)$/.exec(path);
  if (action && request.method === "POST") {
    const values = validateSuiteAction(action[1], await readBody(request));
    const { id = null, revision = null, ...payload } = values;
    return sendJson(
      response,
      200,
      item(
        await rpc("crm_suite_action", {
          p_action: action[1],
          p_id: id,
          p_revision: revision,
          p_payload: payload,
        }),
      ),
    );
  }
  const match = /^\/api\/suite\/([a-z_]+)(?:\/([^/]+))?$/.exec(path);
  if (!match || !suiteKinds.includes(match[1]))
    throw new HttpError(404, "O módulo solicitado não foi encontrado.");
  const [, kind, rawId] = match;
  const id = rawId ? suiteIdentifier(rawId) : null;
  if (request.method === "DELETE" && id) {
    const result = await rpc("crm_suite_delete", {
      p_kind: kind,
      p_id: id,
      p_revision: revisionQuery(request),
    });
    if (result?.ok !== true)
      throw new HttpError(502, "A exclusão retornou uma resposta inválida.");
    return sendJson(response, 200, { ok: true });
  }
  if (
    (request.method === "POST" && !id) ||
    (request.method === "PATCH" && id)
  ) {
    const body = await readBody(request);
    keys(body, id ? ["title", "data", "revision"] : ["title", "data"]);
    const title = Object.hasOwn(body, "title") ? suiteTitle(body.title) : null;
    if (!id && title === null)
      throw new HttpError(400, "Informe o título do registro.");
    const data = validateSuiteData(kind, body.data ?? {});
    const revision = id ? suiteRevision(body.revision) : null;
    const saved = item(
      await rpc("crm_suite_save", {
        p_kind: kind,
        p_id: id,
        p_title: title,
        p_data: data,
        p_revision: revision,
      }),
    );
    if (saved.kind !== kind || (id && saved.id !== id))
      throw new HttpError(
        502,
        "O módulo retornou um registro diferente do solicitado.",
      );
    return sendJson(response, id ? 200 : 201, { item: saved });
  }
  throw new HttpError(405, "Esta operação não está disponível neste endereço.");
}

export async function handleSuitePublicRequest({
  path,
  request,
  response,
  database,
}) {
  const match = /^\/api\/booking\/([^/]+)$/.exec(path);
  if (!match) throw new HttpError(404, "A página de agendamento não existe.");
  const id = suiteIdentifier(match[1]);
  const rpc = (name, args) =>
    database(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  if (request.method === "GET") {
    const result = await rpc("crm_booking_page", { p_id: id });
    if (
      !plainObject(result) ||
      result.id !== id ||
      typeof result.title !== "string" ||
      !plainObject(result.data) ||
      !Array.isArray(result.busyStartTimes)
    )
      throw new HttpError(
        502,
        "A página de agendamento retornou uma resposta inválida.",
      );
    return sendJson(response, 200, result);
  }
  if (request.method === "POST") {
    const body = validateBookingInput(await readBody(request));
    const result = await rpc("crm_booking_reserve", {
      p_id: id,
      p_name: body.name,
      p_email: body.email,
      p_start_at: body.startAt,
    });
    if (result?.ok !== true || typeof result.id !== "string")
      throw new HttpError(502, "O agendamento retornou uma resposta inválida.");
    suiteIdentifier(result.id);
    return sendJson(response, 201, { ok: true, id: result.id });
  }
  throw new HttpError(405, "Esta operação não está disponível no agendamento.");
}
