import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ensureDirForFile, pathExists } from "../core/fsUtils.js";

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".toml",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".env",
  ".html",
  ".css",
  ".gitignore"
]);

function normalizeSafeRelativePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").trim();

  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`Invalid relative path: ${relativePath}`);
  }

  return normalized;
}

function resolveProjectRoot(input = {}) {
  if (input.projectPath) {
    const resolvedPath = path.resolve(String(input.projectPath));
    const name = input.name ? String(input.name).trim() : "";
    if (name && path.basename(resolvedPath) !== name) {
      return path.join(resolvedPath, name);
    }

    return resolvedPath;
  }

  const targetBase = path.resolve(process.cwd(), input.targetDir || ".");
  if (input.name) {
    return path.join(targetBase, String(input.name));
  }

  return targetBase;
}

function ensurePathInside(basePath, targetPath) {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);

  const normalizedBase = process.platform === "win32" ? base.toLowerCase() : base;
  const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;

  if (normalizedTarget === normalizedBase) {
    return true;
  }

  const withSep = normalizedBase.endsWith(path.sep) ? normalizedBase : `${normalizedBase}${path.sep}`;
  return normalizedTarget.startsWith(withSep);
}

function resolveProjectLocation(input = {}) {
  const explicitProjectPath = input.projectPath ? path.resolve(String(input.projectPath)) : "";
  const explicitTargetDir = input.targetDir ? path.resolve(process.cwd(), String(input.targetDir)) : "";
  const rawName = input.name ? String(input.name).trim() : "";

  if (explicitProjectPath) {
    const pathBaseName = path.basename(explicitProjectPath);
    const treatAsBaseDir = Boolean(rawName && rawName !== pathBaseName);
    const projectPath = treatAsBaseDir ? path.join(explicitProjectPath, rawName) : explicitProjectPath;
    const name = rawName || path.basename(projectPath);
    const targetBase = path.dirname(projectPath);
    return {
      targetBase,
      name,
      projectPath
    };
  }

  const targetBase = explicitTargetDir || path.resolve(process.cwd(), ".");
  const name = rawName;
  const projectPath = name ? path.join(targetBase, name) : targetBase;

  return {
    targetBase,
    name,
    projectPath
  };
}

function extractJsonBlock(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Model response is empty");
  }

  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const firstCurly = rawText.indexOf("{");
  const lastCurly = rawText.lastIndexOf("}");

  if (firstCurly >= 0 && lastCurly > firstCurly) {
    return rawText.slice(firstCurly, lastCurly + 1);
  }

  return rawText.trim();
}

async function listTextFilesRecursive(rootPath) {
  const files = [];

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const extension = path.extname(entry.name);
      const isDotEnv = entry.name.startsWith(".env");

      if (TEXT_EXTENSIONS.has(extension) || isDotEnv || entry.name === ".gitignore") {
        files.push(fullPath);
      }
    }
  }

  await walk(rootPath);
  return files;
}

async function applyTokens(rootPath, tokens) {
  const files = await listTextFilesRecursive(rootPath);

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");

    let nextContent = content;
    for (const [key, value] of Object.entries(tokens)) {
      nextContent = nextContent.replaceAll(key, value);
    }

    if (nextContent !== content) {
      await fs.writeFile(filePath, nextContent, "utf8");
    }
  }
}

function getTemplatesRoot() {
  return path.resolve(process.cwd(), "templates");
}

async function getTemplatePath(templateName) {
  const templatePath = path.join(getTemplatesRoot(), templateName);

  if (!(await pathExists(templatePath))) {
    throw new Error(`Template not found: ${templateName}`);
  }

  return templatePath;
}

