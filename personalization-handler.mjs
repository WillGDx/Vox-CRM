import { HttpError, readBody, sendJson } from "./domain.mjs";

const bucket = "crm-personal-media";
const themes = ["light", "dark", "system"];
const accents = ["teal", "blue", "purple", "rose", "amber", "green"];
const backgrounds = ["none", "aurora", "ocean", "sunset", "forest"];
const filename =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$/i;
const profileFields = {
  fullName: ["full_name", 120],
  jobTitle: ["job_title", 100],
  department: ["department", 100],
  phone: ["phone", 40],
  location: ["location", 120],
  bio: ["bio", 1000],
};

export function isPersonalizationPath(path) {
  return (
    path === "/api/me" ||
    path.startsWith("/api/me/") ||
    path === "/api/workspace/settings"
  );
}

function metadata(user) {
  const value = user.user_metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function ownPath(value, userId, kind) {
  if (typeof value !== "string") return false;
  const pieces = value.split("/");
  return (
    pieces.length === 3 &&
    pieces[0] === userId &&
    pieces[1] === kind &&
    filename.test(pieces[2])
  );
}

function mediaInput(value, userId, kind) {
  if (value === null || value === "") return null;
  if (!ownPath(value, userId, kind))
    throw new HttpError(
      400,
      "Selecione uma imagem enviada pela sua própria conta.",
    );
  return value;
}

function knownFields(body, fields) {
  if (Object.keys(body).some((field) => !fields.includes(field))) {
    throw new HttpError(
      400,
      "Um dos campos informados não pode ser alterado nesta tela.",
    );
  }
}

function text(value, maximum, required = false) {
  if (
    typeof value !== "string" ||
    value.trim().length > maximum ||
    (required && !value.trim())
  ) {
    throw new HttpError(
      400,
      required
        ? `Informe um nome com até ${maximum} caracteres.`
        : `Confira os campos de texto e seus limites de caracteres.`,
    );
  }
  return value.trim();
}

function displayText(value, maximum, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : fallback;
}

function profileFrom(user) {
  const data = metadata(user);
  const profile = {};
  for (const [field, [name, limit]] of Object.entries(profileFields)) {
    profile[field] = displayText(
      data[name],
      limit,
      field === "fullName" ? user.email?.split("@")[0] || "Sua conta" : "",
    );
  }
  profile.avatarPath = ownPath(data.avatar_path, user.id, "avatar")
    ? data.avatar_path
    : null;
  return profile;
}

function preferencesFrom(user) {
  const source = metadata(user).crm_preferences;
  const data =
    source && typeof source === "object" && !Array.isArray(source)
      ? source
      : {};
  return {
    theme: themes.includes(data.theme) ? data.theme : "light",
    accent: accents.includes(data.accent) ? data.accent : "teal",
    backgroundPreset: backgrounds.includes(data.backgroundPreset)
      ? data.backgroundPreset
      : "none",
    backgroundPath: ownPath(data.backgroundPath, user.id, "background")
      ? data.backgroundPath
      : null,
    backgroundOpacity:
      typeof data.backgroundOpacity === "number" &&
      Number.isFinite(data.backgroundOpacity) &&
      data.backgroundOpacity >= 0 &&
      data.backgroundOpacity <= 0.7
        ? data.backgroundOpacity
        : 0.25,
  };
}

async function checkedJson(response, operation) {
  if (response.status === 401)
    throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
  if (!response.ok)
    throw new HttpError(response.status === 400 ? 400 : 502, operation);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new HttpError(
      502,
      "O serviço de perfil retornou uma resposta inválida.",
    );
  }
  return body;
}

function storageUrl(value, supabaseUrl, expectedPath) {
  if (typeof value !== "string") return null;
  let target;
  try {
    if (value.startsWith("/object/sign/"))
      target = new URL("/storage/v1" + value, supabaseUrl);
    else if (value.startsWith("/storage/v1/object/sign/"))
      target = new URL(value, supabaseUrl);
    else target = new URL(value);
    const base = new URL(supabaseUrl);
    if (
      target.origin !== base.origin ||
      target.protocol !== "https:" ||
      target.username ||
      target.password
    )
      return null;
    if (
      decodeURIComponent(target.pathname) !==
      `/storage/v1/object/sign/${bucket}/${expectedPath}`
    )
      return null;
    return target.href;
  } catch {
    return null;
  }
}

async function makeMe({ user, access, database, signPath }) {
  const profile = profileFrom(user);
  const preferences = preferencesFrom(user);
  const allowedMembers = new Set(
    access.members
      .filter((member) => member.active)
      .map((member) => member.userId),
  );
  allowedMembers.add(user.id);
  const rows = await database("/rest/v1/rpc/crm_profile_directory", {
    method: "POST",
    body: "{}",
  });
  if (!Array.isArray(rows))
    throw new HttpError(
      502,
      "O diretório da equipe retornou uma resposta inválida.",
    );
  const directory = await Promise.all(
    rows
      .filter((row) => row && allowedMembers.has(row.userId))
      .map(async (row) => ({
        userId: row.userId,
        displayName:
          row.userId === user.id
            ? profile.fullName
            : displayText(row.displayName, 120, "Colaborador"),
        avatarUrl: ownPath(row.avatarPath, row.userId, "avatar")
          ? await signPath(row.avatarPath)
          : null,
      })),
  );
  const avatarUrl = profile.avatarPath
    ? await signPath(profile.avatarPath)
    : null;
  const backgroundUrl = preferences.backgroundPath
    ? await signPath(preferences.backgroundPath)
    : null;
  const own = directory.find((person) => person.userId === user.id);
  if (own) {
    own.displayName = profile.fullName;
    own.avatarUrl = avatarUrl;
  } else
    directory.unshift({
      userId: user.id,
      displayName: profile.fullName,
      avatarUrl,
    });
  return {
    userId: user.id,
    email: typeof user.email === "string" ? user.email : "",
    profile: { ...profile, avatarUrl },
    preferences: { ...preferences, backgroundUrl },
    directory,
    workspace: {
      id: access.workspaceId,
      name: access.workspaceName,
      canEdit: access.role === "admin",
    },
  };
}

