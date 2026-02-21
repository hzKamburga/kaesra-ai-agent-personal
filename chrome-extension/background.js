const DEFAULT_SETTINGS = {
  baseUrl: "http://127.0.0.1:3434",
  apiToken: ""
};

const POLL_WAIT_MS = 25000;
const RETRY_DELAY_MS = 3000;
const APPROVAL_RULES_KEY = "kaesraApprovalRules";
const APPROVAL_TIMEOUT_MS = 120000;
const DEFAULT_NAVIGATION_WAIT_MS = 7000;

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
  close: "closeTab"
};

const ACTIONS_REQUIRING_APPROVAL = new Set([
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
  "screenshotTab",
  "scrollElement",
  "closeTab"
]);

const TAB_SCOPED_ACTIONS = new Set([
  "getActiveTab",
  "navigateActive",
  "extractActiveText",
  "clickSelector",
  "clickText",
  "fillSelector",
  "scrollPage",
  "scrollToTop",
  "scrollToBottom",
  "getPageInfo",
  "screenshotTab",
  "scrollElement",
  "closeTab"
]);

let polling = false;
const pendingApprovals = new Map();
const bridgeDiagnostics = {
  lastPollAttemptAt: null,
  lastPollSuccessAt: null,
  lastPollError: "",
  lastBridgeUrl: normalizeUrl(DEFAULT_SETTINGS.baseUrl),
  consecutivePollFailures: 0
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) {
    return "";
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function buildBridgeBaseCandidates(baseUrl) {
  const normalized = normalizeUrl(baseUrl || DEFAULT_SETTINGS.baseUrl);
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
        candidates.push(normalizeUrl(next.toString()));
      }
    }
  } catch {
    // Keep the original candidate.
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function normalizeAction(action) {
  const raw = String(action || "").trim();
  if (!raw) {
    return "";
  }

  const alias = ACTION_ALIASES[raw.toLowerCase()];
  return alias || raw;
}

function parseHost(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(String(url));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pickTab(tab) {
  if (!tab) {
    return null;
  }

  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: tab.url || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned)
  };
}

function commandSummary(action, input = {}) {
  if (action === "openTab") {
    return `Yeni sekme ac: ${input.url || "(url yok)"}`;
  }

  if (action === "navigateActive") {
    return `Aktif sekmeyi yonlendir: ${input.url || "(url yok)"}`;
  }

  if (action === "clickSelector") {
    return `Element tikla: ${input.selector || "(selector yok)"}`;
  }

  if (action === "clickText") {
    return `Metne gore element tikla: ${input.text || "(metin yok)"}`;
  }

  if (action === "fillSelector") {
    return `Elemente yazi yaz: ${input.selector || "(selector yok)"}`;
  }

  if (action === "scrollPage") {
    return `Sayfayi kaydir: direction=${input.direction || "down"}, amount=${input.amount || 900}`;
  }

  if (action === "extractActiveText") {
    return `Aktif sekmeden metin oku (maxChars=${input.maxChars || 6000})`;
  }

  if (action === "closeTab") {
    return `Sekmeyi kapat (tabId=${input.tabId ?? "aktif"})`;
  }

  if (action === "listTabs") {
    return "Sekmeleri listele";
  }

  if (action === "getActiveTab") {
    return "Aktif sekme bilgisini al";
  }

  return `Komut: ${action}`;
}

function buildRuleKey(action, scope, host) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  const normalizedScope = scope === "domain" ? "domain" : "global";
  const normalizedHost = normalizedScope === "domain" && host ? String(host).toLowerCase() : "*";

  return `${normalizedAction}|${normalizedScope}|${normalizedHost}`;
}

async function getApprovalRules() {
  const stored = await chrome.storage.local.get([APPROVAL_RULES_KEY]);
  const rules = stored[APPROVAL_RULES_KEY];

  if (rules && typeof rules === "object" && !Array.isArray(rules)) {
    return rules;
  }

  return {};
}

async function setApprovalRules(rules) {
  await chrome.storage.local.set({
    [APPROVAL_RULES_KEY]: rules
  });
}

