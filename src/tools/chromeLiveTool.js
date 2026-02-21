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
  scrolltop: "scrollToTop",
  scrollup: "scrollToTop",
  totop: "scrollToTop",
  scrollbottom: "scrollToBottom",
  tobottom: "scrollToBottom",
  pageinfo: "getPageInfo",
  getpageinfo: "getPageInfo",
  pagestate: "getPageInfo",
  screenshot: "screenshotTab",
  screenshottab: "screenshotTab",
  capturetab: "screenshotTab",
  scrollelement: "scrollElement",
  scrollinto: "scrollElement",
  wait: "wait",
  closetab: "closeTab",
  close: "closeTab",
  executejs: "executeJs",
  eval: "executeJs"
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
  scrollToTop: ["scrollup", "totop"],
  scrollToBottom: ["scrollbottom", "tobottom"],
  scrollElement: ["scrollinto"],
  closeTab: ["close"]
};

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || "").trim();
  if (!value) {
    return `http://${config.bridge.host}:${config.bridge.port}`;
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `http://${value}`;
  return withScheme.replace(/\/+$/, "");
}

function buildBridgeBaseCandidates(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();

    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      const aliases = host === "localhost" ? ["127.0.0.1"] : ["localhost"];

      for (const alias of aliases) {
        const next = new URL(parsed.toString());
        next.hostname = alias;
        candidates.push(normalizeBaseUrl(next.toString()));
      }
    }
  } catch {
    // Keep the original candidate.
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function clampTimeout(timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed)) {
    return 30000;
  }

  return Math.max(1000, Math.min(180000, Math.floor(parsed)));
}

async function bridgeFetch(path, { method = "GET", baseUrl, body } = {}) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (config.bridge.apiToken) {
    headers["X-Agent-Token"] = config.bridge.apiToken;
  }

  const candidates = buildBridgeBaseCandidates(baseUrl);
  let lastNetworkError = null;

  for (const base of candidates) {
    const url = `${base}${path}`;
    let response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      lastNetworkError = error;
      continue;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Bridge request failed (${response.status})`);
    }

    return data;
  }

  const message = String(lastNetworkError?.message || lastNetworkError || "").toLowerCase();
  if (message.includes("fetch failed") || message.includes("econnrefused")) {
    throw new Error(
      `Chrome bridge baglantisi kurulamadi (${candidates.join(" | ")}). Once 'npm run bridge' calistir, sonra Chrome extension'i reload et ve bridge URL/token ayarini kontrol et.`
    );
  }

  if (lastNetworkError) {
    throw lastNetworkError;
  }

  throw new Error("Chrome bridge baglantisi kurulamadi: gecerli bir URL bulunamadi.");
}

async function getChromeBridgeStatus(baseUrl) {
  try {
    return await bridgeFetch("/chrome/status", {
      method: "GET",
      baseUrl
    });
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || "")
    };
  }
}

function buildDisconnectedError(status) {
  const detail = [];
  const lastPollAt = status?.lastPollAt || null;
  const lastResultAt = status?.lastResultAt || null;
  const queued = status?.queuedCount;
  const pending = status?.pendingCount;

  if (lastPollAt) {
    detail.push(`lastPollAt=${lastPollAt}`);
  } else {
    detail.push("lastPollAt=never");
  }

  if (lastResultAt) {
    detail.push(`lastResultAt=${lastResultAt}`);
  }

  if (Number.isFinite(queued)) {
    detail.push(`queued=${queued}`);
  }

  if (Number.isFinite(pending)) {
    detail.push(`pending=${pending}`);
  }

  const suffix = detail.length ? ` (${detail.join(", ")})` : "";
  return [
    `Chrome automation kullanilamiyor: bridge acik ama extension bagli degil${suffix}.`,
    "Cozum: 1) chrome://extensions -> eklentiyi Reload et",
    "2) Eklenti popup'inda Bridge URL/token ayarini kontrol et",
    "3) Sonra 'kaesra chrome status' ile extensionConnected=true oldugunu dogrula"
  ].join(" ");
}

