import { spawnSync } from "node:child_process";

import { projectRoot, resolvePythonRuntime } from "./python-runtime.mjs";

const runtime = resolvePythonRuntime();
const result = spawnSync(runtime.command, [...runtime.args, "-m", "compileall", "backend"], {
  cwd: projectRoot,
  stdio: "inherit"
});

if (result.error || result.status !== 0) {
  process.exit(result.status ?? 1);
}
