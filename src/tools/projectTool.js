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

const MAX_DIFF_LINES = 220;
const MAX_DIFF_CHARS = 16000;

function normalizeSafeRelativePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").trim();

  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`Invalid relative path: ${relativePath}`);
  }

  return normalized;
}

function isTextFilePath(filePath) {
  const baseName = path.basename(String(filePath || ""));
  const extension = path.extname(baseName).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || baseName.startsWith(".env") || baseName === ".gitignore";
}

function clipDiff(diffText) {
  if (!diffText) {
    return "";
  }

  const text = String(diffText);
  if (text.length <= MAX_DIFF_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_DIFF_CHARS)}\n...diff truncated`;
}

function buildUnifiedDiff(relativePath, beforeContent, afterContent) {
  const beforeLines = String(beforeContent ?? "").replace(/\r\n/g, "\n").split("\n");
  const afterLines = String(afterContent ?? "").replace(/\r\n/g, "\n").split("\n");

  if (beforeLines.length === 1 && beforeLines[0] === "" && afterLines.length === 1 && afterLines[0] === "") {
    return "";
  }

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforeChunk = beforeLines.slice(prefix, beforeLines.length - suffix);
  const afterChunk = afterLines.slice(prefix, afterLines.length - suffix);
  const chunkFrom = prefix + 1;
  const beforeCount = beforeChunk.length;
  const afterCount = afterChunk.length;

  const lines = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${chunkFrom},${beforeCount} +${chunkFrom},${afterCount} @@`
  ];

  for (const line of beforeChunk) {
    lines.push(`-${line}`);
  }

  for (const line of afterChunk) {
    lines.push(`+${line}`);
  }

  let output = lines;
  if (output.length > MAX_DIFF_LINES) {
    output = output.slice(0, MAX_DIFF_LINES);
    output.push("...diff lines truncated");
  }

  return clipDiff(output.join("\n"));
}