function getStoredDecision(rules, action, host) {
  const domainKey = host ? buildRuleKey(action, "domain", host) : null;
  const globalKey = buildRuleKey(action, "global", "*");

  if (domainKey && rules[domainKey]) {
    return rules[domainKey]?.decision || null;
  }

  if (rules[globalKey]) {
    return rules[globalKey]?.decision || null;
  }

  return null;
}

async function rememberDecision({ action, host, decision, scope }) {
  const rules = await getApprovalRules();
  const key = buildRuleKey(action, scope, host);

  rules[key] = {
    decision,
    action,
    scope: scope === "domain" ? "domain" : "global",
    host: scope === "domain" ? host || "" : "*",
    updatedAt: new Date().toISOString()
  };

  await setApprovalRules(rules);
}

async function clearApprovalRules() {
  await setApprovalRules({});
}

async function listApprovalRules() {
  const rules = await getApprovalRules();
  const entries = Object.entries(rules).map(([key, value]) => ({
    key,
    ...(value || {})
  }));

  entries.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return entries;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(["kaesraSettings"]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.kaesraSettings || {})
  };
}

async function callBridge(path, options = {}) {
  const settings = await getSettings();
  const headers = {
    "Content-Type": "application/json"
  };

  if (settings.apiToken) {
    headers["X-Agent-Token"] = settings.apiToken;
  }

  const candidates = buildBridgeBaseCandidates(settings.baseUrl);
  let lastNetworkError = null;

  for (const baseUrl of candidates) {
    let response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
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

  if (lastNetworkError) {
    throw new Error(
      `Bridge baglantisi kurulamadi (${candidates.join(" | ")}): ${lastNetworkError.message || String(lastNetworkError)}`
    );
  }

  throw new Error("Bridge baglantisi kurulamadi: gecerli bir URL bulunamadi.");
}

function notePollAttempt(baseUrl) {
  bridgeDiagnostics.lastPollAttemptAt = new Date().toISOString();
  bridgeDiagnostics.lastBridgeUrl = normalizeUrl(baseUrl || DEFAULT_SETTINGS.baseUrl) || DEFAULT_SETTINGS.baseUrl;
}

function notePollSuccess() {
  bridgeDiagnostics.lastPollSuccessAt = new Date().toISOString();
  bridgeDiagnostics.lastPollError = "";
  bridgeDiagnostics.consecutivePollFailures = 0;
}

function notePollFailure(error) {
  bridgeDiagnostics.lastPollError = String(error?.message || error || "");
  bridgeDiagnostics.consecutivePollFailures += 1;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  return tab;
}

async function getTabByInput(tabId) {
  if (tabId !== undefined && tabId !== null) {
    const tab = await chrome.tabs.get(Number(tabId));
    if (!tab?.id) {
      throw new Error(`Tab not found: ${tabId}`);
    }
    return tab;
  }

  return getActiveTab();
}

async function runScript(tabId, func, args = []) {
  const execution = await chrome.scripting.executeScript({
    target: { tabId: Number(tabId) },
    func,
    args
  });

  return execution[0]?.result;
}

async function waitForTabLoad(tabId, timeoutMs = DEFAULT_NAVIGATION_WAIT_MS) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) {
    return null;
  }

  const timeout = Math.max(500, Math.min(20000, Number(timeoutMs) || DEFAULT_NAVIGATION_WAIT_MS));

  try {
    const current = await chrome.tabs.get(id);
    if (current?.status === "complete") {
      return current;
    }
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = async () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);

      try {
        resolve(await chrome.tabs.get(id));
      } catch {
        resolve(null);
      }
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== id) {
        return;
      }

      if (changeInfo.status === "complete") {
        void finish();
      }
    };

    const timer = setTimeout(() => {
      void finish();
    }, timeout);

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function buildApprovalContext(command) {
  const action = normalizeAction(command?.action);
  const input = command?.input && typeof command.input === "object" ? command.input : {};

  let tab = null;

  if (input.tabId !== undefined && input.tabId !== null) {
    try {
      tab = await chrome.tabs.get(Number(input.tabId));
    } catch {
      tab = null;
    }
  } else if (TAB_SCOPED_ACTIONS.has(action)) {
    try {
      tab = await getActiveTab();
    } catch {
      tab = null;
    }
  }

  const hostFromInput = parseHost(input.url);
  const hostFromTab = parseHost(tab?.url);

  return {
    action,
    host: hostFromInput || hostFromTab || "",
    summary: commandSummary(action, input),
    tab: pickTab(tab),
    input
  };
}

