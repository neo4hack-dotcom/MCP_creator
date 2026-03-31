import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, "..");

function buildCandidates() {
  const envPython = process.env.PYTHON_BIN?.trim();
  const candidates = [];

  if (envPython) {
    candidates.push({ command: envPython, args: [] });
  }

  const venvCandidates =
    process.platform === "win32"
      ? [
          path.join(projectRoot, ".venv", "Scripts", "python.exe"),
          path.join(projectRoot, "venv", "Scripts", "python.exe")
        ]
      : [
          path.join(projectRoot, ".venv", "bin", "python"),
          path.join(projectRoot, "venv", "bin", "python")
        ];

  for (const candidate of venvCandidates) {
    if (existsSync(candidate)) {
      candidates.push({ command: candidate, args: [] });
    }
  }

  if (process.platform === "win32") {
    candidates.push(
      { command: "py", args: ["-3"] },
      { command: "python", args: [] },
      { command: "python3", args: [] }
    );
  } else {
    candidates.push(
      { command: "python3", args: [] },
      { command: "python", args: [] },
      { command: "py", args: ["-3"] }
    );
  }

  return candidates;
}

export function resolvePythonRuntime() {
  for (const candidate of buildCandidates()) {
    const result = spawnSync(candidate.command, [...candidate.args, "-c", "import sys"], {
      cwd: projectRoot,
      stdio: "ignore"
    });

    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "No Python runtime found. Install Python 3 or set PYTHON_BIN to your interpreter path."
  );
}

export function resolveVenvPython() {
  const relativePath =
    process.platform === "win32"
      ? path.join(".venv", "Scripts", "python.exe")
      : path.join(".venv", "bin", "python");

  return path.join(projectRoot, relativePath);
}

