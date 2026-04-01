import { spawn } from "node:child_process";

import { projectRoot, resolvePythonRuntime } from "./python-runtime.mjs";

const runtime = resolvePythonRuntime();
const host = process.env.API_HOST || "127.0.0.1";
const port = process.env.API_PORT || "8000";
const reloadEnabled = process.env.API_RELOAD !== "false";

const args = [
  ...runtime.args,
  "-m",
  "uvicorn",
  "server:app",
  "--host",
  host,
  "--port",
  port
];

if (reloadEnabled) {
  args.push("--reload");
}

const child = spawn(runtime.command, args, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`Failed to start FastAPI: ${error.message}`);
  console.error("Tip: run `npm run setup:python` first to create the virtualenv and install backend dependencies.");
  process.exit(1);
});