async function listTemplates() {
  const templatesRoot = getTemplatesRoot();

  if (!(await pathExists(templatesRoot))) {
    return [];
  }

  const entries = await fs.readdir(templatesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function scaffoldProject(input = {}) {
  const template = input.template;
  const location = resolveProjectLocation(input);
  const name = location.name;

  if (!template) {
    throw new Error("project scaffold requires 'template'");
  }

  if (!name) {
    throw new Error("project scaffold requires 'name'");
  }

  const templatePath = await getTemplatePath(template);
  const targetBase = location.targetBase;
  const projectPath = location.projectPath;
  const overwrite = Boolean(input.overwrite);

  if ((await pathExists(projectPath)) && !overwrite) {
    throw new Error(`Target already exists: ${projectPath}. Use overwrite=true to replace.`);
  }

  await fs.mkdir(targetBase, { recursive: true });
  await fs.cp(templatePath, projectPath, {
    recursive: true,
    force: overwrite
  });

  await applyTokens(projectPath, {
    "{{PROJECT_NAME}}": name,
    "{{PROJECT_DESCRIPTION}}": input.description || `${name} generated by kaesra-agent`
  });

  return {
    mode: "scaffold",
    template,
    name,
    projectPath
  };
}

async function generateProject(input = {}, context = {}) {
  const location = resolveProjectLocation(input);
  const name = location.name;
  const prompt = input.prompt;
  const provider = context.provider;

  if (!provider) {
    throw new Error("Project generate mode needs an AI provider");
  }

  if (!name || !prompt) {
    throw new Error("project generate requires 'name' and 'prompt'");
  }

  const projectPath = location.projectPath;
  const overwrite = Boolean(input.overwrite);

  if ((await pathExists(projectPath)) && !overwrite) {
    throw new Error(`Target already exists: ${projectPath}. Use overwrite=true to replace.`);
  }

  await fs.mkdir(projectPath, { recursive: true });

  const rawResponse = await provider.complete({
    systemPrompt:
      "You generate project files. Output strict JSON only with shape: {\"files\":[{\"path\":\"relative/path\",\"content\":\"file content\"}]}. No markdown. Keep files minimal and runnable.",
    messages: [
      {
        role: "user",
        content: `Project name: ${name}\nGoal: ${prompt}\nGenerate up to ${(Number(input.maxFiles) || 12)} files.`
      }
    ],
    temperature: 0.2,
    maxTokens: 3500
  });

  const jsonPayload = extractJsonBlock(rawResponse);
  let parsed;

  try {
    parsed = JSON.parse(jsonPayload);
  } catch (error) {
    throw new Error(`Model returned invalid JSON for generated project: ${error.message}`);
  }

  if (!parsed?.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("Model did not return any files");
  }

  const maxFiles = Math.max(1, Math.min(80, Number(input.maxFiles) || 12));
  const createdFiles = [];

  for (const item of parsed.files.slice(0, maxFiles)) {
    const relativePath = normalizeSafeRelativePath(String(item.path || ""));
    const content = String(item.content || "");

    const absolutePath = path.join(projectPath, relativePath);
    await ensureDirForFile(absolutePath);
    await fs.writeFile(absolutePath, content, "utf8");

    createdFiles.push(relativePath);
  }

  return {
    mode: "generate",
    name,
    projectPath,
    createdFiles
  };
}

async function probeProjectPath(input = {}) {
  const probePath = input.path ? path.resolve(String(input.path)) : resolveProjectRoot(input);

  try {
    const stat = await fs.stat(probePath);
    return {
      mode: "probe",
      path: probePath,
      exists: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile()
    };
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return {
        mode: "probe",
        path: probePath,
        exists: false
      };
    }

    throw error;
  }
}

function toErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return String(error);
}

async function runCommandCheck(command, args, cwd) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    return {
      ok: true,
      command: [command, ...args].join(" "),
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim()
    };
  } catch (error) {
    return {
      ok: false,
      command: [command, ...args].join(" "),
      error: toErrorMessage(error),
      stdout: String(error?.stdout || "").trim(),
      stderr: String(error?.stderr || "").trim()
    };
  }
}

async function runShellCommandCheck(command, cwd, stdinText = "") {
  const shell = process.platform === "win32" ? "cmd.exe" : "sh";
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];

  return new Promise((resolve) => {
    const child = spawn(shell, shellArgs, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;

    const timeoutMs = 120000;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        command,
        error: `Command timed out after ${timeoutMs}ms`,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim()
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        command,
        error: toErrorMessage(error),
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim()
      });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      resolve({
        ok: code === 0,
        command,
        code: Number(code ?? -1),
        stdout,
        stderr
      });
    });

    if (stdinText) {
      child.stdin.write(String(stdinText));
    }
    child.stdin.end();
  });
}

