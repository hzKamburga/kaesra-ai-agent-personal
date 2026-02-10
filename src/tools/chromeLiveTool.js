import { config } from "../core/config.js";

const ACTION_ALIASES = {
  getactivetab: "getActiveTab",
  activetab: "getActiveTab",
  currenttab: "getActiveTab",
  listtabs: "listTabs",
  tabs: "listTabs",
  opentab: "openTab",
  open: "openTab",
  navigateactive: "navigateActive",
  navigate: "navigateActive",
  goto: "navigateActive",
  extractactivetext: "extractActiveText",
  extracttext: "extractActiveText",
  extract: "extractActiveText",
  clickselector: "clickSelector",
  click: "clickSelector",
  clicktext: "clickText",
  clickbytext: "clickText",
  click_text: "clickText",
  fillselector: "fillSelector",
  fill: "fillSelector",
  type: "fillSelector",
  setvalue: "fillSelector",
  scrollpage: "scrollPage",
  scroll: "scrollPage",
  wait: "wait",
  closetab: "closeTab",
  close: "closeTab"
};

const LEGACY_ACTION_FALLBACKS = {
  clickText: ["clickByText", "click_text", "clickByLabel"],
  clickSelector: ["click", "clickElement"],
  fillSelector: ["fill", "typeSelector", "setValue"],
  extractActiveText: ["extractText", "extract"],
  navigateActive: ["navigate", "goto"],
  openTab: ["open"],
  getActiveTab: ["activeTab", "currentTab"],
  listTabs: ["tabs"],
  scrollPage: ["scroll"],
  closeTab: ["close"]
};

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || "").trim();
  if (value) {
    return value.replace(/\/+$/, "");
  }

  return `http://${config.bridge.host}:${config.bridge.port}`;
}

function clampTimeout(timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed)) {
    return 30000;
  }

  return Math.max(1000, Math.min(180000, Math.floor(parsed)));
}

async function bridgeFetch(path, { method = "GET", baseUrl, body } = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;

  const headers = {
    "Content-Type": "application/json"
  };

  if (config.bridge.apiToken) {
    headers["X-Agent-Token"] = config.bridge.apiToken;
  }

  let response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("fetch failed") || message.includes("econnrefused")) {
      throw new Error(
        `Chrome bridge baglantisi kurulamadi (${url}). Once 'npm run bridge' calistir, sonra Chrome extension'i reload et ve bridge URL/token ayarini kontrol et.`
      );
    }

    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Bridge request failed (${response.status})`);
  }

  return data;
}

function extractInputPayload(rawInput = {}) {
  const payload = { ...rawInput };

  delete payload.action;
  delete payload.timeoutMs;
  delete payload.baseUrl;

  return payload;
}

function normalizeAction(action) {
  const raw = String(action || "").trim();
  if (!raw) {
    return "";
  }

  return ACTION_ALIASES[raw.toLowerCase()] || raw;
}

function isUnsupportedActionError(error) {
  return /unsupported chrome action/i.test(String(error?.message || error || ""));
}

async function sendChromeCommand({ action, payload, timeoutMs, baseUrl }) {
  const response = await bridgeFetch("/chrome/commands", {
    method: "POST",
    baseUrl,
    body: {
      action,
      input: payload,
      timeoutMs
    }
  });

  return response.result;
}

function buildTextBasedSelectorCandidates(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return [];
  }

  const escaped = normalized.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const variants = new Set([normalized]);
  const lower = normalized.toLowerCase();

  if (["ara", "search", "find"].includes(lower)) {
    variants.add("Search");
    variants.add("Ara");
  }

  const selectors = [];

  for (const label of variants) {
    const safe = label.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    selectors.push(`button[aria-label*='${safe}' i]`);
    selectors.push(`[role='button'][aria-label*='${safe}' i]`);
    selectors.push(`a[aria-label*='${safe}' i]`);
    selectors.push(`button[title*='${safe}' i]`);
    selectors.push(`[role='button'][title*='${safe}' i]`);
  }

  selectors.push("button#search-icon-legacy");
  selectors.push("#search-icon-legacy");
  selectors.push("ytd-searchbox button");
  selectors.push(`button[value='${escaped}']`);

  return selectors;
}

async function tryClickTextSelectorFallback({ payload, timeoutMs, baseUrl }) {
  const text = String(payload?.text || "").trim();
  if (!text) {
    return null;
  }

  const selectors = buildTextBasedSelectorCandidates(text);

  for (const selector of selectors) {
    try {
      const result = await sendChromeCommand({
        action: "clickSelector",
        payload: {
          ...payload,
          selector,
          fallbackText: text
        },
        timeoutMs,
        baseUrl
      });

      if (result?.clicked) {
        return {
          mode: "selector-fallback",
          action: "clickSelector",
          result
        };
      }
    } catch {
      // Keep trying candidates.
    }
  }

  return null;
}

async function runWithFallback({ action, payload, timeoutMs, baseUrl }) {
  try {
    const result = await sendChromeCommand({ action, payload, timeoutMs, baseUrl });
    return {
      mode: "direct",
      action,
      result
    };
  } catch (error) {
    if (!isUnsupportedActionError(error)) {
      throw error;
    }

    const aliases = LEGACY_ACTION_FALLBACKS[action] || [];
    for (const alias of aliases) {
      try {
        const result = await sendChromeCommand({
          action: alias,
          payload,
          timeoutMs,
          baseUrl
        });

        return {
          mode: "legacy-alias",
          action: alias,
          result
        };
      } catch {
        // Continue alias fallback attempts.
      }
    }

    if (action === "clickText") {
      const fallback = await tryClickTextSelectorFallback({
        payload,
        timeoutMs,
        baseUrl
      });

      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

export async function runChromeLiveTask(input = {}) {
  const action = normalizeAction(input.action);

  if (!action) {
    throw new Error("chrome_live tool requires 'action'");
  }

  if (action === "help") {
    return {
      actions: [
        "status",
        "getActiveTab",
        "listTabs",
        "openTab",
        "navigateActive",
        "extractActiveText",
        "clickSelector",
        "clickText",
        "fillSelector",
        "scrollPage",
        "wait",
        "closeTab"
      ],
      aliases: [
        "activeTab->getActiveTab",
        "open->openTab",
        "navigate->navigateActive",
        "extract->extractActiveText",
        "click->clickSelector",
        "clickByText->clickText",
        "fill/type->fillSelector",
        "scroll->scrollPage",
        "close->closeTab"
      ],
      example: {
        action: "navigateActive",
        url: "https://example.com"
      }
    };
  }

  if (action === "status") {
    return bridgeFetch("/chrome/status", {
      method: "GET",
      baseUrl: input.baseUrl
    });
  }

  const timeoutMs = clampTimeout(input.timeoutMs);
  const payload = extractInputPayload(input);
  const execution = await runWithFallback({
    action,
    payload,
    timeoutMs,
    baseUrl: input.baseUrl
  });

  return {
    action,
    result: execution.result,
    mode: execution.mode,
    executedAction: execution.action
  };
}

export const chromeLiveTool = {
  name: "chrome_live",
  description:
    "Chrome extension uzerinden gercek Chrome sekmesini yonetir. Input: { action, ... }. Actions: status|getActiveTab|listTabs|openTab|navigateActive|extractActiveText|clickSelector|clickText|fillSelector|scrollPage|wait|closeTab. fillSelector icin opsiyonel: pressEnter, submit.",
  async run(input) {
    return runChromeLiveTask(input);
  }
};