function approvalRequestToPayload(request) {
  return {
    requestId: request.requestId,
    action: request.context.action,
    host: request.context.host,
    summary: request.context.summary,
    tab: request.context.tab,
    input: request.context.input,
    createdAt: request.createdAt
  };
}

async function promptForApproval(command, context) {
  const requestId = crypto.randomUUID();

  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingApprovals.delete(requestId);
      reject(new Error("Kullanici izni zaman asimina ugradi"));
    }, APPROVAL_TIMEOUT_MS);

    const request = {
      requestId,
      command,
      context,
      createdAt: new Date().toISOString(),
      resolve,
      reject,
      timeoutId,
      windowId: null
    };

    pendingApprovals.set(requestId, request);

    try {
      const pageUrl = chrome.runtime.getURL(`permission.html?requestId=${encodeURIComponent(requestId)}`);
      const createdWindow = await chrome.windows.create({
        url: pageUrl,
        type: "popup",
        width: 460,
        height: 660,
        focused: true
      });

      request.windowId = createdWindow?.id || null;
    } catch (error) {
      clearTimeout(timeoutId);
      pendingApprovals.delete(requestId);
      reject(new Error(`Izin penceresi acilamadi: ${error?.message || error}`));
    }
  });
}

async function ensureCommandApproved(command) {
  const action = normalizeAction(command?.action);

  if (!ACTIONS_REQUIRING_APPROVAL.has(action)) {
    return;
  }

  const context = await buildApprovalContext(command);
  const rules = await getApprovalRules();
  const storedDecision = getStoredDecision(rules, context.action, context.host);

  if (storedDecision === "allow") {
    return;
  }

  if (storedDecision === "deny") {
    throw new Error("Komut kayitli izin kuralina gore engellendi");
  }

  const approved = await promptForApproval(command, context);
  if (!approved) {
    throw new Error("Kullanici komutu reddetti");
  }
}

async function settleApprovalRequest({ requestId, decision, remember, scope }, sender) {
  const request = pendingApprovals.get(requestId);
  if (!request) {
    return {
      ok: false,
      error: "Approval request not found"
    };
  }

  clearTimeout(request.timeoutId);
  pendingApprovals.delete(requestId);

  const approved = decision === "allow";

  if (remember) {
    await rememberDecision({
      action: request.context.action,
      host: request.context.host,
      decision: approved ? "allow" : "deny",
      scope: scope === "domain" && request.context.host ? "domain" : "global"
    });
  }

  if (approved) {
    request.resolve(true);
  } else {
    request.resolve(false);
  }

  const windowId = sender?.tab?.windowId || request.windowId;
  if (windowId !== undefined && windowId !== null) {
    void chrome.windows.remove(windowId).catch(() => { });
  }

  return {
    ok: true
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || "").trim();

  if (type === "approval:getRequest") {
    const requestId = String(message.requestId || "").trim();
    const request = pendingApprovals.get(requestId);

    if (!request) {
      sendResponse({ ok: false, error: "Request not found" });
      return false;
    }

    sendResponse({
      ok: true,
      request: approvalRequestToPayload(request)
    });
    return false;
  }

  if (type === "approval:submitDecision") {
    const requestId = String(message.requestId || "").trim();
    const decision = String(message.decision || "deny").toLowerCase() === "allow" ? "allow" : "deny";
    const remember = Boolean(message.remember);
    const scope = String(message.scope || "domain").toLowerCase() === "global" ? "global" : "domain";

    void settleApprovalRequest(
      {
        requestId,
        decision,
        remember,
        scope
      },
      sender
    )
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || String(error)
        });
      });

    return true;
  }

  if (type === "approval:listRules") {
    void listApprovalRules()
      .then((rules) => {
        sendResponse({ ok: true, rules });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });

    return true;
  }

  if (type === "approval:clearRules") {
    void clearApprovalRules()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });

    return true;
  }

  if (type === "bridge:status") {
    sendResponse({
      ok: true,
      status: {
        polling,
        ...bridgeDiagnostics
      }
    });
    return false;
  }

  return false;
});

