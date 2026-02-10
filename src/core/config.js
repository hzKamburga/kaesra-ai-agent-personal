import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const schema = z.object({
  AI_PROVIDER: z.enum(["openai", "anthropic", "generic"]).default("openai"),
  AI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GENERIC_AI_ENDPOINT: z.string().optional(),
  GENERIC_AI_API_KEY: z.string().optional(),
  GENERIC_AI_MODEL: z.string().optional(),
  GENERIC_AI_HEADERS_JSON: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  CHROME_USER_DATA_DIR: z.string().optional(),
  CHROME_EXECUTABLE_PATH: z.string().optional(),
  BROWSER_HEADLESS: z.string().optional(),
  BRIDGE_HOST: z.string().optional(),
  BRIDGE_PORT: z.string().optional(),
  BRIDGE_API_TOKEN: z.string().optional(),
  SCHEDULER_STORE_PATH: z.string().optional(),
  SCHEDULER_TICK_MS: z.string().optional(),
  DESKTOP_ALLOW_SHELL: z.string().optional(),
  PROJECTS_BASE_DIR: z.string().optional(),
  LOG_LEVEL: z.string().optional()
});

const env = schema.parse(process.env);

function normalizeOptional(value) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function parseBoolean(value, fallback = false) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseJsonObject(value, fallback = {}) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function parseNumber(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

export const config = {
  provider: env.AI_PROVIDER,
  model: env.AI_MODEL,
  openaiApiKey: normalizeOptional(env.OPENAI_API_KEY),
  anthropicApiKey: normalizeOptional(env.ANTHROPIC_API_KEY),
  generic: {
    endpoint: normalizeOptional(env.GENERIC_AI_ENDPOINT),
    apiKey: normalizeOptional(env.GENERIC_AI_API_KEY),
    model: normalizeOptional(env.GENERIC_AI_MODEL),
    headers: parseJsonObject(env.GENERIC_AI_HEADERS_JSON)
  },
  search: {
    tavilyApiKey: normalizeOptional(env.TAVILY_API_KEY),
    serpApiKey: normalizeOptional(env.SERPAPI_API_KEY)
  },
  browser: {
    userDataDir: normalizeOptional(env.CHROME_USER_DATA_DIR),
    executablePath: normalizeOptional(env.CHROME_EXECUTABLE_PATH),
    headless: parseBoolean(env.BROWSER_HEADLESS, false)
  },
  bridge: {
    host: normalizeOptional(env.BRIDGE_HOST) || "127.0.0.1",
    port: parseNumber(env.BRIDGE_PORT, 3434),
    apiToken: normalizeOptional(env.BRIDGE_API_TOKEN)
  },
  scheduler: {
    storePath: normalizeOptional(env.SCHEDULER_STORE_PATH),
    tickMs: Math.max(5000, parseNumber(env.SCHEDULER_TICK_MS, 15000))
  },
  desktop: {
    allowShell: parseBoolean(env.DESKTOP_ALLOW_SHELL, false)
  },
  projectsBaseDir: normalizeOptional(env.PROJECTS_BASE_DIR),
  workspaceRoot: process.cwd(),
  logLevel: normalizeOptional(env.LOG_LEVEL) || "info"
};
