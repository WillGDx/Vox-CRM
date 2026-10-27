import { randomUUID } from "node:crypto";
import { HttpError, sendJson } from "./domain.mjs";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const pathPattern = new RegExp(
  `^local/(avatar|background)/(${uuid})\\.(png|jpg|jpeg|webp)$`,
  "i",
);
const routePattern = new RegExp(`^/api/me/media/(${uuid})$`, "i");
const mimeExtensions = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function metadataDefaults() {
  return {
    full_name: "Usuário local",
    job_title: "",
    department: "",
    phone: "",
    location: "",
    bio: "",
    avatar_path: null,
    crm_preferences: {
      theme: "light",
      accent: "teal",
      backgroundPreset: "none",
      backgroundPath: null,
      backgroundOpacity: 0.25,
    },
  };
}

function isImage(bytes, mime) {
  if (mime === "image/png")
    return (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  if (mime === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  return (
    mime === "image/webp" &&
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}

async function imageBytes(request, maximum) {
  let length = 0;
  let chunks = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length <= maximum) chunks.push(bytes);
    else chunks = [];
  }
  if (length > maximum)
    throw new HttpError(413, "A imagem excede o tamanho permitido.");
  if (!length) throw new HttpError(400, "Selecione uma imagem para enviar.");
  return Buffer.concat(chunks);
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

export function createLocalPersonalization(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_media (
      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
      mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL
    );
  `);
  const readSetting = db.prepare(
    "SELECT value FROM personal_metadata WHERE key = ?",
  );
  const writeSetting = db.prepare(
    "INSERT INTO personal_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  const mediaById = db.prepare("SELECT * FROM personal_media WHERE id = ?");
  const mediaByPath = db.prepare(
    "SELECT id FROM personal_media WHERE path = ?",
  );
  const metadata = () => {
    const row = readSetting.get("profile");
    return { ...metadataDefaults(), ...(row ? JSON.parse(row.value) : {}) };
  };
  const user = () => ({ id: "local", email: "", user_metadata: metadata() });
  const workspaceName = () => {
    const row = readSetting.get("workspace_name");
    return row ? JSON.parse(row.value) : "Workspace local";
  };

  async function remote(endpoint, options = {}) {
    if (endpoint !== "/auth/v1/user")
      throw new HttpError(404, "Serviço local não encontrado.");
    const method = options.method || "GET";
    if (method === "PUT") {
      let body;
      try {
        body =
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : options.body;
      } catch {
        throw new HttpError(400, "O JSON enviado é inválido.");
      }
      if (!plainObject(body) || !plainObject(body.data))
        throw new HttpError(400, "Informe os dados do perfil.");
      writeSetting.run(
        "profile",
        JSON.stringify({ ...metadata(), ...body.data }),
      );
    } else if (method !== "GET")
      throw new HttpError(405, "Método não permitido.");
    return Response.json(user());
  }

  async function database(endpoint, options = {}) {
    if (endpoint === "/rest/v1/rpc/crm_profile_directory") {
      const data = metadata();
      return [
        {
          userId: "local",
          displayName: data.full_name,
          avatarPath: data.avatar_path || null,
        },
      ];
    }
    if (endpoint === "/rest/v1/rpc/crm_set_workspace_name") {
      let body;
      try {
        body =
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : options.body;
      } catch {
        throw new HttpError(400, "O JSON enviado é inválido.");
      }
      if (
        typeof body?.p_name !== "string" ||
        !body.p_name.trim() ||
        body.p_name.trim().length > 120
      )
        throw new HttpError(
          400,
          "Informe um nome de organização entre 1 e 120 caracteres.",
        );
      const name = body.p_name.trim();
      writeSetting.run("workspace_name", JSON.stringify(name));
      return { workspace: { id: "local", name } };
    }
    throw new HttpError(404, "Configuração local não encontrada.");
  }

  async function signPath(path) {
    if (typeof path !== "string" || !pathPattern.test(path)) return null;
    const item = mediaByPath.get(path);
    return item ? `/api/me/media/${item.id}` : null;
  }

  async function handleMedia({ path, request, response }) {
    if (path !== "/api/me/media" && !path.startsWith("/api/me/media/"))
      return false;
    const url = new URL(request.url || path, "http://local");
    const match = routePattern.exec(path);
    if (match && ["GET", "HEAD"].includes(request.method)) {
      const item = mediaById.get(match[1]);
      if (!item) throw new HttpError(404, "Imagem não encontrada.");
      const bytes = Buffer.from(item.bytes);
      response.writeHead(200, {
        "content-type": item.mime,
        "content-length": bytes.length,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
      return true;
    }
    if (path === "/api/me/media" && request.method === "PUT") {
      const kinds = url.searchParams.getAll("kind");
      if (kinds.length !== 1 || !["avatar", "background"].includes(kinds[0]))
        throw new HttpError(
          400,
          "Selecione o tipo de imagem: avatar ou background.",
        );
      const kind = kinds[0];
      const mime = (request.headers["content-type"] || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!Object.hasOwn(mimeExtensions, mime))
        throw new HttpError(415, "Use uma imagem PNG, JPEG ou WebP.");
      const bytes = await imageBytes(
        request,
        (kind === "avatar" ? 2 : 8) * 1024 * 1024,
      );
      if (!isImage(bytes, mime))
        throw new HttpError(
          415,
          "O conteúdo do arquivo não corresponde ao tipo de imagem.",
        );
      const id = randomUUID();
      const mediaPath = `local/${kind}/${id}.${mimeExtensions[mime]}`;
      db.prepare(
        "INSERT INTO personal_media(id,path,kind,mime,bytes,created_at) VALUES (?,?,?,?,?,?)",
      ).run(id, mediaPath, kind, mime, bytes, new Date().toISOString());
      sendJson(response, 201, { path: mediaPath });
      return true;
    }
    if (path === "/api/me/media" && request.method === "DELETE") {
      const paths = url.searchParams.getAll("path");
      if (paths.length !== 1 || !pathPattern.test(paths[0]))
        throw new HttpError(400, "O caminho da imagem é inválido.");
      db.prepare("DELETE FROM personal_media WHERE path = ?").run(paths[0]);
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (match || path === "/api/me/media")
      throw new HttpError(405, "Método não permitido.");
    throw new HttpError(404, "Imagem não encontrada.");
  }

  return { user, remote, database, workspaceName, signPath, handleMedia };
}
