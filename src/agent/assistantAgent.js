import path from "node:path";
import { buildSystemPrompt } from "./systemPrompt.js";

function clipText(value, limit = 50000) {
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

function tryParseLooseJsonObject(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const raw = text.trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Continue with relaxed parse.
  }

  const normalized = raw
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"')
    .replace(/,\s*}/g, "}");

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function extractBalancedObjectText(text, startIndex) {
  if (typeof text !== "string" || startIndex < 0 || startIndex >= text.length) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return "";
}

function extractJson(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();

  const direct = tryParseLooseJsonObject(candidate);
  if (direct && typeof direct === "object") {
    return direct;
  }

  const firstCurly = candidate.indexOf("{");
  const lastCurly = candidate.lastIndexOf("}");
  if (firstCurly >= 0 && lastCurly > firstCurly) {
    const wrapped = tryParseLooseJsonObject(candidate.slice(firstCurly, lastCurly + 1));
    if (wrapped && typeof wrapped === "object") {
      return wrapped;
    }
  }

  const maxScan = 18;
  let scanned = 0;
  for (let i = 0; i < candidate.length && scanned < maxScan; i += 1) {
    if (candidate[i] !== "{") {
      continue;
    }
    scanned += 1;
    const objectText = extractBalancedObjectText(candidate, i);
    if (!objectText) {
      continue;
    }
    const parsed = tryParseLooseJsonObject(objectText);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }

  return null;
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

function detectLoop(history, toolName, toolInput) {
  if (!Array.isArray(history) || history.length < 2) {
    return false;
  }

  const currentInputStr = JSON.stringify(toolInput);

  // Look at the recent history (last 14 items)
  let matchCount = 0;
  const WINDOW_SIZE = 14;
  const recentHistory = history.slice(-WINDOW_SIZE);

  for (const run of recentHistory) {
    if (run.tool === toolName) {
      const runInputStr = JSON.stringify(run.input);
      if (runInputStr === currentInputStr) {
        matchCount += 1;
      }
    }
  }

  // 3rd repeat of exact same call = loop
  if (matchCount >= 2) {
    return true;
  }

  // Detect scroll-then-extract loop for chrome_live
  if (toolName === "chrome_live") {
    const currentAction = toolInput?.action || "";
    const isScrollAction = ["scrollPage", "scrollElement", "scrollToTop", "scrollToBottom"].includes(currentAction);

    if (isScrollAction) {
      // Too many scroll attempts = loop
      const scrollCount = recentHistory.filter(
        (run) => run.tool === "chrome_live" &&
          ["scrollPage", "scrollElement", "scrollToTop", "scrollToBottom"].includes(run.input?.action || "")
      ).length;
      if (scrollCount >= 6) {
        return true;
      }

      // Same extract content returned twice = scroll not loading new content
      const extractRuns = recentHistory.filter(
        (run) => run.tool === "chrome_live" && run.input?.action === "extractActiveText" && run.ok && run.output
      );
      if (extractRuns.length >= 2) {
        const lastExtract = JSON.stringify(extractRuns[extractRuns.length - 1]?.output);
        const prevExtract = JSON.stringify(extractRuns[extractRuns.length - 2]?.output);
        if (lastExtract && prevExtract && lastExtract === prevExtract) {
          return true;
        }
      }

      // scroll moved=0 twice = at boundary
      const scrollRuns = recentHistory.filter(
        (run) => run.tool === "chrome_live" &&
          ["scrollPage", "scrollElement"].includes(run.input?.action || "") && run.ok && run.output
      );
      if (scrollRuns.length >= 2) {
        const lastMoved = scrollRuns[scrollRuns.length - 1]?.output?.moved;
        const prevMoved = scrollRuns[scrollRuns.length - 2]?.output?.moved;
        if (lastMoved === 0 && prevMoved === 0) {
          return true;
        }
      }
    }
  }

  return false;
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

function parseJsonObject(value) {
  if (!value) {
    return null;
  }

  if (isPlainObject(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeParallelDirective(parsed, toolNames, options = {}) {
  if (!isPlainObject(parsed)) {
    return null;
  }

  const type = String(parsed.type || "").trim().toLowerCase();
  const isParallelType = [
    "parallel_tool_call",
    "parallel_tool_calls",
    "parallel",
    "tool_batch",
    "batch_tool_calls"
  ].includes(type);

  const candidates =
    (Array.isArray(parsed.calls) && parsed.calls) ||
    (Array.isArray(parsed.tool_calls) && parsed.tool_calls) ||
    (Array.isArray(parsed.tools) && parsed.tools) ||
    (isPlainObject(parsed.input) && Array.isArray(parsed.input.calls) && parsed.input.calls) ||
    (isPlainObject(parsed.input) && Array.isArray(parsed.input.tool_calls) && parsed.input.tool_calls) ||
    null;

  if (!isParallelType && !candidates) {
    return null;
  }

  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }

  const tools = [];
  for (const item of candidates) {
    if (!isPlainObject(item)) {
      continue;
    }

    const toolName = String(item.tool || item.name || item.type || "").trim();
    if (!toolNames.has(toolName)) {
      continue;
    }

    const parsedInput =
      parseJsonObject(item.input) ||
      parseJsonObject(item.arguments) ||
      parseJsonObject(item.args) ||
      extractRootInput(item);

    tools.push({
      tool: toolName,
      input: toolName === "project" ? normalizeProjectInput(parsedInput, options) : parsedInput
    });
  }

  if (!tools.length) {
    return null;
  }

  return {
    type: "parallel_tools",
    tools
  };
}

function recoverDirectiveFromRaw(raw, toolNames, options = {}) {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const toolMatch = raw.match(/["']tool["']\s*:\s*["']([^"']+)["']/i);
  const toolName = toolMatch ? String(toolMatch[1] || "").trim() : "";
  if (!toolName || !toolNames.has(toolName)) {
    return null;
  }

  const inputToken = raw.match(/["']input["']\s*:/i);
  let input = {};

  if (inputToken && typeof inputToken.index === "number") {
    const tokenStart = inputToken.index + inputToken[0].length;
    const braceStart = raw.indexOf("{", tokenStart);
    if (braceStart >= 0) {
      const objectText = extractBalancedObjectText(raw, braceStart);
      const parsedInput = tryParseLooseJsonObject(objectText);
      if (isPlainObject(parsedInput)) {
        input = parsedInput;
      }
    }
  }

  if (toolName === "project") {
    input = normalizeProjectInput(input, options);
  }

  return {
    type: "tool",
    tool: toolName,
    input
  };
}

function normalizeDirective(raw, parsed, toolNames, options = {}) {
  if (!parsed || typeof parsed !== "object") {
    return recoverDirectiveFromRaw(raw, toolNames, options);
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

  const parallelDirective = normalizeParallelDirective(parsed, toolNames, options);
  if (parallelDirective) {
    return parallelDirective;
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
    text.includes('"type":"parallel_tool_calls"') ||
    text.includes('"type":"parallel_tool_call"') ||
    text.includes('"tool":"') ||
    text.includes('"tool_calls"') ||
    text.includes('"calls"') ||
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

function isModelEmulationRequest(userInput) {
  const text = String(userInput || "").toLowerCase();
  if (!text) {
    return false;
  }

  const modelMarkers = ["claude", "sonnet", "gpt", "gemini", "model", "assistant"];
  const emulationMarkers = ["taklit", "mimic", "emulate", "benzer", "system prompt", "sistem prompt", "prompt"];

  return modelMarkers.some((item) => text.includes(item)) && emulationMarkers.some((item) => text.includes(item));
}

function looksLikeGenericRefusal(message) {
  const text = String(message || "").toLowerCase();
  if (!text) {
    return false;
  }

  const refusalMarkers = [
    "bu talep yerine getirilemez",
    "yerine getirilemez",
    "etik",
    "yasal",
    "cannot comply",
    "cannot help with",
    "i can't help",
    "ticari sırr",
    "trade secret",
    "copyright",
    "telif"
  ];

  const positiveMarkers = ["yapabilirim", "i can help", "however", "ancak"];

  const hasRefusal = refusalMarkers.some((item) => text.includes(item));
  const hasActionableContinuation = positiveMarkers.some((item) => text.includes(item));
  return hasRefusal && hasActionableContinuation;
}

function buildRefusalRecoveryPrompt() {
  return [
    "TOOL_RECOVERY: Prior response was an unhelpful generic refusal.",
    "Continue the task with a compliant best-effort output.",
    "For model-style requests, provide an approximation prompt based on observable behavior.",
    "Do not claim exact cloning or proprietary internals."
  ].join(" ");
}

function shouldRetryProjectWithOverwrite(toolName, toolInput, errorMessage) {
  if (toolName !== "project") {
    return false;
  }

  if (!toolInput || typeof toolInput !== "object") {
    return false;
  }

  if (toolInput.overwrite === true) {
    return false;
  }

  const mode = String(toolInput.mode || "").toLowerCase();
  if (!["scaffold", "generate"].includes(mode)) {
    return false;
  }

  const message = String(errorMessage || "").toLowerCase();
  return message.includes("target already exists");
}

// Estimate rough token count (1 token ≈ 4 chars)
function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

// Compress old TOOL_RESULT messages to avoid context bloat
function compressOldToolResults(messages, maxKeep = 20) {
  if (messages.length <= maxKeep) return messages;

  const result = [];
  let toolResultCount = 0;

  // Walk from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const isToolResult = msg.role === "user" &&
      (msg.content.startsWith("TOOL_RESULT ") || msg.content.startsWith("TOOL_ERROR "));

    if (isToolResult) {
      toolResultCount++;
      // Keep last 8 tool results full, compress older ones
      if (toolResultCount > 8) {
        const truncated = msg.content.slice(0, 120) + "...[compressed]";
        result.unshift({ role: msg.role, content: truncated });
        continue;
      }
    }
    result.unshift(msg);
  }

  return result;
}

// Detect if request is heavy (project, coding, multi-file)
function isHeavyRequest(userInput) {
  const text = String(userInput || "").toLowerCase();
  const heavyMarkers = [
    "proje", "project", "yaz", "write", "kod", "code", "olustur", "create",
    "uygulama", "app", "website", "site", "api", "server", "dosya", "file"
  ];
  return heavyMarkers.filter(m => text.includes(m)).length >= 2;
}

// Detect skill mode from user input
function detectSkillMode(userInput) {
  const text = String(userInput || "").toLowerCase();

  if (/instagram|twitter|youtube|tiktok|dm|mesaj|tarayici|browser|chrome|scroll|sayfa|link/.test(text)) {
    return "chrome";
  }
  if (/proje|project|kod|code|yaz|write|uygulama|app|api|server|script|dosya|file|npm|node|python/.test(text)) {
    return "code";
  }
  if (/arastir|araştır|research|bul|find|haber|news|makale|article|bilgi|information|googl/.test(text)) {
    return "research";
  }
  return "general";
}

export class AssistantAgent {
  constructor({ provider, toolRegistry, maxSteps = 200, onEvent = null }) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.maxSteps = maxSteps > 0 ? maxSteps : Infinity;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.messages = [];
    this.totalTokensUsed = 0;
    this.sessionStarted = new Date().toISOString();
    this.skillMode = "general"; // general | code | research | chrome | creative
    this.conversationTopics = []; // Track topics for context
  }

  pruneHistory() {
    // First compress old tool results to save tokens
    this.messages = compressOldToolResults(this.messages);

    const MAX_HISTORY = 50;
    if (this.messages.length > MAX_HISTORY) {
      const candidates = this.messages.slice(-MAX_HISTORY);
      const firstUserIdx = candidates.findIndex(m => m.role === "user");

      if (firstUserIdx !== -1) {
        this.messages = candidates.slice(firstUserIdx);
      } else {
        this.messages = candidates;
      }
    }
  }

  getStats() {
    return {
      messageCount: this.messages.length,
      estimatedTokens: estimateMessagesTokens(this.messages),
      totalTokensUsed: this.totalTokensUsed,
      sessionStarted: this.sessionStarted,
      skillMode: this.skillMode,
      topics: this.conversationTopics.slice(-5)
    };
  }

  setSkillMode(mode) {
    const valid = ["general", "code", "research", "chrome", "creative"];
    if (valid.includes(mode)) {
      this.skillMode = mode;
      return true;
    }
    return false;
  }

  emitEvent(event) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      // Event listeners should never break the agent loop.
    }
  }

  reset() {
    this.messages = [];
    this.totalTokensUsed = 0;
    this.conversationTopics = [];
  }

  async ask(userInput) {
    this.pruneHistory();

    // Auto-detect skill mode from request
    const detectedMode = detectSkillMode(userInput);
    if (detectedMode !== "general") {
      this.skillMode = detectedMode;
    }

    // Dynamic maxTokens: heavy requests (project/code) get more tokens
    const baseMaxTokens = isHeavyRequest(userInput) ? 6000 : 3200;

    // Track estimated token usage
    this.totalTokensUsed += estimateTokens(userInput) + estimateMessagesTokens(this.messages);

    const activities = [];
    const toolRuns = [];
    let refusalRecoveryUsed = false;
    let parserRecoveryCount = 0;
    this.messages.push({ role: "user", content: userInput });

    const toolList = this.toolRegistry.list();
    const toolNames = new Set(toolList.map((tool) => tool.name));
    const systemPrompt = buildSystemPrompt(toolList, this.skillMode);
    const projectStrategy = deriveProjectStrategy(userInput);


    const executeToolCall = async (toolName, toolInput, stepNumber) => {
      const runRecord = {
        step: stepNumber,
        tool: toolName,
        input: toolInput,
        ok: false
      };

      const requestLog = `>! tool:${toolName} input=${summarizeForActivity(toolInput)}`;
      activities.push(requestLog);
      this.emitEvent({
        type: "tool_call",
        tool: toolName,
        input: toolInput,
        step: stepNumber,
        log: requestLog
      });

      try {
        let effectiveInput = toolInput;
        let toolOutput;

        try {
          toolOutput = await this.toolRegistry.execute(toolName, toolInput);
        } catch (firstError) {
          const firstErrorMessage = normalizeErrorMessage(firstError);
          if (!shouldRetryProjectWithOverwrite(toolName, toolInput, firstErrorMessage)) {
            throw firstError;
          }

          effectiveInput = {
            ...toolInput,
            overwrite: true
          };

          const retryLog = `>! tool:${toolName} retry=overwrite_true`;
          activities.push(retryLog);
          this.emitEvent({
            type: "tool_retry",
            tool: toolName,
            input: effectiveInput,
            step: stepNumber,
            log: retryLog
          });

          runRecord.retry = {
            strategy: "overwrite_true",
            reason: firstErrorMessage
          };

          toolOutput = await this.toolRegistry.execute(toolName, effectiveInput);
        }

        const outputLog = `>! tool:${toolName} ok output=${summarizeForActivity(toolOutput)}`;
        activities.push(outputLog);
        runRecord.ok = true;
        runRecord.input = effectiveInput;
        runRecord.output = toolOutput;
        this.emitEvent({
          type: "tool_result",
          tool: toolName,
          output: toolOutput,
          step: stepNumber,
          log: outputLog
        });

        toolRuns.push(runRecord);
        return {
          ok: true,
          tool: toolName,
          output: toolOutput
        };
      } catch (error) {
        const errorMessage = normalizeErrorMessage(error);
        const errorLog = `>! tool:${toolName} error=${summarizeForActivity(errorMessage)}`;
        activities.push(errorLog);
        runRecord.error = errorMessage;
        this.emitEvent({
          type: "tool_error",
          tool: toolName,
          error: errorMessage,
          step: stepNumber,
          log: errorLog
        });

        toolRuns.push(runRecord);
        return {
          ok: false,
          tool: toolName,
          error: errorMessage
        };
      }
    };

    for (let step = 0; step < this.maxSteps; step += 1) {
      const raw = await this.provider.complete({
        systemPrompt,
        messages: this.messages,
        temperature: 0.1,
        maxTokens: baseMaxTokens
      });


      const parsed = extractJson(raw);
      const directive = convertLegacyAbsoluteFileWrite(
        normalizeDirective(raw, parsed, toolNames, projectStrategy),
        toolNames
      );

      if (directive?.type === "tool") {
        parserRecoveryCount = 0;
        const toolName = directive.tool;
        const toolInput = directive.input || {};

        if (detectLoop(toolRuns, toolName, toolInput)) {
          this.messages.push({ role: "assistant", content: raw });
          const loopMessage = "SYSTEM: You are stuck in a loop repeating the EXACT same tool call. Stop and try a different approach.";
          this.messages.push({
            role: "user",
            content: loopMessage
          });
          const loopLog = `>! tool:${toolName} skipped=loop_detected`;
          activities.push(loopLog);
          this.emitEvent({
            type: "tool_loop_detected",
            tool: toolName,
            input: toolInput,
            step: step + 1,
            log: loopLog
          });
          continue;
        }

        this.messages.push({ role: "assistant", content: raw });
        const result = await executeToolCall(toolName, toolInput, step + 1);
        if (result.ok) {
          this.messages.push({
            role: "user",
            content: `TOOL_RESULT ${toolName}: ${clipText(JSON.stringify(result.output))}`
          });
        } else {
          this.messages.push({
            role: "user",
            content: `TOOL_ERROR ${toolName}: ${clipText(result.error, 2000)}`
          });
        }

        continue;
      }

      if (directive?.type === "parallel_tools") {
        parserRecoveryCount = 0;
        const calls = Array.isArray(directive.tools) ? directive.tools : [];
        if (!calls.length) {
          this.messages.push({
            role: "user",
            content: "TOOL_ERROR parser: parallel_tool_calls has no valid tool entries"
          });
          continue;
        }

        // --- Loop Detection for Parallel Tools ---
        const loopDetails = calls.find(call => detectLoop(toolRuns, call.tool, call.input || {}));
        if (loopDetails) {
          this.messages.push({ role: "assistant", content: raw });
          const loopMessage = `SYSTEM: You are stuck in a loop repeating the tool call '${loopDetails.tool}'. Stop and try a different approach.`;
          this.messages.push({
            role: "user",
            content: loopMessage
          });
          const loopLog = `>! tool:${loopDetails.tool} skipped=loop_detected`;
          activities.push(loopLog);
          this.emitEvent({
            type: "tool_loop_detected",
            tool: loopDetails.tool,
            input: loopDetails.input,
            step: step + 1,
            log: loopLog
          });
          continue;
        }
        // -----------------------------------------

        this.messages.push({ role: "assistant", content: raw });
        this.emitEvent({
          type: "tool_call_batch",
          step: step + 1,
          size: calls.length,
          tools: calls.map((item) => item.tool)
        });

        const maxParallel = 4;
        const results = [];

        for (let i = 0; i < calls.length; i += maxParallel) {
          const chunk = calls.slice(i, i + maxParallel);
          const settled = await Promise.all(
            chunk.map((call) => executeToolCall(call.tool, call.input || {}, step + 1))
          );
          results.push(...settled);
        }

        for (const result of results) {
          if (result.ok) {
            this.messages.push({
              role: "user",
              content: `TOOL_RESULT ${result.tool}: ${clipText(JSON.stringify(result.output))}`
            });
          } else {
            this.messages.push({
              role: "user",
              content: `TOOL_ERROR ${result.tool}: ${clipText(result.error, 2000)}`
            });
          }
        }

        continue;
      }

      if (directive?.type === "final") {
        parserRecoveryCount = 0;
        const finalMessage = String(directive.message || "").trim() || String(raw || "").trim();

        if (
          !refusalRecoveryUsed &&
          step < this.maxSteps - 1 &&
          isModelEmulationRequest(userInput) &&
          looksLikeGenericRefusal(finalMessage)
        ) {
          refusalRecoveryUsed = true;
          this.messages.push({ role: "assistant", content: finalMessage });
          this.messages.push({
            role: "user",
            content: buildRefusalRecoveryPrompt()
          });
          continue;
        }

        this.messages.push({ role: "assistant", content: finalMessage });
        this.emitEvent({
          type: "final",
          message: finalMessage,
          step: step + 1
        });
        return {
          message: finalMessage,
          stepsUsed: step + 1,
          activities,
          toolRuns
        };
      }

      if (looksLikeToolDirective(raw)) {
        const parseError =
          "Model returned invalid/incomplete tool JSON. Retry with strict JSON only. Use one of: {type:'tool',tool,input} or {type:'parallel_tool_calls',calls:[...]}.";

        this.messages.push({ role: "assistant", content: raw });
        parserRecoveryCount += 1;
        const recoveryLog = `>! parser:recovery attempt=${parserRecoveryCount}`;
        activities.push(recoveryLog);
        this.emitEvent({
          type: "parser_recovery",
          step: step + 1,
          attempt: parserRecoveryCount,
          log: recoveryLog
        });

        // Silent recovery first: do not surface noisy parser error if agent can self-correct next step.
        if (parserRecoveryCount <= 2) {
          this.messages.push({
            role: "user",
            content:
              "TOOL_FORMAT_ERROR: Return strict JSON only. Use {\"type\":\"tool\",\"tool\":\"name\",\"input\":{...}} or {\"type\":\"parallel_tool_calls\",\"calls\":[...]}."
          });
          continue;
        }

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

      if (
        !refusalRecoveryUsed &&
        step < this.maxSteps - 1 &&
        isModelEmulationRequest(userInput) &&
        looksLikeGenericRefusal(raw)
      ) {
        refusalRecoveryUsed = true;
        this.messages.push({ role: "assistant", content: raw });
        this.messages.push({
          role: "user",
          content: buildRefusalRecoveryPrompt()
        });
        continue;
      }

      this.messages.push({ role: "assistant", content: raw });
      parserRecoveryCount = 0;
      this.emitEvent({
        type: "final",
        message: String(raw || "").trim(),
        step: step + 1
      });
      return {
        message: String(raw || "").trim(),
        stepsUsed: step + 1,
        activities,
        toolRuns
      };
    }

    throw new Error("Agent reached max step limit before final answer");
  }
}