async function executeChromeCommand(command) {
  const rawAction = String(command?.action || "").trim();
  const action = normalizeAction(rawAction);
  const input = command?.input && typeof command.input === "object" ? command.input : {};

  if (!action) {
    throw new Error("Command action is required");
  }

  if (action === "getActiveTab") {
    const tab = await getActiveTab();
    return pickTab(tab);
  }

  if (action === "listTabs") {
    const query = {
      currentWindow: input.currentWindow !== false
    };

    if (input.windowId !== undefined && input.windowId !== null) {
      query.windowId = Number(input.windowId);
    }

    const tabs = await chrome.tabs.query(query);
    return tabs.map((tab) => pickTab(tab));
  }

  if (action === "openTab") {
    const url = String(input.url || "").trim();
    if (!url) {
      throw new Error("openTab requires url");
    }

    const created = await chrome.tabs.create({
      url,
      active: input.active !== false
    });

    if (input.waitForLoad === false) {
      return pickTab(created);
    }

    const loadedTab = await waitForTabLoad(created.id, input.waitForLoadMs);
    return pickTab(loadedTab || created);
  }

  if (action === "navigateActive") {
    const url = String(input.url || "").trim();
    if (!url) {
      throw new Error("navigateActive requires url");
    }

    const tab = await getActiveTab();
    const updated = await chrome.tabs.update(tab.id, { url });

    if (input.waitForLoad === false) {
      return pickTab(updated);
    }

    const loadedTab = await waitForTabLoad(updated.id, input.waitForLoadMs);
    return pickTab(loadedTab || updated);
  }

  if (action === "extractActiveText") {
    const tab = await getTabByInput(input.tabId);
    const maxChars = Math.max(200, Math.min(20000, Number(input.maxChars) || 6000));

    return runScript(
      tab.id,
      (limit) => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        return {
          title: document.title || "",
          url: location.href,
          text: text.slice(0, limit),
          scrollY: window.scrollY || 0,
          viewportHeight: window.innerHeight || 0,
          pageHeight: document.documentElement?.scrollHeight || 0
        };
      },
      [maxChars]
    );
  }

  if (action === "clickSelector") {
    const selector = String(input.selector || "").trim();
    if (!selector) {
      throw new Error("clickSelector requires selector");
    }

    const tab = await getTabByInput(input.tabId);

    return runScript(
      tab.id,
      (query, fallbackText = "") => {
        const bySelector = document.querySelector(query);
        if (bySelector) {
          bySelector.scrollIntoView({ block: "center", behavior: "auto" });
          bySelector.click();
          return { clicked: true, found: true, mode: "selector", selectorUsed: query };
        }

        const lowerNeedle = String(fallbackText || "").trim().toLowerCase();
        if (lowerNeedle) {
          const clickables = Array.from(
            document.querySelectorAll("button, a, [role='button'], input[type='submit'], input[type='button']")
          );

          const candidate = clickables.find((el) => {
            const textValue =
              (el.textContent || "").trim() ||
              (el.getAttribute("aria-label") || "").trim() ||
              (el.getAttribute("title") || "").trim() ||
              (el.getAttribute("value") || "").trim();

            return textValue.toLowerCase().includes(lowerNeedle);
          });

          if (candidate) {
            candidate.scrollIntoView({ block: "center", behavior: "auto" });
            candidate.click();
            return { clicked: true, found: true, mode: "text-fallback", selectorUsed: query };
          }
        }

        // Search button fallback for pages like YouTube.
        if (/search|ara/i.test(query)) {
          const fallbacks = [
            "button#search-icon-legacy",
            "#search-icon-legacy",
            "ytd-searchbox button",
            "button[aria-label*='Search' i]",
            "button[aria-label*='Ara' i]",
            "[role='button'][aria-label*='Search' i]",
            "[role='button'][aria-label*='Ara' i]"
          ];

          for (const fallbackSelector of fallbacks) {
            const el = document.querySelector(fallbackSelector);
            if (!el) {
              continue;
            }

            el.scrollIntoView({ block: "center", behavior: "auto" });
            el.click();
            return {
              clicked: true,
              found: true,
              mode: "selector-fallback",
              selectorUsed: fallbackSelector
            };
          }
        }

        return { clicked: false, found: false, selectorUsed: query };
      },
      [selector, input.text || input.fallbackText || ""]
    );
  }

  if (action === "clickText") {
    const text = String(input.text || "").trim();
    if (!text) {
      throw new Error("clickText requires text");
    }

    const tab = await getTabByInput(input.tabId);
    const exact = Boolean(input.exact);

    return runScript(
      tab.id,
      (targetText, shouldExact) => {
        const lowerNeedle = targetText.toLowerCase();
        const elements = Array.from(document.querySelectorAll("a, button, [role='button'], input[type='submit']"));

        const isMatch = (value) => {
          const textValue = String(value || "").trim().toLowerCase();
          if (!textValue) {
            return false;
          }

          if (shouldExact) {
            return textValue === lowerNeedle;
          }

          return textValue.includes(lowerNeedle);
        };

        const candidate = elements.find((el) => {
          const textContent = el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "";
          return isMatch(textContent);
        });

        if (!candidate) {
          return { clicked: false, found: false };
        }

        candidate.scrollIntoView({ block: "center", behavior: "auto" });
        candidate.click();

        const label =
          candidate.textContent?.trim() || candidate.getAttribute("aria-label") || candidate.getAttribute("title") || "";

        return { clicked: true, found: true, label };
      },
      [text, exact]
    );
  }

  if (action === "fillSelector") {
    const selector = String(input.selector || "").trim();
    const value = String(input.value || "");

    if (!selector) {
      throw new Error("fillSelector requires selector");
    }

    const tab = await getTabByInput(input.tabId);

    return runScript(
      tab.id,
      (query, text, options = {}) => {
        const defaultFallbacks = [
          "input#search",
          "input[name='search_query']",
          "input[name='search']",
          "input[type='search']",
          "textarea[name='search_query']",
          "input[type='text']"
        ];

        const selectors = [query];
        if (options.enableFallback !== false) {
          for (const candidate of defaultFallbacks) {
            if (!selectors.includes(candidate)) {
              selectors.push(candidate);
            }
          }
        }

        let element = null;
        let selectorUsed = query;

        for (const candidate of selectors) {
          const found = document.querySelector(candidate);
          if (!found) {
            continue;
          }

          element = found;
          selectorUsed = candidate;
          break;
        }

        if (!element) {
          return { filled: false, found: false, selectorUsed: query };
        }

        const dispatchInputEvents = () => {
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        };

        const isElementVisible = (target) => {
          if (!target || typeof target.getBoundingClientRect !== "function") {
            return false;
          }

          const style = window.getComputedStyle(target);
          if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return false;
          }

          const rect = target.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const tryClickSendButton = () => {
          const keywords = ["send", "submit", "gonder", "gönder", "yolla"];
          const candidates = Array.from(document.querySelectorAll("button, [role='button']"));

          for (const candidate of candidates) {
            const label = [
              candidate.textContent || "",
              candidate.getAttribute("aria-label") || "",
              candidate.getAttribute("title") || "",
              candidate.getAttribute("data-testid") || "",
              candidate.getAttribute("name") || ""
            ]
              .join(" ")
              .trim()
              .toLowerCase();

            if (!label) {
              continue;
            }

            if (!keywords.some((keyword) => label.includes(keyword))) {
              continue;
            }

            if (candidate.disabled || candidate.getAttribute("aria-disabled") === "true") {
              continue;
            }

            if (!isElementVisible(candidate)) {
              continue;
            }

            candidate.scrollIntoView({ block: "center", behavior: "auto" });
            candidate.click();
            return true;
          }

          return false;
        };

        element.focus();
        element.scrollIntoView({ block: "center", behavior: "auto" });

        if ("value" in element) {
          const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
          if (descriptor?.set) {
            descriptor.set.call(element, text);
          } else {
            element.value = text;
          }
          dispatchInputEvents();
        } else {
          element.textContent = text;
        }

        let submitted = false;
        let pressedEnter = false;

        if (options.pressEnter) {
          const keyOptions = {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true
          };
          element.dispatchEvent(new KeyboardEvent("keydown", keyOptions));
          element.dispatchEvent(new KeyboardEvent("keypress", keyOptions));
          element.dispatchEvent(new KeyboardEvent("keyup", keyOptions));
          pressedEnter = true;
        }

        if (options.submit) {
          const form = element.form || element.closest("form");
          if (form) {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit();
            } else {
              form.submit();
            }
            submitted = true;
          } else if (options.pressEnter) {
            submitted = true;
          }

          if (!form) {
            submitted = tryClickSendButton() || submitted;
          }
        }

        return {
          filled: true,
          found: true,
          selectorUsed,
          pressedEnter,
          submitted
        };
      },
      [
        selector,
        value,
        {
          enableFallback: input.enableFallback !== false,
          pressEnter: Boolean(input.pressEnter),
          submit: Boolean(input.submit)
        }
      ]
    );
  }

  if (action === "scrollPage") {
    const tab = await getTabByInput(input.tabId);
    const amount = Math.max(50, Math.min(5000, Number(input.amount) || 900));
    const direction = String(input.direction || "down").toLowerCase() === "up" ? -1 : 1;

    return runScript(
      tab.id,
      (scrollAmount, scrollDirection) => {
        const before = window.scrollY || 0;
        window.scrollBy({
          top: scrollAmount * scrollDirection,
          left: 0,
          behavior: "auto"
        });

        const after = window.scrollY || 0;
        return {
          before,
          after,
          moved: after - before,
          pageHeight: document.documentElement?.scrollHeight || 0,
          viewportHeight: window.innerHeight || 0
        };
      },
      [amount, direction]
    );
  }

  if (action === "scrollToTop") {
    const tab = await getTabByInput(input.tabId);
    return runScript(
      tab.id,
      () => {
        const before = window.scrollY || 0;
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return {
          before,
          after: 0,
          moved: -before,
          pageHeight: document.documentElement?.scrollHeight || 0,
          viewportHeight: window.innerHeight || 0,
          atTop: true
        };
      }
    );
  }

  if (action === "scrollToBottom") {
    const tab = await getTabByInput(input.tabId);
    return runScript(
      tab.id,
      () => {
        const before = window.scrollY || 0;
        const pageHeight = document.documentElement?.scrollHeight || 0;
        window.scrollTo({ top: pageHeight, left: 0, behavior: "auto" });
        const after = window.scrollY || 0;
        return {
          before,
          after,
          moved: after - before,
          pageHeight,
          viewportHeight: window.innerHeight || 0,
          atBottom: true
        };
      }
    );
  }

  if (action === "getPageInfo") {
    const tab = await getTabByInput(input.tabId);
    return runScript(
      tab.id,
      () => {
        const scrollY = window.scrollY || 0;
        const pageHeight = document.documentElement?.scrollHeight || 0;
        const viewportHeight = window.innerHeight || 0;
        const scrollable = pageHeight > viewportHeight;
        const atTop = scrollY <= 10;
        const atBottom = scrollY + viewportHeight >= pageHeight - 10;
        const scrollPercent = scrollable ? Math.round((scrollY / (pageHeight - viewportHeight)) * 100) : 100;
        return {
          url: location.href,
          title: document.title || "",
          scrollY,
          pageHeight,
          viewportHeight,
          scrollable,
          atTop,
          atBottom,
          scrollPercent
        };
      }
    );
  }

  if (action === "screenshotTab") {
    const tab = await getTabByInput(input.tabId);
    // Make the tab active before capture
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(300);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return {
      dataUrl,
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    };
  }

  if (action === "scrollElement") {
    const selector = String(input.selector || "").trim();
    const tab = await getTabByInput(input.tabId);
    const amount = Number(input.amount) || 600;
    const direction = String(input.direction || "up").toLowerCase() === "down" ? 1 : -1;

    return runScript(
      tab.id,
      (query, scrollAmount, scrollDir) => {
        const el = query ? document.querySelector(query) : null;
        if (!el) {
          // Fallback: try to find scrollable message container
          const candidates = Array.from(document.querySelectorAll("[role='log'], [role='main'], main, [class*='messages'], [class*='chat'], [class*='thread']"));
          const scrollableEl = candidates.find(c => c.scrollHeight > c.clientHeight) || document.documentElement;
          const before = scrollableEl.scrollTop || 0;
          scrollableEl.scrollBy({ top: scrollAmount * scrollDir, behavior: "auto" });
          const after = scrollableEl.scrollTop || 0;
          return { scrolled: true, element: scrollableEl.tagName, before, after, moved: after - before };
        }
        const before = el.scrollTop || 0;
        el.scrollBy({ top: scrollAmount * scrollDir, behavior: "auto" });
        const after = el.scrollTop || 0;
        return { scrolled: true, element: el.tagName, selector: query, before, after, moved: after - before };
      },
      [selector, amount, direction]
    );
  }

  if (action === "wait") {
    const rawMs = input.ms ?? input.durationMs ?? input.waitMs;
    const ms = Math.max(100, Math.min(15000, Number(rawMs) || 1000));
    await sleep(ms);
    return { waitedMs: ms };
  }

  if (action === "closeTab") {
    const tab = await getTabByInput(input.tabId);
    await chrome.tabs.remove(tab.id);
    return { closed: true, tabId: tab.id };
  }

  throw new Error(`Unsupported chrome action: ${rawAction || action}`);
}

