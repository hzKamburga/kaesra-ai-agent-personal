import path from "node:path";
import { buildSystemPrompt } from "./systemPrompt.js";

function clipText(value, limit = 12000) {
  if (!value) {
    return "";
  }

  const text = String(value);
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}\n...[truncated]`;
}

function normalizeErrorMessage(error) {
  if (!error) {
    return "Unknown tool error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function summarizeForActivity(value, limit = 240) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}...`;
}

function extractJson(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const firstCurly = candidate.indexOf("{");
    const lastCurly = candidate.lastIndexOf("}");

    if (firstCurly >= 0 && lastCurly > firstCurly) {
      try {
        return JSON.parse(candidate.slice(firstCurly, lastCurly + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractFirstJsonStringProperty(rawText, key) {
  if (!rawText || typeof rawText !== "string") {
    return "";
  }

  const match = rawText.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return match ? String(match[1] || "").trim() : "";
}

function extractFinalMessage(parsed) {
  if (!isPlainObject(parsed)) {
    return "";
  }

  if (typeof parsed.message === "string" && parsed.message.trim()) {
    return parsed.message.trim();
  }

  if (isPlainObject(parsed.input) && typeof parsed.input.message === "string" && parsed.input.message.trim()) {
    return parsed.input.message.trim();
  }

  return "";
}

function inferProjectTemplate(hint) {
  const value = String(hint || "").trim().toLowerCase();
  if (!value) {
    return "";
  }

  if (value.includes("python")) {
    return "python-cli";
  }

  if (value.includes("api") || value.includes("backend")) {
    return "node-api";
  }

  if (value.includes("node") || value.includes("javascript") || value === "js") {
    return "node-cli";
  }

  return "";
}

function buildProjectPrompt(input = {}) {
  const name = String(input.name || "project");
  const stack = String(input.stack || input.language || input.projectType || "").trim();
  const description = String(input.description || "").trim();
  const features = Array.isArray(input.features) ? input.features.map((item) => String(item)).filter(Boolean) : [];

  const lines = [
    `Build a complete runnable project named ${name}.`,
    stack ? `Stack: ${stack}.` : "",
    description ? `Goal: ${description}` : "",
    features.length ? `Features: ${features.join(", ")}` : "",
    "Write production-like source files plus tests.",
    "Prefer multiple focused files instead of a single large file."
  ].filter(Boolean);

  return lines.join("\n");
}

function normalizeProjectInput(input, options = {}) {
  const normalized = { ...input };

  if (!normalized.name && normalized.projectName) {
    normalized.name = normalized.projectName;
  }

  if (normalized.targetPath && !normalized.targetDir) {
    normalized.targetDir = normalized.targetPath;
  }

  if (normalized.action && !normalized.mode) {
    normalized.mode = normalized.action;
  }

  if (normalized.projectPath && !normalized.targetDir && !normalized.name) {
    const absoluteProjectPath = normalizeAbsolutePath(normalized.projectPath);
    if (absoluteProjectPath) {
      normalized.targetDir = path.dirname(absoluteProjectPath);
      normalized.name = path.basename(absoluteProjectPath);
    }
  }

  const templateHint =
    inferProjectTemplate(normalized.projectType) ||
    inferProjectTemplate(normalized.language) ||
    inferProjectTemplate(normalized.stack);

  if (!normalized.template && templateHint) {
    normalized.template = templateHint;
  }

  const templateName = String(normalized.template || "").trim().toLowerCase();
  const weakTemplates = new Set(["cli", "basic", "starter", "python", "node"]);
  const preferNoTemplate = Boolean(options.preferNoTemplate);
  const allowTemplateScaffold = Boolean(options.allowTemplateScaffold);

  if (normalized.mode === "scaffold" && (preferNoTemplate || weakTemplates.has(templateName)) && !allowTemplateScaffold) {
    normalized.mode = "generate";
  }

  // Fallback: if scaffold is requested without a known template, switch to generate.
  if (normalized.mode === "scaffold" && !normalized.template) {
    normalized.mode = "generate";
  }

  if (normalized.mode === "generate" && !normalized.prompt) {
    normalized.prompt = buildProjectPrompt(normalized);
  }

  // Legacy recovery: some models return mode=generate with prebuilt files payload.
  if (normalized.mode === "generate" && normalized.files) {
    normalized.mode = "write";
  }

  if (normalized.mode === "write" && normalized.files && !Array.isArray(normalized.files) && isPlainObject(normalized.files)) {
    normalized.files = Object.entries(normalized.files).map(([filePath, content]) => ({
      path: String(filePath),
      content: String(content ?? "")
    }));
  }

  delete normalized.targetPath;
  delete normalized.projectName;
  return normalized;
}

function extractRootInput(parsed) {
  if (!isPlainObject(parsed)) {
    return {};
  }

  if (isPlainObject(parsed.input)) {
    return { ...parsed.input };
  }

  const input = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (["type", "tool", "input", "message"].includes(key)) {
      continue;
    }
    input[key] = value;
  }

  return input;
}

function buildToolInput(parsed, toolName, options = {}) {
  const input = extractRootInput(parsed);

  if (toolName === "project") {
    return normalizeProjectInput(input, options);
  }

  return input;
}

function normalizeDirective(raw, parsed, toolNames, options = {}) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (
    parsed.type === "final" ||
    (parsed.type === "tool" && String(parsed.tool || "").trim().toLowerCase() === "final")
  ) {
    return {
      type: "final",
      message: extractFinalMessage(parsed)
    };
  }

  if (parsed.type === "tool" && typeof parsed.tool === "string" && toolNames.has(parsed.tool)) {
    return {
      type: "tool",
      tool: parsed.tool,
      input: buildToolInput(parsed, parsed.tool, options)
    };
  }

  if (typeof parsed.tool === "string" && toolNames.has(parsed.tool)) {
    return {
      type: "tool",
      tool: parsed.tool,
      input: buildToolInput(parsed, parsed.tool, options)
    };
  }

  if (typeof parsed.type === "string" && toolNames.has(parsed.type)) {
    return {
      type: "tool",
      tool: parsed.type,
      input: buildToolInput(parsed, parsed.type, options)
    };
  }

  // Recovery for malformed JSON like duplicated "type" keys:
  // {"type":"project", ... , "type":"python"} -> JSON parse keeps last one.
  const firstTypeToken = extractFirstJsonStringProperty(raw, "type");
  if (firstTypeToken && toolNames.has(firstTypeToken)) {
    const recoveredInput = extractRootInput(parsed);
    if (parsed.type && !toolNames.has(parsed.type) && !recoveredInput.projectType) {
      recoveredInput.projectType = parsed.type;
    }

    return {
      type: "tool",
      tool: firstTypeToken,
      input: firstTypeToken === "project" ? normalizeProjectInput(recoveredInput, options) : recoveredInput
    };
  }

  return null;
}

function normalizeAbsolutePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const candidate = value.trim();
  return path.isAbsolute(candidate) ? path.normalize(candidate) : "";
}

function convertLegacyAbsoluteFileWrite(directive, toolNames) {
  if (!directive || directive.type !== "tool" || directive.tool !== "file") {
    return directive;
  }

  if (!toolNames.has("project")) {
    return directive;
  }

  const input = isPlainObject(directive.input) ? directive.input : {};
  const action = String(input.action || "").trim().toLowerCase();
  if (!["write", "append", "exists", "delete"].includes(action)) {
    return directive;
  }

  const absolutePath = normalizeAbsolutePath(input.path);
  if (!absolutePath) {
    return directive;
  }

  if (action === "exists") {
    return {
      type: "tool",
      tool: "project",
      input: {
        mode: "probe",
        path: absolutePath
      }
    };
  }

  if (action === "delete") {
    return {
      type: "tool",
      tool: "project",
      input: {
        mode: "delete",
        projectPath: path.dirname(absolutePath),
        paths: [path.basename(absolutePath)],
        recursive: true,
        force: true
      }
    };
  }

  const projectPath = path.dirname(absolutePath);
  const fileName = path.basename(absolutePath);

  return {
    type: "tool",
    tool: "project",
    input: {
      mode: "write",
      projectPath,
      files: [
        {
          path: fileName,
          content: String(input.content || ""),
          append: action === "append"
        }
      ]
    }
  };
}

function looksLikeToolDirective(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return false;
  }

  const text = rawText.trim().toLowerCase();
  if (!text.startsWith("{")) {
    return false;
  }

  return (
    text.includes('"type":"tool"') ||
    text.includes('"tool":"') ||
    text.includes('"type":"project"') ||
    text.includes('"type":"file"') ||
    text.includes('"type":"desktop"') ||
    text.includes('"type":"chrome_live"')
  );
}

function deriveProjectStrategy(userInput) {
  const text = String(userInput || "").toLowerCase();
  const noTemplate =
    text.includes("hazir template yapmasin") ||
    text.includes("hazir template kullanma") ||
    text.includes("template yapmasin") ||
    text.includes("template kullanma") ||
    text.includes("template olmasin") ||
    text.includes("no template") ||
    text.includes("without template");

  const explicitTemplateIntent =
    (text.includes("template") && !noTemplate) || text.includes("scaffold");

  return {
    preferNoTemplate: noTemplate || !explicitTemplateIntent,
    allowTemplateScaffold: explicitTemplateIntent && !noTemplate
  };
}

export class AssistantAgent {
  constructor({ provider, toolRegistry, maxSteps = 6, onEvent = null }) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.maxSteps = maxSteps;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.messages = [];
  }

  emitEvent(event) {
    if (!this.onEvent) {
      return;
    }

    try {
      this.onEvent(event);
    } catch {
      // Event listeners should never break the agent loop.
    }
  }

  reset() {
    this.messages = [];
  }

  async ask(userInput) {
    const activities = [];
    this.messages.push({ role: "user", content: userInput });

    const toolList = this.toolRegistry.list();
    const toolNames = new Set(toolList.map((tool) => tool.name));
    const systemPrompt = buildSystemPrompt(toolList);
    const projectStrategy = deriveProjectStrategy(userInput);

    for (let step = 0; step < this.maxSteps; step += 1) {
      const raw = await this.provider.complete({
        systemPrompt,
        messages: this.messages,
        temperature: 0.1,
        maxTokens: 3200
      });

      const parsed = extractJson(raw);
      const directive = convertLegacyAbsoluteFileWrite(
        normalizeDirective(raw, parsed, toolNames, projectStrategy),
        toolNames
      );

      if (directive?.type === "tool") {
        const toolName = directive.tool;
        const toolInput = directive.input || {};

        this.messages.push({ role: "assistant", content: raw });
        const requestLog = `>! tool:${toolName} input=${summarizeForActivity(toolInput)}`;
        activities.push(requestLog);
        this.emitEvent({
          type: "tool_call",
          tool: toolName,
          input: toolInput,
          step: step + 1,
          log: requestLog
        });

        try {
          const toolOutput = await this.toolRegistry.execute(toolName, toolInput);
          const outputLog = `>! tool:${toolName} ok output=${summarizeForActivity(toolOutput)}`;
          activities.push(outputLog);
          this.emitEvent({
            type: "tool_result",
            tool: toolName,
            output: toolOutput,
            step: step + 1,
            log: outputLog
          });
          this.messages.push({
            role: "user",
            content: `TOOL_RESULT ${toolName}: ${clipText(JSON.stringify(toolOutput))}`
          });
        } catch (error) {
          const errorMessage = normalizeErrorMessage(error);
          const errorLog = `>! tool:${toolName} error=${summarizeForActivity(errorMessage)}`;
          activities.push(errorLog);
          this.emitEvent({
            type: "tool_error",
            tool: toolName,
            error: errorMessage,
            step: step + 1,
            log: errorLog
          });
          this.messages.push({
            role: "user",
            content: `TOOL_ERROR ${toolName}: ${clipText(errorMessage, 2000)}`
          });
        }

        continue;
      }

      if (directive?.type === "final") {
        const finalMessage = String(directive.message || "").trim() || String(raw || "").trim();
        this.messages.push({ role: "assistant", content: finalMessage });
        this.emitEvent({
          type: "final",
          message: finalMessage,
          step: step + 1
        });
        return {
          message: finalMessage,
          stepsUsed: step + 1,
          activities
        };
      }

      if (looksLikeToolDirective(raw)) {
        const parseError =
          "Model returned invalid/incomplete tool JSON. Retry with strict JSON only. Send one tool call at a time. For code writes, send one small file per call via project mode=write.";

        this.messages.push({ role: "assistant", content: raw });
        const errorLog = `>! tool:parser error=${parseError}`;
        activities.push(errorLog);
        this.emitEvent({
          type: "tool_error",
          tool: "parser",
          error: parseError,
          step: step + 1,
          log: errorLog
        });
        this.messages.push({
          role: "user",
          content: `TOOL_ERROR parser: ${clipText(parseError, 500)}`
        });
        continue;
      }

      this.messages.push({ role: "assistant", content: raw });
      this.emitEvent({
        type: "final",
        message: String(raw || "").trim(),
        step: step + 1
      });
      return {
        message: String(raw || "").trim(),
        stepsUsed: step + 1,
        activities
      };
    }

    throw new Error("Agent reached max step limit before final answer");
  }
}
