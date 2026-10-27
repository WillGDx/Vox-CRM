import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL(".", import.meta.url));
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}

for (const [name, args, env] of [
  ["API", ["server.mjs"], { ...process.env, PORT: "3000", HOST: "127.0.0.1" }],
  ["Interface", ["node_modules/vite/bin/vite.js"], process.env],
]) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${name}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} encerrou${signal ? ` (${signal})` : ""}.`);
      stop(code || 1);
    }
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
