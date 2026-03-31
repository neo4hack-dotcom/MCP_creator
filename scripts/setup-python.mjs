import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { projectRoot, resolvePythonRuntime, resolveVenvPython } from "./python-runtime.mjs";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

const runtime = resolvePythonRuntime();
const venvPython = resolveVenvPython();

if (!existsSync(venvPython)) {
  run(runtime.command, [...runtime.args, "-m", "venv", ".venv"]);
}

run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython, ["-m", "pip", "install", "-r", "backend/requirements.txt"]);

console.log(`Python environment is ready with ${venvPython}`);

