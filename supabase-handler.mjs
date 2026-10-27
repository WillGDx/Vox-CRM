import { initialState } from "./seed.mjs";
import {
  handleSuiteRequest,
  handleSuitePublicRequest,
  isSuitePath,
  isSuitePublicPath,
} from "./suite-handler.mjs";
import {
  handleExtraRequest,
  isCollaborationExtraPath,
} from "./collaboration-extra-handler.mjs";
import { handleCopilotRequest, isCopilotPath } from "./copilot-handler.mjs";
import {
  handleWebchatPublicRequest,
  isWebchatPublicPath,
} from "./webchat-handler.mjs";
import {
  handleCollaborationRequest,
  isCollaborationPath,
} from "./collaboration-handler.mjs";
import {
  handlePersonalizationRequest,
  isPersonalizationPath,
} from "./personalization-handler.mjs";
import {
  HttpError,
  sendJson,
  readBody,
  parsePath,
  parseMutation,
  applyMutation,
  assertState,
  collections,
  csvData,
} from "./domain.mjs";

const conflictCodes = new Set(["PT409", "40001", "23505", "23P01"]);

function configuredValue(value, name) {
  if (typeof value !== "string") return value;
  const separator = value.indexOf("=");
  if (separator < 0) return value;
  const prefix = value.slice(0, separator);
  return prefix === name || prefix === `NEXT_PUBLIC_${name}`
    ? value.slice(separator + 1)
    : value;
}

function configuration(env) {
  const url = configuredValue(env.SUPABASE_URL, "SUPABASE_URL");
  const publishableKey = configuredValue(
    env.SUPABASE_PUBLISHABLE_KEY,
    "SUPABASE_PUBLISHABLE_KEY",
  );
  const invalid = () =>
    new HttpError(
      503,
      "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY com a chave pública do projeto.",
    );
  if (
    !url ||
    !publishableKey ||
    typeof url !== "string" ||
    typeof publishableKey !== "string"
  )
    throw invalid();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["", "/"].includes(parsed.pathname)
  )
    throw invalid();
  if (publishableKey.startsWith("sb_secret_")) throw invalid();
  let publicKey =
    publishableKey.startsWith("sb_publishable_") &&
    publishableKey.length > "sb_publishable_".length;
  if (!publicKey && publishableKey.split(".").length === 3) {
    try {
      publicKey =
        JSON.parse(
          Buffer.from(publishableKey.split(".")[1], "base64url").toString(),
        ).role === "anon";
    } catch {
      /* Invalid public key is rejected below. */
    }
  }
  if (!publicKey) throw invalid();
  return { url: parsed.origin, publishableKey };
}