async function readTextFileContent(filePath) {
  if (!isTextFilePath(filePath)) {
    return null;
  }

  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function snapshotTextFiles(rootPath) {
  const snapshot = new Map();
  if (!(await pathExists(rootPath))) {
    return snapshot;
  }

  const files = await listTextFilesRecursive(rootPath);
  for (const filePath of files) {
    const relativePath = path.relative(rootPath, filePath).replace(/\\/g, "/");
    const content = await readTextFileContent(filePath);
    if (content !== null) {
      snapshot.set(relativePath, content);
    }
  }

  return snapshot;
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
  const beforeSnapshot = overwrite ? await snapshotTextFiles(projectPath) : new Map();

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

  const afterSnapshot = await snapshotTextFiles(projectPath);
  const changes = [];

  for (const [relativePath, afterContent] of afterSnapshot.entries()) {
    const beforeContent = beforeSnapshot.has(relativePath) ? beforeSnapshot.get(relativePath) : "";
    const status = beforeSnapshot.has(relativePath) ? "modified" : "added";
    changes.push({
      path: relativePath,
      status,
      diff: buildUnifiedDiff(relativePath, beforeContent, afterContent)
    });
  }

  return {
    mode: "scaffold",
    template,
    name,
    projectPath,
    changes
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

  const maxFiles = Math.max(1, Math.min(40, Number(input.maxFiles) || 15));

  // --- PASS 1: Get file plan (list of files with brief descriptions) ---
  const planResponse = await provider.complete({
    systemPrompt:
      "You are a project architect. Return ONLY a JSON array of file paths needed for the project. Example: [\"src/index.js\",\"package.json\",\"README.md\"]. No markdown, no explanation. Array only.",
    messages: [
      {
        role: "user",
        content: `Project: ${name}\nGoal: ${prompt}\nList up to ${maxFiles} file paths needed. Return JSON array only.`
      }
    ],
    temperature: 0.1,
    maxTokens: 1000
  });

  let filePlan = [];
  try {
    const planText = extractJsonBlock(planResponse);
    const parsed = JSON.parse(planText);
    if (Array.isArray(parsed)) {
      filePlan = parsed.filter(f => typeof f === "string" && f.trim()).slice(0, maxFiles);
    } else if (parsed?.files && Array.isArray(parsed.files)) {
      filePlan = parsed.files.map(f => typeof f === "string" ? f : f?.path || "").filter(Boolean).slice(0, maxFiles);
    }
  } catch {
    // Fallback: generate everything in one shot
    filePlan = [];
  }

  const createdFiles = [];
  const changes = [];

  if (filePlan.length === 0) {
    // Fallback: single-shot generation (original behaviour)
    const rawResponse = await provider.complete({
      systemPrompt:
        "You generate complete runnable project files. Output strict JSON only: {\"files\":[{\"path\":\"relative/path\",\"content\":\"file content\"}]}. Include FULL file content, not stubs. No markdown outside JSON.",
      messages: [
        { role: "user", content: `Project: ${name}\nGoal: ${prompt}\nGenerate up to ${maxFiles} complete files with full content.` }
      ],
      temperature: 0.2,
      maxTokens: 8000
    });

    const jsonPayload = extractJsonBlock(rawResponse);
    const parsed = JSON.parse(jsonPayload);

    if (!parsed?.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
      throw new Error("Model did not return any files");
    }

    for (const item of parsed.files.slice(0, maxFiles)) {
      const relativePath = normalizeSafeRelativePath(String(item.path || ""));
      const content = String(item.content || "");
      const absolutePath = path.join(projectPath, relativePath);
      const previousContent = (await readTextFileContent(absolutePath)) ?? "";
      const existedBefore = await pathExists(absolutePath);
      await ensureDirForFile(absolutePath);
      await fs.writeFile(absolutePath, content, "utf8");
      createdFiles.push(relativePath);
      changes.push({
        path: relativePath,
        status: existedBefore ? "modified" : "added",
        diff: buildUnifiedDiff(relativePath, previousContent, content)
      });
    }
  } else {
    // --- PASS 2: Generate each file individually for full content ---
    for (const filePath of filePlan) {
      let relativePath;
      try {
        relativePath = normalizeSafeRelativePath(String(filePath));
      } catch {
        continue;
      }

      const fileResponse = await provider.complete({
        systemPrompt:
          "You write a single source file. Return ONLY the raw file content — no JSON wrapper, no markdown fences, no explanation. Just the file content exactly as it should be saved.",
        messages: [
          {
            role: "user",
            content: [
              `Project: ${name}`,
              `Goal: ${prompt}`,
              `Write the complete content for: ${relativePath}`,
              `Files in this project: ${filePlan.join(", ")}`,
              `Already created: ${createdFiles.join(", ") || "(none yet)"}`,
              "Return ONLY the file content. No explanation."
            ].join("\n")
          }
        ],
        temperature: 0.15,
        maxTokens: 6000
      });

      // Strip markdown fences if model couldn't help itself
      let content = String(fileResponse || "").trim();
      const fenceMatch = content.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
      if (fenceMatch) {
        content = fenceMatch[1];
      }

      const absolutePath = path.join(projectPath, relativePath);
      const previousContent = (await readTextFileContent(absolutePath)) ?? "";
      const existedBefore = await pathExists(absolutePath);
      await ensureDirForFile(absolutePath);
      await fs.writeFile(absolutePath, content, "utf8");

      createdFiles.push(relativePath);
      changes.push({
        path: relativePath,
        status: existedBefore ? "modified" : "added",
        diff: buildUnifiedDiff(relativePath, previousContent, content)
      });
    }
  }

  return {
    mode: "generate",
    name,
    projectPath,
    createdFiles,
    changes
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

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON file: ${filePath} (${error.message})`);
  }
}

async function linkProject(input = {}) {
  const projectPath = resolveProjectRoot(input);
  if (!(await pathExists(projectPath))) {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  const packageJsonPath = path.join(projectPath, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    throw new Error(`npm link requires package.json at project root: ${projectPath}`);
  }

  const packageJson = await readJsonFile(packageJsonPath);
  const packageName = String(input.packageName || packageJson?.name || "").trim();
  if (!packageName) {
    throw new Error("Could not resolve package name. Provide input.packageName or set package.json name.");
  }

  const runGlobalLink = input.global !== false;
  const linkToPath = input.linkTo ? path.resolve(String(input.linkTo)) : "";
  const checks = [];

  if (runGlobalLink) {
    checks.push(await runCommandCheck("npm", ["link"], projectPath));
  }

  if (linkToPath) {
    if (!(await pathExists(linkToPath))) {
      throw new Error(`linkTo path not found: ${linkToPath}`);
    }

    checks.push(await runCommandCheck("npm", ["link", packageName], linkToPath));
  }

  if (!checks.length) {
    return {
      mode: "link",
      ok: true,
      projectPath,
      packageName,
      linkTo: linkToPath || undefined,
      checks: [],
      note: "No npm link command executed (set global=true and/or linkTo)."
    };
  }

  return {
    mode: "link",
    ok: checks.every((check) => check.ok),
    projectPath,
    packageName,
    linkTo: linkToPath || undefined,
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
  const changes = [];

  for (const item of files) {
    const relativePath = normalizeSafeRelativePath(String(item.path || ""));
    const absolutePath = path.join(projectPath, relativePath);

    if (!ensurePathInside(projectPath, absolutePath)) {
      throw new Error(`Invalid project write path: ${relativePath}`);
    }

    const content = String(item.content || "");
    const append = Boolean(item.append || input.append);
    const existedBefore = await pathExists(absolutePath);
    const beforeContent = (await readTextFileContent(absolutePath)) ?? "";
    const afterContent = append ? `${beforeContent}${content}` : content;

    await ensureDirForFile(absolutePath);
    if (append) {
      await fs.appendFile(absolutePath, content, "utf8");
    } else {
      await fs.writeFile(absolutePath, content, "utf8");
    }

    writtenFiles.push(relativePath);
    const changed = beforeContent !== afterContent || !existedBefore;
    changes.push({
      path: relativePath,
      status: !existedBefore ? "added" : changed ? "modified" : "unchanged",
      diff: changed ? buildUnifiedDiff(relativePath, beforeContent, afterContent) : "",
      append
    });
  }

  return {
    mode: "write",
    projectPath,
    writtenFiles,
    changes
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
  const changes = [];

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

    const changed = nextContent !== currentContent;
    editedFiles.push({
      path: relativePath,
      changed,
      replacements
    });

    changes.push({
      path: relativePath,
      status: changed ? "modified" : "unchanged",
      diff: changed ? buildUnifiedDiff(relativePath, currentContent, nextContent) : "",
      replacements
    });
  }

  return {
    mode: "edit",
    projectPath,
    editedFiles,
    changes
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
  const changes = [];

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

    if (stat.isDirectory()) {
      const nestedFiles = await listTextFilesRecursive(absolutePath);
      for (const nestedFile of nestedFiles) {
        const nestedRelativePath = path.relative(projectPath, nestedFile).replace(/\\/g, "/");
        const content = (await readTextFileContent(nestedFile)) ?? "";
        changes.push({
          path: nestedRelativePath,
          status: "deleted",
          diff: buildUnifiedDiff(nestedRelativePath, content, "")
        });
      }
    } else {
      const content = (await readTextFileContent(absolutePath)) ?? "";
      changes.push({
        path: relativePath,
        status: "deleted",
        diff: buildUnifiedDiff(relativePath, content, "")
      });
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
    missingPaths,
    changes
  };
}

async function readProjectFile(input = {}) {
  const projectPath = resolveProjectRoot(input);
  const relativePath = String(input.path || input.file || "").trim();
  if (!relativePath) {
    throw new Error("project readFile requires 'path'");
  }

  const absolutePath = path.join(projectPath, relativePath);
  if (!ensurePathInside(projectPath, absolutePath)) {
    throw new Error(`Invalid read path: ${relativePath}`);
  }

  if (!(await pathExists(absolutePath))) {
    return { mode: "readFile", path: relativePath, exists: false, content: null };
  }

  const MAX_READ = 12000;
  const content = await fs.readFile(absolutePath, "utf8");
  const truncated = content.length > MAX_READ;

  return {
    mode: "readFile",
    projectPath,
    path: relativePath,
    exists: true,
    truncated,
    content: truncated ? content.slice(0, MAX_READ) + "\n...[truncated]" : content
  };
}

async function inspectProject(input = {}) {
  const projectPath = resolveProjectRoot(input);
  if (!(await pathExists(projectPath))) {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  const files = await listTextFilesRecursive(projectPath);
  const structure = [];

  // Limit inspection to first 50 files to avoid massive output
  const MAX_INSPECT_FILES = 50;

  for (const filePath of files.slice(0, MAX_INSPECT_FILES)) {
    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, "/");

    let contentSnippet = "";
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (content.length < 2000) {
        contentSnippet = content;
      } else {
        contentSnippet = content.slice(0, 1000) + "\n...[truncated]";
      }
    } catch {
      contentSnippet = "[Error reading file]";
    }

    structure.push({
      path: relativePath,
      content: contentSnippet
    });
  }

  return {
    mode: "inspect",
    projectPath,
    totalFiles: files.length,
    structure
  };
}

export async function runProjectTask(input = {}, context = {}) {
  let mode = input.mode;

  // Infer mode if missing but clear intent signals exist
  if (!mode) {
    if (input.template) {
      mode = "scaffold";
    } else if (input.prompt) {
      mode = "generate";
    } else if (input.files || (input.path && input.content)) {
      mode = "write";
    } else if (input.edits || (input.path && input.find && input.replace)) {
      mode = "edit";
    } else if (input.paths && Array.isArray(input.paths)) {
      mode = "delete";
    } else if (input.linkTo || input.packageName) {
      mode = "link";
    } else if (input.path && !input.content) {
      mode = "readFile";
    } else if (input.projectPath || (input.targetDir && input.name)) {
      mode = "inspect";
    } else {
      mode = "list";
    }
  }

  if (mode === "list") {
    if (input.projectPath || (input.targetDir && input.name)) {
      return inspectProject(input);
    }
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
        createdFiles: output.writtenFiles,
        changes: output.changes || []
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

  if (mode === "link") {
    return linkProject(input);
  }

  if (mode === "inspect") {
    return inspectProject(input);
  }

  if (mode === "readFile" || mode === "read") {
    return readProjectFile(input);
  }

  throw new Error(`Unsupported project mode: ${mode}`);
}

export const projectTool = {
  name: "project",
  description:
    "Proje olusturur, duzenler, okur ve test eder. Modlar: list, scaffold, generate(AI ile 2-pass tam dosya uretimi), write(dosya yaz), edit(find/replace ile duzenle), delete, probe, test, link, inspect, readFile. PROJE YARATMA KURALI: Kucuk basit projeler icin generate kullan (AI otomatik plan+dosya yaratir). Buyuk projeler icin: once write ile her dosyayi ayri ayri yaz. readFile modu: { mode:'readFile', projectPath, path:'src/index.js' }. edit modu: { mode:'edit', projectPath, path:'dosya.js', find:'eski', replace:'yeni' }. Input: { mode, ... }",
  async run(input, context) {
    return runProjectTask(input, context);
  }
};