export async function handlePersonalizationRequest({
  path,
  request,
  response,
  user,
  access,
  remote,
  database,
  supabaseUrl,
  signPath: localSignPath,
}) {
  if (!access.role)
    throw new HttpError(
      403,
      "Seu acesso está aguardando a liberação de um administrador.",
    );
  const signCache = new Map();
  const signPath = async (path) => {
    if (signCache.has(path)) return signCache.get(path);
    const task = (async () => {
      if (localSignPath) return localSignPath(path);
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const result = await remote(
        `/storage/v1/object/sign/${bucket}/${encoded}`,
        { method: "POST", body: JSON.stringify({ expiresIn: 3600 }) },
      );
      if (result.status === 401)
        throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
      if (!result.ok) return null;
      let data;
      try {
        data = await result.json();
      } catch {
        return null;
      }
      return storageUrl(data.signedURL ?? data.signedUrl, supabaseUrl, path);
    })();
    signCache.set(path, task);
    return task;
  };
  const current = () => makeMe({ user, access, database, signPath });
  if (path === "/api/me" && request.method === "GET") {
    return sendJson(response, 200, await current());
  }
  if (path === "/api/workspace/settings" && request.method === "PATCH") {
    if (access.role !== "admin")
      throw new HttpError(
        403,
        "Somente administradores alteram as configurações da organização.",
      );
    const body = await readBody(request);
    knownFields(body, ["name"]);
    const name = text(body.name, 120, true);
    const result = await database("/rest/v1/rpc/crm_set_workspace_name", {
      method: "POST",
      body: JSON.stringify({ p_name: name }),
    });
    if (
      !result?.workspace ||
      result.workspace.id !== access.workspaceId ||
      typeof result.workspace.name !== "string"
    ) {
      throw new HttpError(
        502,
        "A configuração da organização retornou uma resposta inválida.",
      );
    }
    return sendJson(response, 200, { workspace: result.workspace });
  }
  if (
    ["/api/me/profile", "/api/me/preferences"].includes(path) &&
    request.method === "PATCH"
  ) {
    const body = await readBody(request);
    // GoTrue merges top-level user metadata. Send only this screen's fields so
    // a concurrent profile update cannot restore an older appearance snapshot.
    const data = {};
    if (path === "/api/me/profile") {
      knownFields(body, [...Object.keys(profileFields), "avatarPath"]);
      for (const [field, [name, maximum]] of Object.entries(profileFields)) {
        if (Object.hasOwn(body, field))
          data[name] = text(body[field], maximum, field === "fullName");
      }
      if (Object.hasOwn(body, "avatarPath"))
        data.avatar_path = mediaInput(body.avatarPath, user.id, "avatar");
    } else {
      knownFields(body, [
        "theme",
        "accent",
        "backgroundPreset",
        "backgroundPath",
        "backgroundOpacity",
      ]);
      const preferences = preferencesFrom(user);
      for (const [field, allowed] of [
        ["theme", themes],
        ["accent", accents],
        ["backgroundPreset", backgrounds],
      ]) {
        if (Object.hasOwn(body, field)) {
          if (!allowed.includes(body[field]))
            throw new HttpError(
              400,
              "Selecione uma opção de aparência válida.",
            );
          preferences[field] = body[field];
        }
      }
      if (Object.hasOwn(body, "backgroundPath"))
        preferences.backgroundPath = mediaInput(
          body.backgroundPath,
          user.id,
          "background",
        );
      if (Object.hasOwn(body, "backgroundOpacity")) {
        if (
          typeof body.backgroundOpacity !== "number" ||
          !Number.isFinite(body.backgroundOpacity) ||
          body.backgroundOpacity < 0 ||
          body.backgroundOpacity > 0.7
        )
          throw new HttpError(
            400,
            "A intensidade do fundo deve estar entre 0 e 0,7.",
          );
        preferences.backgroundOpacity = body.backgroundOpacity;
      }
      data.crm_preferences = {
        ...(metadata(user).crm_preferences &&
        typeof metadata(user).crm_preferences === "object" &&
        !Array.isArray(metadata(user).crm_preferences)
          ? metadata(user).crm_preferences
          : {}),
        ...preferences,
      };
    }
    const updated = await checkedJson(
      await remote("/auth/v1/user", {
        method: "PUT",
        body: JSON.stringify({ data }),
      }),
      "Não foi possível salvar suas informações. Tente novamente.",
    );
    if (
      !updated ||
      updated.id !== user.id ||
      !updated.user_metadata ||
      typeof updated.user_metadata !== "object"
    )
      throw new HttpError(
        502,
        "O serviço de perfil retornou uma resposta inválida.",
      );
    user = updated;
    return sendJson(response, 200, await current());
  }
  if (path.startsWith("/api/me/media"))
    throw new HttpError(
      400,
      "Envie imagens diretamente pelo serviço de arquivos da sua conta.",
    );
  throw new HttpError(
    [
      "/api/me",
      "/api/me/profile",
      "/api/me/preferences",
      "/api/workspace/settings",
    ].includes(path)
      ? 405
      : 404,
    "Operação de configuração indisponível.",
  );
}