async function detectProjectEntry(projectPath, preferredEntry) {
  if (preferredEntry) {
    return String(preferredEntry).replace(/\\/g, "/");
  }

  const candidates = ["main.py", "src/main.py", "bin/cli.js", "src/index.js", "index.js"];
  for (const relativePath of candidates) {
    if (await pathExists(path.join(projectPath, relativePath))) {
      return relativePath;
    }
  }

  return "";
}

async function testProject(input = {}) {
  const projectPath = resolveProjectRoot(input);
  if (!(await pathExists(projectPath))) {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  const entry = await detectProjectEntry(projectPath, input.entry);
  if (!entry) {
    throw new Error(
      "Could not detect entry file. Provide input.entry (e.g. main.py or src/index.js) for project test mode."
    );
  }

  const checks = [];
  const absoluteEntry = path.join(projectPath, entry);
  const extension = path.extname(entry).toLowerCase();

  if (extension === ".py") {
    checks.push(await runCommandCheck("python", ["-m", "py_compile", absoluteEntry], projectPath));

    const testsDir = path.join(projectPath, "tests");
    if (await pathExists(testsDir)) {
      const pytestProbe = await runCommandCheck("python", ["-c", "import pytest"], projectPath);
      if (pytestProbe.ok) {
        checks.push(await runCommandCheck("python", ["-m", "pytest", "-q"], projectPath));
      } else {
        checks.push(await runCommandCheck("python", ["-m", "unittest", "discover", "-s", "tests"], projectPath));
      }
    }
  } else if ([".js", ".mjs", ".cjs"].includes(extension)) {
    checks.push(await runCommandCheck("node", ["--check", absoluteEntry], projectPath));
  } else {
    checks.push({
      ok: false,
      command: `unsupported-entry:${entry}`,
      error: `Unsupported entry extension for test mode: ${extension || "(none)"}`
    });
  }

  const commandText = String(input.command || "").trim();
  if (commandText) {
    checks.push(await runShellCommandCheck(commandText, projectPath, input.input || ""));
  }

  return {
    mode: "test",
    projectPath,
    entry,
    ok: checks.every((check) => check.ok),
    checks
  };
}

async function writeProjectFiles(input = {}) {
  const projectPath = resolveProjectRoot(input);
  const rootExists = await pathExists(projectPath);

  if (!rootExists && input.createRoot !== false) {
    await fs.mkdir(projectPath, { recursive: true });
  }

  const files =
    Array.isArray(input.files) && input.files.length > 0
      ? input.files
      : input.files && typeof input.files === "object" && !Array.isArray(input.files)
        ? Object.entries(input.files).map(([filePath, content]) => ({
            path: String(filePath),
            content: String(content ?? ""),
            append: Boolean(input.append)
          }))
        : input.path
          ? [
              {
                path: input.path,
                content: input.content || "",
                append: Boolean(input.append)
              }
            ]
          : [];

  if (!files.length) {
    throw new Error("project write requires 'files' array or 'path' + 'content'");
  }

  const writtenFiles = [];

  for (const item of files) {
    const relativePath = normalizeSafeRelativePath(String(item.path || ""));
    const absolutePath = path.join(projectPath, relativePath);

    if (!ensurePathInside(projectPath, absolutePath)) {
      throw new Error(`Invalid project write path: ${relativePath}`);
    }

    const content = String(item.content || "");
    const append = Boolean(item.append || input.append);

    await ensureDirForFile(absolutePath);
    if (append) {
      await fs.appendFile(absolutePath, content, "utf8");
    } else {
      await fs.writeFile(absolutePath, content, "utf8");
    }

    writtenFiles.push(relativePath);
  }

  return {
    mode: "write",
    projectPath,
    writtenFiles
  };
}

async function editProjectFiles(input = {}) {
  const projectPath = resolveProjectRoot(input);
  if (!(await pathExists(projectPath))) {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  const edits =
    Array.isArray(input.edits) && input.edits.length > 0
      ? input.edits
      : input.path
        ? [
            {
              path: input.path,
              find: input.find,
              replace: input.replace,
              replaceAll: input.replaceAll,
              content: input.content
            }
          ]
        : [];

  if (!edits.length) {
    throw new Error("project edit requires 'edits' array or 'path'");
  }

  const editedFiles = [];

  for (const item of edits) {
    const relativePath = normalizeSafeRelativePath(String(item.path || ""));
    const absolutePath = path.join(projectPath, relativePath);

    if (!ensurePathInside(projectPath, absolutePath)) {
      throw new Error(`Invalid project edit path: ${relativePath}`);
    }

    if (!(await pathExists(absolutePath))) {
      throw new Error(`Edit target does not exist: ${relativePath}`);
    }

    const currentContent = await fs.readFile(absolutePath, "utf8");
    let nextContent = currentContent;
    let replacements = 0;

    if (item.content !== undefined) {
      nextContent = String(item.content);
      replacements = currentContent === nextContent ? 0 : 1;
    } else {
      if (item.find === undefined) {
        throw new Error(`project edit requires 'find' or 'content' for path: ${relativePath}`);
      }

      const findText = String(item.find);
      const replaceText = String(item.replace || "");
      const replaceAll = item.replaceAll !== false;

      if (!findText) {
        throw new Error(`project edit requires non-empty 'find' for path: ${relativePath}`);
      }

      if (replaceAll) {
        const parts = currentContent.split(findText);
        replacements = Math.max(0, parts.length - 1);
        nextContent = parts.join(replaceText);
      } else {
        const index = currentContent.indexOf(findText);
        if (index >= 0) {
          replacements = 1;
          nextContent =
            currentContent.slice(0, index) +
            replaceText +
            currentContent.slice(index + findText.length);
        }
      }
    }

    if (nextContent !== currentContent) {
      await fs.writeFile(absolutePath, nextContent, "utf8");
    }

    editedFiles.push({
      path: relativePath,
      changed: nextContent !== currentContent,
      replacements
    });
  }

  return {
    mode: "edit",
    projectPath,
    editedFiles
  };
}

async function deleteProjectPaths(input = {}) {
  const projectPath = resolveProjectRoot(input);
  if (!(await pathExists(projectPath))) {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  const targets =
    Array.isArray(input.paths) && input.paths.length > 0
      ? input.paths
      : input.path
        ? [input.path]
        : [];

  if (!targets.length) {
    throw new Error("project delete requires 'paths' array or 'path'");
  }

  const recursive = input.recursive !== false;
  const force = input.force !== false;
  const deletedPaths = [];
  const missingPaths = [];

  for (const rawTarget of targets) {
    const relativePath = normalizeSafeRelativePath(String(rawTarget || ""));
    const absolutePath = path.join(projectPath, relativePath);

    if (!ensurePathInside(projectPath, absolutePath)) {
      throw new Error(`Invalid project delete path: ${relativePath}`);
    }

    if (!(await pathExists(absolutePath))) {
      missingPaths.push(relativePath);
      continue;
    }

    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory() && !recursive) {
      throw new Error(`Delete target is a directory. Set recursive=true: ${relativePath}`);
    }

    await fs.rm(absolutePath, {
      recursive,
      force
    });

    deletedPaths.push(relativePath);
  }

  return {
    mode: "delete",
    projectPath,
    deletedPaths,
    missingPaths
  };
}

export async function runProjectTask(input = {}, context = {}) {
  const mode = input.mode || "list";

  if (mode === "list") {
    return {
      mode,
      templates: await listTemplates()
    };
  }

  if (mode === "scaffold") {
    return scaffoldProject(input);
  }

  if (mode === "generate") {
    if (input.files) {
      const output = await writeProjectFiles(input);
      return {
        mode: "generate",
        projectPath: output.projectPath,
        createdFiles: output.writtenFiles
      };
    }

    return generateProject(input, context);
  }

  if (mode === "write") {
    return writeProjectFiles(input);
  }

  if (mode === "edit") {
    return editProjectFiles(input);
  }

  if (mode === "delete") {
    return deleteProjectPaths(input);
  }

  if (mode === "probe") {
    return probeProjectPath(input);
  }

  if (mode === "test") {
    return testProject(input);
  }

  throw new Error(`Unsupported project mode: ${mode}`);
}

export const projectTool = {
  name: "project",
  description:
    "Sablondan proje olusturur, AI ile proje dosyalari uretir, proje klasorunde write/edit/delete yapar, path probe yapar ve temel test calistirir. Input: { mode: list|scaffold|generate|write|edit|delete|probe|test, ... }",
  async run(input, context) {
    return runProjectTask(input, context);
  }
};
