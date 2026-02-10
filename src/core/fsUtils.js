import fs from "node:fs/promises";
import path from "node:path";

export function resolveInWorkspace(targetPath, workspaceRoot = process.cwd()) {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, targetPath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }

  return resolved;
}

export async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function isJsonString(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