function routePath(request) {
  const original = parsePath(request);
  if (original !== "/api/index" && original !== "/api/index.mjs")
    return original;
  const parsed = new URL(request.url || "/", "http://internal");
  const route = request.query?.route ?? parsed.searchParams.get("route");
  if (route === null || route === undefined) return original;
  const value = Array.isArray(route) ? route.join("/") : route;
  if (typeof value !== "string")
    throw new HttpError(400, "O endereço solicitado é inválido.");
  return parsePath({ url: `/api/${value}` });
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scopes = ["none", "own", "all"];
const roles = ["admin", "manager", "user"];

function validatePermissions(permissions, status = 502) {
  if (
    !permissions ||
    typeof permissions !== "object" ||
    Array.isArray(permissions)
  ) {
    throw new HttpError(status, "O perfil de permissões é inválido.");
  }
  for (const name of collections) {
    const entry = permissions[name];
    if (
      !entry ||
      typeof entry !== "object" ||
      !["read", "update", "delete"].every((action) =>
        scopes.includes(entry[action]),
      ) ||
      typeof entry.create !== "boolean" ||
      typeof entry.export !== "boolean"
    ) {
      throw new HttpError(status, "O perfil de permissões é inválido.");
    }
  }
  return permissions;
}

function validateAccess(access, userId) {
  if (
    !access ||
    access.userId !== userId ||
    !(access.role === null || roles.includes(access.role)) ||
    !Array.isArray(access.members) ||
    !access.profiles ||
    (access.role !== null &&
      (!uuidPattern.test(access.workspaceId) ||
        typeof access.workspaceName !== "string"))
  ) {
    throw new HttpError(502, "Resposta inválida de acesso ao CRM.");
  }
  if (access.role !== null) validatePermissions(access.permissions);
  for (const member of access.members) {
    if (
      !member ||
      !uuidPattern.test(member.userId) ||
      !roles.includes(member.role) ||
      typeof member.displayName !== "string" ||
      typeof member.active !== "boolean"
    ) {
      throw new HttpError(502, "Resposta inválida da equipe do CRM.");
    }
  }
  return access;
}

function permitted(access, collection, action, ownerId) {
  if (!access.role) return false;
  const permission = access.permissions[collection]?.[action];
  return (
    permission === true ||
    permission === "all" ||
    (permission === "own" && ownerId === access.userId)
  );
}

function requirePermission(access, collection, action, ownerId) {
  if (!permitted(access, collection, action, ownerId)) {
    throw new HttpError(
      403,
      "Seu perfil não permite esta ação neste módulo do CRM.",
    );
  }
}

export function createSupabaseHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function supabaseHandler(request, response) {
    try {
      const path = routePath(request);
      const config = configuration(env);
      if (request.method === "GET" && path === "/api/config")
        return sendJson(response, 200, {
          storage: "supabase",
          authRequired: true,
          configured: true,
          ...config,
        });
      if (request.method === "GET" && path === "/api/health")
        return sendJson(response, 200, {
          status: "ok",
          database: "supabase",
          databaseChecked: false,
        });
      if (isSuitePublicPath(path) || isWebchatPublicPath(path)) {
        const database = async (endpoint, options) => {
          let result;
          try {
            result = await fetchImpl(config.url + endpoint, {
              ...options,
              headers: {
                apikey: config.publishableKey,
                "content-type": "application/json",
              },
              signal: AbortSignal.timeout(15000),
              redirect: "error",
            });
          } catch {
            throw new HttpError(
              502,
              "Não foi possível conectar ao atendimento. Tente novamente.",
            );
          }
          const data = await result.json().catch(() => null);
          if (!result.ok) {
            const code = data?.code;
            throw new HttpError(
              code === "P0002"
                ? 404
                : conflictCodes.has(code)
                  ? 409
                  : code === "54000"
                    ? 429
                    : code === "22023" || code === "23514"
                      ? 400
                      : 503,
              code === "P0002"
                ? "Este link está indisponível ou expirou."
                : conflictCodes.has(code)
                  ? "Este horário acabou de ser reservado. Escolha outro."
                  : code === "54000"
                    ? "O limite temporário foi atingido. Tente mais tarde."
                    : code === "22023" || code === "23514"
                      ? "Confira os dados e a disponibilidade informados."
                      : "O serviço está indisponível. Tente novamente mais tarde.",
            );
          }
          return data;
        };
        if (isSuitePublicPath(path))
          return await handleSuitePublicRequest({
            path,
            request,
            response,
            database,
          });
        return await handleWebchatPublicRequest({
          path,
          request,
          response,
          database,
        });
      }
      const isAccess = request.method === "GET" && path === "/api/access";
      const isCollaboration = isCollaborationPath(path);
      const isPersonalization = isPersonalizationPath(path);
      const isSuite = isSuitePath(path);
      const isExtra = isCollaborationExtraPath(path);
      const isCopilot = isCopilotPath(path);
      const isRead = request.method === "GET" && path === "/api/state";
      const exportMatch =
        /^\/api\/export\/(companies|contacts|deals|tasks)$/.exec(path);
      const isExport = request.method === "GET" && !!exportMatch;
      const isMembers = request.method === "POST" && path === "/api/members";
      const profileMatch = /^\/api\/profiles\/(admin|manager|user)$/.exec(path);
      const isProfile = request.method === "PUT" && !!profileMatch;
      const mutation =
        isAccess ||
        isRead ||
        isExport ||
        isMembers ||
        isProfile ||
        isCollaboration ||
        isPersonalization ||
        isSuite ||
        isExtra ||
        isCopilot
          ? undefined
          : parseMutation(path, request.method);
      const authorization = request.headers.authorization;
      if (
        typeof authorization !== "string" ||
        !/^Bearer\s+\S+$/i.test(authorization)
      )
        throw new HttpError(401, "Entre na sua conta para acessar o CRM.");
      const token = authorization.replace(/^Bearer\s+/i, "");
      async function remote(endpoint, options = {}) {
        try {
          return await fetchImpl(config.url + endpoint, {
            ...options,
            headers: {
              apikey: config.publishableKey,
              Authorization: "Bearer " + token,
              "content-type": "application/json",
              ...options.headers,
            },
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          });
        } catch {
          throw new HttpError(
            502,
            "Não foi possível conectar ao Supabase. Tente novamente.",
          );
        }
      }
      const userResponse = await remote("/auth/v1/user");
      if (userResponse.status === 401 || userResponse.status === 403)
        throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
      if (!userResponse.ok)
        throw new HttpError(
          502,
          "Não foi possível validar a sessão no Supabase.",
        );
      let user;
      try {
        user = await userResponse.json();
      } catch {
        throw new HttpError(
          502,
          "Resposta de autenticação inválida do Supabase.",
        );
      }
      if (!user || typeof user.id !== "string" || !uuidPattern.test(user.id))
        throw new HttpError(
          502,
          "Resposta de autenticação inválida do Supabase.",
        );

      async function database(endpoint, options) {
        const result = await remote(endpoint, options);
        if (result.status === 401)
          throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
        if (result.status === 403)
          throw new HttpError(
            403,
            "Seu perfil não permite esta operação no CRM.",
          );
        if (result.status === 404)
          throw new HttpError(
            503,
            "Banco indisponível. Confira as migrações do CRM.",
          );
        if (result.status === 409)
          throw new HttpError(
            409,
            "O registro foi alterado ou já existe. Atualize a página e tente novamente.",
          );
        if (!result.ok) {
          let detail;
          try {
            detail = await result.json();
          } catch {
            detail = {};
          }
          if (detail.code === "42501")
            throw new HttpError(
              403,
              "Seu perfil não permite esta operação no CRM.",
            );
          if (detail.code === "P0002")
            throw new HttpError(
              404,
              "O conteúdo ou usuário solicitado não foi encontrado.",
            );
          if (conflictCodes.has(detail.code))
            throw new HttpError(
              409,
              "O registro foi alterado ou conflita com outro. Atualize a página e tente novamente.",
            );
          if (detail.code === "54000")
            throw new HttpError(
              429,
              "O limite temporário foi atingido. Tente mais tarde.",
            );
          if (
            detail.code === "23503" ||
            detail.code === "23514" ||
            detail.code === "22023"
          )
            throw new HttpError(
              400,
              "Confira os dados, vínculos e permissões informados.",
            );
          if (detail.code === "P0001")
            throw new HttpError(
              400,
              "Não foi possível alterar o acesso. Confira o usuário, seu perfil e se existe outro administrador ativo.",
            );
          throw new HttpError(
            502,
            "Não foi possível acessar o banco do Supabase. Confira a migração e tente novamente.",
          );
        }
        if (result.status === 204) return [];
        try {
          return await result.json();
        } catch {
          throw new HttpError(502, "Resposta inválida do banco Supabase.");
        }
      }
      const access = validateAccess(
        await database("/rest/v1/rpc/crm_access", {
          method: "POST",
          body: JSON.stringify({ p_seed: initialState() }),
        }),
        user.id,
      );
      if (isAccess) return sendJson(response, 200, access);
      if (!access.role)
        throw new HttpError(
          403,
          "Seu acesso está aguardando a liberação de um administrador.",
        );
      if (isSuite)
        return await handleSuiteRequest({
          path,
          request,
          response,
          access,
          database,
        });
      if (isExtra)
        return await handleExtraRequest({
          path,
          request,
          response,
          access,
          user,
          database,
          remote,
          supabaseUrl: config.url,
        });
      if (isCopilot)
        return await handleCopilotRequest({
          path,
          request,
          response,
          access,
          env,
          fetchImpl,
        });

      if (isPersonalization) {
        await handlePersonalizationRequest({
          path,
          request,
          response,
          user,
          access,
          remote,
          database,
          supabaseUrl: config.url,
        });
        return;
      }

      if (isCollaboration) {
        await handleCollaborationRequest({
          path,
          request,
          response,
          access,
          database,
        });
        return;
      }

      if (isMembers || isProfile) {
        if (access.role !== "admin")
          throw new HttpError(
            403,
            "Somente administradores podem gerenciar usuários e permissões.",
          );
        const body = await readBody(request);
        let updated;
        if (isMembers) {
          if (
            typeof body.email !== "string" ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
            !roles.includes(body.role) ||
            (body.active !== undefined && typeof body.active !== "boolean")
          )
            throw new HttpError(
              400,
              "Informe um e-mail cadastrado e um perfil válido.",
            );
          updated = await database("/rest/v1/rpc/crm_set_member", {
            method: "POST",
            body: JSON.stringify({
              p_email: body.email.trim(),
              p_role: body.role,
              p_active: body.active ?? true,
            }),
          });
        } else {
          if (profileMatch[1] === "admin")
            throw new HttpError(
              400,
              "O perfil de administrador mantém acesso completo.",
            );
          validatePermissions(body.permissions, 400);
          updated = await database("/rest/v1/rpc/crm_save_profile", {
            method: "POST",
            body: JSON.stringify({
              p_role: profileMatch[1],
              p_permissions: body.permissions,
            }),
          });
        }
        return sendJson(response, 200, validateAccess(updated, user.id));
      }

      const workspace = encodeURIComponent(access.workspaceId);
      async function records(collection) {
        const endpoint =
          "/rest/v1/crm_records?workspace_id=eq." +
          workspace +
          (collection ? "&collection=eq." + collection : "") +
          "&select=collection,id,owner_id,payload,version";
        const rows = await database(endpoint);
        if (!Array.isArray(rows))
          throw new HttpError(
            502,
            "Resposta inválida dos registros no Supabase.",
          );
        for (const row of rows) {
          if (
            !row ||
            !collections.includes(row.collection) ||
            typeof row.id !== "string" ||
            (row.owner_id !== null && !uuidPattern.test(row.owner_id)) ||
            !row.payload ||
            typeof row.payload !== "object" ||
            Array.isArray(row.payload) ||
            !Number.isSafeInteger(row.version) ||
            row.version < 0
          ) {
            throw new HttpError(502, "Um registro do Supabase é inválido.");
          }
        }
        return rows;
      }
      const rows = await records(isExport ? exportMatch[1] : undefined);
      const state = Object.fromEntries(collections.map((name) => [name, []]));
      for (const row of rows) {
        if (!permitted(access, row.collection, "read", row.owner_id)) continue;
        state[row.collection].push({
          ...row.payload,
          id: row.id,
          ownerId: row.owner_id,
        });
      }
      state.activities = [];
      assertState(state);
      if (isExport) {
        requirePermission(access, exportMatch[1], "export");
        response.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition":
            'attachment; filename="vox-crm-' + exportMatch[1] + '.csv"',
          "x-content-type-options": "nosniff",
        });
        return response.end(csvData(state[exportMatch[1]]));
      }
      if (isRead) {
        const activities = await database(
          "/rest/v1/crm_activities?workspace_id=eq." +
            workspace +
            "&select=id,text,type,created_at&order=created_at.desc&limit=50",
        );
        if (!Array.isArray(activities))
          throw new HttpError(502, "Resposta inválida das atividades do CRM.");
        state.activities = activities.map((item) => ({
          id: item.id,
          text: item.text,
          type: item.type,
          createdAt: item.created_at,
        }));
        return sendJson(response, 200, assertState(state));
      }

      const existingRow = mutation.id
        ? rows.find(
            (row) =>
              row.collection === mutation.collection &&
              row.id === mutation.id &&
              permitted(access, row.collection, "read", row.owner_id),
          )
        : undefined;
      if (mutation.id && !existingRow)
        throw new HttpError(404, "Registro não encontrado.");
      const action =
        mutation.method === "POST"
          ? "create"
          : mutation.method === "PUT"
            ? "update"
            : "delete";
      requirePermission(
        access,
        mutation.collection,
        action,
        existingRow?.owner_id,
      );
      const body = mutation.method === "DELETE" ? {} : await readBody(request);
      const changed = applyMutation(state, mutation, body);
      const rowFilter =
        "/rest/v1/crm_records?workspace_id=eq." +
        workspace +
        "&collection=eq." +
        mutation.collection +
        "&id=eq." +
        encodeURIComponent(mutation.id || changed.result.id);
      if (mutation.method === "DELETE") {
        const removed = await database(
          rowFilter + "&version=eq." + existingRow.version,
          {
            method: "DELETE",
            headers: { Prefer: "return=representation" },
          },
        );
        if (!Array.isArray(removed))
          throw new HttpError(502, "Resposta inválida ao excluir o registro.");
        if (!removed.length)
          throw new HttpError(
            409,
            "O registro mudou em outra sessão. Atualize a página.",
          );
        return sendJson(response, 200, { ok: true });
      }
      const ownerId = Object.hasOwn(body, "ownerId")
        ? body.ownerId
        : (existingRow?.owner_id ?? user.id);
      if (!uuidPattern.test(ownerId))
        throw new HttpError(400, "Selecione um responsável válido.");
      if (
        ownerId !== user.id &&
        access.permissions[mutation.collection].update !== "all"
      )
        throw new HttpError(
          403,
          "Seu perfil não permite atribuir registros a outro usuário.",
        );
      const member = access.members.find(
        (item) => item.userId === ownerId && item.active,
      );
      if (!member)
        throw new HttpError(
          400,
          "O responsável precisa ser um usuário ativo da organização.",
        );
      const item = { ...changed.result, owner: member.displayName };
      delete item.ownerId;
      const requestBody =
        mutation.method === "POST"
          ? {
              workspace_id: access.workspaceId,
              collection: mutation.collection,
              id: item.id,
              owner_id: ownerId,
              payload: item,
            }
          : { owner_id: ownerId, payload: item };
      const saved = await database(
        mutation.method === "POST"
          ? "/rest/v1/crm_records"
          : rowFilter + "&version=eq." + existingRow.version,
        {
          method: mutation.method === "POST" ? "POST" : "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(requestBody),
        },
      );
      if (!Array.isArray(saved))
        throw new HttpError(502, "Resposta inválida ao salvar o registro.");
      if (!saved.length)
        throw new HttpError(
          409,
          "O registro foi atualizado em outra sessão. Atualize a página e tente novamente.",
        );
      if (saved.length !== 1 || saved[0].id !== item.id)
        throw new HttpError(502, "Resposta inválida ao salvar o registro.");
      return sendJson(response, mutation.method === "POST" ? 201 : 200, {
        ...item,
        ownerId,
      });
    } catch (error) {
      const expected = error instanceof HttpError;
      if (!response.headersSent)
        sendJson(response, expected ? error.status : 500, {
          error: expected
            ? error.message
            : "Não foi possível concluir a operação.",
        });
      else response.end();
    }
  };
}
