import fs from "node:fs/promises";
import path from "node:path";
import { ensureDirForFile, pathExists, resolveInWorkspace } from "../core/fsUtils.js";

const MAX_READ_SIZE = 200_000;

async function listFilesRecursive(basePath, rootPath, results) {
  const entries = await fs.readdir(basePath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      await listFilesRecursive(fullPath, rootPath, results);
      continue;
    }

    const relativePath = path.relative(rootPath, fullPath);
    results.push(relativePath);
  }
}

export async function runFileTask(input = {}) {
  const action = input.action || "read";

  if (action === "read") {
    if (!input.path) {
      throw new Error("file read action requires 'path'");
    }

    const fullPath = resolveInWorkspace(input.path);
    const content = await fs.readFile(fullPath, "utf8");

    if (content.length > MAX_READ_SIZE) {
      return {
        action,
        path: input.path,
        truncated: true,
        content: content.slice(0, MAX_READ_SIZE)
      };
    }

    return {
      action,
      path: input.path,
      truncated: false,
      content
    };
  }

  if (action === "write") {
    if (!input.path) {
      throw new Error("file write action requires 'path'");
    }

    const content = String(input.content || "");
    const fullPath = resolveInWorkspace(input.path);
    await ensureDirForFile(fullPath);
    await fs.writeFile(fullPath, content, "utf8");

    return {
      action,
      path: input.path,
      bytes: Buffer.byteLength(content, "utf8")
    };
  }

  if (action === "append") {
    if (!input.path) {
      throw new Error("file append action requires 'path'");
    }

    const content = String(input.content || "");
    const fullPath = resolveInWorkspace(input.path);
    await ensureDirForFile(fullPath);
    await fs.appendFile(fullPath, content, "utf8");

    return {
      action,
      path: input.path,
      bytes: Buffer.byteLength(content, "utf8")
    };
  }

  if (action === "exists") {
    if (!input.path) {
      throw new Error("file exists action requires 'path'");
    }

    const fullPath = resolveInWorkspace(input.path);
    return {
      action,
      path: input.path,
      exists: await pathExists(fullPath)
    };
  }

  if (action === "list") {
    const relativePath = input.path || ".";
    const rootPath = resolveInWorkspace(relativePath);
    const results = [];
    await listFilesRecursive(rootPath, rootPath, results);

    return {
      action,
      path: relativePath,
      count: results.length,
      files: results.slice(0, 500)
    };
  }

  throw new Error(`Unsupported file action: ${action}`);
}

export const fileTool = {
  name: "file",
  description:
    "Workspace dosyalari uzerinde okuma/yazma/listeleme islemleri yapar. Input: { action: read|write|append|exists|list, path, content? }",
  async run(input) {
    return runFileTask(input);
  }
};