async function getCurrentTabText(maxChars = 6000) {
  const tab = await getActiveTab();

  const result = await runScript(
    tab.id,
    (limit) => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      return {
        title: document.title || "",
        url: location.href,
        text: text.slice(0, limit)
      };
    },
    [maxChars]
  );

  return result || {
    title: tab.title || "",
    url: tab.url || "",
    text: ""
  };
}

async function pollBridgeLoop() {
  if (polling) {
    return;
  }

  polling = true;

  while (polling) {
    try {
      const settings = await getSettings();
      notePollAttempt(settings.baseUrl);

      const payload = await callBridge(`/chrome/poll?waitMs=${POLL_WAIT_MS}`);
      const command = payload?.command;
      notePollSuccess();

      if (!command) {
        continue;
      }

      let resultBody;

      try {
        await ensureCommandApproved(command);
        const result = await executeChromeCommand(command);
        resultBody = {
          commandId: command.id,
          ok: true,
          result
        };
      } catch (error) {
        resultBody = {
          commandId: command.id,
          ok: false,
          error: error?.message || String(error)
        };
      }

      await callBridge("/chrome/results", {
        method: "POST",
        body: resultBody
      });
    } catch (error) {
      notePollFailure(error);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "kaesra-summarize-tab",
      title: "Kaesra: Bu sayfayi ozetle",
      contexts: ["page"]
    });
  });
}

function ensurePolling() {
  void pollBridgeLoop();
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  ensurePolling();
  chrome.alarms.create("kaesra-bridge-ping", { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  ensurePolling();
  chrome.alarms.create("kaesra-bridge-ping", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "kaesra-bridge-ping") {
    ensurePolling();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.kaesraSettings) {
    ensurePolling();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "kaesra-summarize-tab" || !tab?.id) {
    return;
  }

  try {
    const page = await getCurrentTabText(7000);
    await callBridge("/agent/ask", {
      method: "POST",
      body: {
        prompt: `Su sayfayi kisa maddelerle ozetle. Baslik: ${page.title}\nURL: ${page.url}\nIcerik: ${page.text}`
      }
    });
  } catch {
    // ignore background errors
  }
});

ensurePolling();
