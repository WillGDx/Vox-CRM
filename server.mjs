import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { initialState } from "./seed.mjs";
import {
  handleCollaborationRequest,
  isCollaborationPath,
} from "./collaboration-handler.mjs";
import { createLocalCollaborationDatabase } from "./local-collaboration.mjs";
import {
  handlePersonalizationRequest,
  isPersonalizationPath,
} from "./personalization-handler.mjs";
import { createLocalPersonalization } from "./local-personalization.mjs";
import {
  createLocalSuiteDatabase,
  runLocalSuiteAutomations,
} from "./local-suite.mjs";
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
import { createLocalCollaborationExtra } from "./local-collaboration-extra.mjs";
import { handleCopilotRequest, isCopilotPath } from "./copilot-handler.mjs";
import { createLocalWebchatDatabase } from "./local-webchat.mjs";
import {
  handleWebchatPublicRequest,
  isWebchatPublicPath,
} from "./webchat-handler.mjs";

const root = dirname(fileURLToPath(import.meta.url));
import {
  collections,
  HttpError,
  sendJson,
  readBody,
  parsePath,
  parseMutation,
  applyMutation,
  localAccess,
  csvData,
} from "./domain.mjs";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

export function createApp({
  dbPath = process.env.CRM_DB_PATH || resolve(root, "data/vox-crm.sqlite"),
  distPath = resolve(root, "dist"),
} = {}) {
  if (dbPath !== ":memory:")
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const collaborationDatabase = createLocalCollaborationDatabase(db);
  const personalization = createLocalPersonalization(db);
  const suiteDatabase = createLocalSuiteDatabase(db);
  const extra = createLocalCollaborationExtra(db);
  const webchatDatabase = createLocalWebchatDatabase(db);
  const developmentAccess = () => ({
    ...localAccess(),
    workspaceName: personalization.workspaceName(),
  });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, text TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const listRecords = db.prepare(
    "SELECT payload FROM records WHERE collection = ? ORDER BY rowid",
  );
  const saveRecord = db.prepare(
    "INSERT INTO records(collection, id, payload) VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET payload=excluded.payload",
  );
  const saveActivity = db.prepare(
    "INSERT INTO activities(id, text, type, created_at) VALUES (?, ?, ?, ?)",
  );
  const list = (collection) =>
    listRecords.all(collection).map((row) => JSON.parse(row.payload));
  const put = (collection, item) =>
    saveRecord.run(collection, item.id, JSON.stringify(item));
  const transact = (operation) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  if (!db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
    transact(() => {
      const state = initialState();
      for (const collection of collections)
        for (const item of state[collection]) put(collection, item);
      for (const item of state.activities)
        saveActivity.run(item.id, item.text, item.type, item.createdAt);
      db.prepare(
        "INSERT INTO metadata(key, value) VALUES ('seeded', '1')",
      ).run();
    });
  }

  function readState(limit = 50) {
    const state = Object.fromEntries(
      collections.map((collection) => [collection, list(collection)]),
    );
    state.activities = db
      .prepare(
        "SELECT id, text, type, created_at AS createdAt FROM activities ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(limit);
    return state;
  }
  function saveState(state) {
    for (const collection of collections) {
      db.prepare("DELETE FROM records WHERE collection = ?").run(collection);
      for (const item of state[collection]) put(collection, item);
    }
    db.exec("DELETE FROM activities");
    for (const activity of [...state.activities].reverse())
      saveActivity.run(
        activity.id,
        activity.text,
        activity.type,
        activity.createdAt,
      );
  }
  async function serveStatic(request, response, decodedPath) {
    const base = resolve(distPath);
    let filename = resolve(base, `.${decodedPath}`);
    const isInside = (path) => {
      const rel = relative(base, path);
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    };
    if (!isInside(filename)) throw new HttpError(403, "Caminho não permitido.");
    try {
      const info = await stat(filename);
      if (info.isDirectory()) filename = resolve(filename, "index.html");
      const physical = await realpath(filename);
      if (!isInside(physical))
        throw new HttpError(403, "Caminho não permitido.");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      if (extname(decodedPath))
        throw new HttpError(404, "Arquivo não encontrado.");
      filename = resolve(base, "index.html");
    }
    let content;
    try {
      content = await readFile(filename);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR")
        throw new HttpError(
          404,
          "Interface indisponível. Execute npm run build no diretório do CRM.",
        );
      throw error;
    }
    response.writeHead(200, {
      "content-type":
        mimeTypes[extname(filename)] || "application/octet-stream",
      "content-length": content.length,
      "cache-control": decodedPath.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  }

  const server = createServer(async (request, response) => {
    try {
      const path = parsePath(request);
      if (path === "/api/config" && request.method === "GET")
        return sendJson(response, 200, {
          storage: "sqlite",
          authRequired: false,
          configured: true,
        });
      if (path === "/api/health" && request.method === "GET")
        return sendJson(response, 200, { status: "ok", database: "sqlite" });
      if (path === "/api/access" && request.method === "GET")
        return sendJson(response, 200, developmentAccess());
      if (isSuitePublicPath(path))
        return await handleSuitePublicRequest({
          path,
          request,
          response,
          database: suiteDatabase,
        });
      if (isWebchatPublicPath(path))
        return await handleWebchatPublicRequest({
          path,
          request,
          response,
          database: webchatDatabase,
        });
      if (isSuitePath(path))
        return await handleSuiteRequest({
          path,
          request,
          response,
          access: developmentAccess(),
          database: suiteDatabase,
        });
      if (isCopilotPath(path))
        return await handleCopilotRequest({
          path,
          request,
          response,
          access: developmentAccess(),
        });
      if (isCollaborationExtraPath(path)) {
        if (
          await extra.handleUpload({
            path,
            request,
            response,
            access: developmentAccess(),
          })
        )
          return;
        return await handleExtraRequest({
          path,
          request,
          response,
          access: developmentAccess(),
          database: extra.database,
          signPath: extra.signPath,
          removeFile: extra.removeFile,
        });
      }
      if (isPersonalizationPath(path)) {
        if (await personalization.handleMedia({ path, request, response }))
          return;
        await handlePersonalizationRequest({
          path,
          request,
          response,
          user: personalization.user(),
          access: developmentAccess(),
          remote: personalization.remote,
          database: personalization.database,
          signPath: personalization.signPath,
        });
        return;
      }
      if (isCollaborationPath(path)) {
        await handleCollaborationRequest({
          path,
          request,
          response,
          access: developmentAccess(),
          database: collaborationDatabase,
        });
        return;
      }
      if (path === "/api/state" && request.method === "GET")
        return sendJson(response, 200, readState());
      const exportMatch =
        /^\/api\/export\/(companies|contacts|deals|tasks)$/.exec(path);
      if (exportMatch && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition":
            'attachment; filename="vox-crm-' + exportMatch[1] + '.csv"',
          "x-content-type-options": "nosniff",
        });
        return response.end(csvData(readState()[exportMatch[1]]));
      }
      if (path === "/api/members" || path.startsWith("/api/profiles/"))
        throw new HttpError(
          409,
          "A gestão de usuários e permissões está disponível no modo Supabase.",
        );
      if (path.startsWith("/api/")) {
        const mutation = parseMutation(path, request.method);
        const body = request.method === "DELETE" ? {} : await readBody(request);
        const result = transact(() => {
          const previous = readState(100);
          const result = applyMutation(previous, mutation, body);
          saveState(result.state);
          if (mutation.collection === "deals" && mutation.method !== "DELETE")
            runLocalSuiteAutomations(db, {
              before: previous.deals.find((item) => item.id === mutation.id),
              after: result.state.deals.find(
                (item) => item.id === (mutation.id || result.result?.id),
              ),
            });
          return result;
        });
        return sendJson(response, result.status, result.result);
      }
      if (!["GET", "HEAD"].includes(request.method))
        throw new HttpError(405, "Método não permitido.");
      await serveStatic(request, response, path);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error("Erro interno no CRM.");
      if (!response.headersSent)
        sendJson(response, error instanceof HttpError ? error.status : 500, {
          error:
            error instanceof HttpError
              ? error.message
              : "Não foi possível concluir a operação.",
        });
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  let closed = false;
  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      if (server.listening)
        await new Promise((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      db.close();
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT deve ser um número entre 1 e 65535.");
  const host = process.env.HOST || "127.0.0.1";
  const app = createApp();
  app.server.listen(port, host, () =>
    console.log(
      `Vox CRM iniciado na porta ${port}. Dados persistidos em SQLite.`,
    ),
  );
  app.server.on("error", (error) => {
    console.error("Não foi possível iniciar o Vox CRM:", error.message);
    app.close().catch(console.error);
    process.exitCode = 1;
  });
  const stop = () =>
    app.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