function extractInputPayload(rawInput = {}) {
  const payload = { ...rawInput };

  delete payload.action;
  delete payload.timeoutMs;
  delete payload.baseUrl;

  return payload;
}

function normalizeActionPayload(action, payload = {}) {
  const next = { ...payload };

  if (action === "wait") {
    const durationMs =
      next.durationMs !== undefined
        ? Number(next.durationMs)
        : next.waitMs !== undefined
          ? Number(next.waitMs)
          : next.ms !== undefined
            ? Number(next.ms)
            : NaN;

    if (Number.isFinite(durationMs)) {
      next.ms = durationMs;
    }

    if (next.seconds !== undefined && !Number.isFinite(Number(next.ms))) {
      const seconds = Number(next.seconds);
      if (Number.isFinite(seconds)) {
        next.ms = seconds * 1000;
      }
    }
  }

  if (action === "fillSelector" && next.pressEnter === true && next.submit === undefined) {
    // In chat/search UIs, Enter generally implies "send/search".
    next.submit = true;
  }

  if ((action === "openTab" || action === "navigateActive") && !String(next.url || "").trim()) {
    const queryText = String(next.query || next.text || next.search || "").trim();
    if (queryText) {
      next.url = `https://www.google.com/search?q=${encodeURIComponent(queryText)}`;
    } else {
      next.url = "https://www.google.com";
    }
  }

  if ((action === "openTab" || action === "navigateActive") && String(next.url || "").trim()) {
    const raw = String(next.url).trim();
    if (!/^https?:\/\//i.test(raw)) {
      next.url = `https://${raw.replace(/^\/+/, "")}`;
    }
  }

  return next;
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
        "scrollToTop",
        "scrollToBottom",
        "scrollElement",
        "getPageInfo",
        "screenshotTab",
        "executeJs",
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
        "scrollup/totop->scrollToTop",
        "scrollbottom/tobottom->scrollToBottom",
        "scrollinto->scrollElement",
        "pageinfo/pagestate->getPageInfo",
        "screenshot/capturetab->screenshotTab",
        "close->closeTab"
      ],
      notes: [
        "scrollToTop: Sayfanin en ustune git (Instagram DM gibi yerlerde eski mesajlari yuklemek icin)",
        "scrollElement: Belirli bir container'i kaydir (selector opsiyonel; yoksa mesaj/chat container otomatik bulunur)",
        "getPageInfo: Scroll pozisyonu, atTop/atBottom, scrollPercent dondurur - loop olmadan scroll stratejisi icin",
        "screenshotTab: Aktif sekmenin gorselini base64 PNG olarak dondurur"
      ],
      example: {
        action: "navigateActive",
        url: "https://example.com"
      }
    };
  }

  if (action === "status") {
    return getChromeBridgeStatus(input.baseUrl);
  }

  const timeoutMs = clampTimeout(input.timeoutMs);
  const payload = normalizeActionPayload(action, extractInputPayload(input));
  const status = await getChromeBridgeStatus(input.baseUrl);
  if (!status?.ok || status.extensionConnected !== true) {
    throw new Error(buildDisconnectedError(status));
  }
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
    "Chrome extension uzerinden gercek Chrome sekmesini yonetir. Input: { action, ... }. Actions: status|getActiveTab|listTabs|openTab|navigateActive|extractActiveText|clickSelector|clickText|fillSelector|scrollPage|scrollToTop|scrollToBottom|scrollElement|getPageInfo|screenshotTab|wait|closeTab. Scroll aksiyonlari: scrollPage(direction=up|down, amount) sayfayi kaydirir; scrollToTop sayfanin en ustune gider (eski mesajlar icin); scrollToBottom en alta; scrollElement belirli bir container'i kaydirir; getPageInfo scrollY/atTop/atBottom/scrollPercent bilgisi verir. Instagram/DM gibi sayfalarda: once navigateActive, wait, getPageInfo, sonra scrollElement/scrollToTop ile yukari kaydir, wait, extractActiveText ile mesajlari oku. fillSelector icin opsiyonel: pressEnter, submit.",
  async run(input) {
    return runChromeLiveTask(input);
  }
};
