const chatFeed = document.getElementById("chatFeed");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const taskNameInput = document.getElementById("taskName");
const taskPromptInput = document.getElementById("taskPrompt");
const runAtInput = document.getElementById("runAt");
const intervalMsInput = document.getElementById("intervalMs");
const tasksContainer = document.getElementById("tasks");

const baseUrlInput = document.getElementById("baseUrl");
const apiTokenInput = document.getElementById("apiToken");
const approvalInfo = document.getElementById("approvalInfo");

const openTargetInput = document.getElementById("openTarget");
const appQueryInput = document.getElementById("appQuery");
const installedAppsSelect = document.getElementById("installedApps");

const inspectorMeta = document.getElementById("inspectorMeta");
const toolTimeline = document.getElementById("toolTimeline");
const projectFiles = document.getElementById("projectFiles");
const diffTitle = document.getElementById("diffTitle");
const diffViewer = document.getElementById("diffViewer");
const clearInspectorButton = document.getElementById("clearInspector");

let installedApps = [];
let inspectorChanges = [];
let selectedInspectorChangeKey = "";
let lastBridgeConnected = null;
const systemNoticeTimestamps = new Map();

const DEFAULT_SETTINGS = {
  baseUrl: "http://127.0.0.1:3434",
  apiToken: ""
};

function addChatMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
  chatFeed.appendChild(bubble);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function addSystemMessageOnce(key, text, cooldownMs = 45000) {
  const now = Date.now();
  const previous = Number(systemNoticeTimestamps.get(key) || 0);
  if (now - previous < cooldownMs) {
    return;
  }

  systemNoticeTimestamps.set(key, now);
  addChatMessage("system", text);
}

function setConnectionStatus(online, detail = "") {
  statusDot.classList.toggle("online", Boolean(online));
  statusText.textContent = online ? `online${detail ? ` (${detail})` : ""}` : "offline";
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

function clipText(value, max = 140) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function normalizeStatus(statusValue) {
  const status = String(statusValue || "modified").toLowerCase();
  if (["added", "modified", "deleted", "unchanged"].includes(status)) {
    return status;
  }
  return "modified";
}

function collectProjectChanges(toolRuns) {
  const runs = Array.isArray(toolRuns) ? toolRuns : [];
  const allChanges = [];

  for (const run of runs) {
    if (!run || run.tool !== "project" || run.ok !== true || !run.output || typeof run.output !== "object") {
      continue;
    }

    const mode = String(run.output.mode || "").toLowerCase();
    if (Array.isArray(run.output.changes) && run.output.changes.length) {
      for (const item of run.output.changes) {
        const changePath = String(item?.path || "").trim();
        if (!changePath) {
          continue;
        }

        allChanges.push({
          key: `${run.step}:${changePath}:${allChanges.length}`,
          step: Number(run.step || 0),
          mode,
          path: changePath,
          status: normalizeStatus(item.status),
          diff: typeof item.diff === "string" ? item.diff : ""
        });
      }
      continue;
    }

    const fallbackSpecs = [
      { key: "createdFiles", status: "added" },
      { key: "writtenFiles", status: "modified" },
      { key: "deletedPaths", status: "deleted" }
    ];

    for (const spec of fallbackSpecs) {
      const values = Array.isArray(run.output[spec.key]) ? run.output[spec.key] : [];
      for (const value of values) {
        const changePath = String(value || "").trim();
        if (!changePath) {
          continue;
        }
        allChanges.push({
          key: `${run.step}:${changePath}:${allChanges.length}`,
          step: Number(run.step || 0),
          mode,
          path: changePath,
          status: spec.status,
          diff: ""
        });
      }
    }
  }

  const deduped = new Map();
  for (const change of allChanges) {
    deduped.set(change.path, change);
  }

  return Array.from(deduped.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function renderToolTimeline(toolRuns) {
  toolTimeline.innerHTML = "";
  const runs = Array.isArray(toolRuns) ? toolRuns : [];

  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Tool cagrisi yok.";
    toolTimeline.appendChild(empty);
    return;
  }

  for (const run of runs) {
    const item = document.createElement("div");
    item.className = `timeline-item ${run.ok === false ? "error" : ""}`.trim();

    const modeText =
      run.tool === "project" && run.output && typeof run.output === "object" && run.output.mode
        ? ` (${run.output.mode})`
        : "";
    const stateText = run.ok === false ? "error" : "ok";

    item.textContent = `#${run.step || "?"} ${run.tool}${modeText} -> ${stateText}`;
    toolTimeline.appendChild(item);
  }
}

function renderDiff(change) {
  if (!change) {
    diffTitle.textContent = "Diff Onizleme";
    diffViewer.textContent = "Dosya secildiginde diff burada gorunur.";
    return;
  }

  diffTitle.textContent = `Diff: ${clipText(change.path, 56)}`;
  diffViewer.textContent = change.diff || "Bu kayit icin diff bilgisi yok.";
}

function renderProjectFiles(changes) {
  projectFiles.innerHTML = "";

  if (!changes.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Henuz proje dosya degisikligi yok.";
    projectFiles.appendChild(empty);
    renderDiff(null);
    return;
  }

  for (const change of changes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `file-item ${selectedInspectorChangeKey === change.key ? "active" : ""}`.trim();

    const name = document.createElement("div");
    name.textContent = clipText(change.path, 80);

    const meta = document.createElement("div");
    meta.className = "file-meta";

    const left = document.createElement("span");
    left.className = "muted";
    left.textContent = `step ${change.step || "-"}`;

    const badge = document.createElement("span");
    badge.className = `badge ${change.status}`;
    badge.textContent = change.status;

    meta.append(left, badge);
    button.append(name, meta);

    button.addEventListener("click", () => {
      selectedInspectorChangeKey = change.key;
      renderProjectFiles(changes);
      renderDiff(change);
    });

    projectFiles.appendChild(button);
  }

  const selectedChange =
    changes.find((item) => item.key === selectedInspectorChangeKey) ||
    changes[0];

  if (selectedChange) {
    selectedInspectorChangeKey = selectedChange.key;
    renderDiff(selectedChange);
  }
}

function clearInspector() {
  inspectorChanges = [];
  selectedInspectorChangeKey = "";
  inspectorMeta.textContent = "Henuz proje degisikligi yok.";
  renderToolTimeline([]);
  renderProjectFiles([]);
}

function updateInspector(result) {
  const toolRuns = Array.isArray(result?.toolRuns) ? result.toolRuns : [];
  inspectorChanges = collectProjectChanges(toolRuns);

  inspectorMeta.textContent = `Adim: ${result?.stepsUsed || 0} | Tool: ${toolRuns.length} | Dosya: ${inspectorChanges.length}`;

  renderToolTimeline(toolRuns);
  renderProjectFiles(inspectorChanges);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(["kaesraSettings"]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.kaesraSettings || {})
  };
}

async function saveSettings() {
  const settings = {
    baseUrl: (baseUrlInput.value || "").trim() || DEFAULT_SETTINGS.baseUrl,
    apiToken: (apiTokenInput.value || "").trim()
  };

  await chrome.storage.local.set({ kaesraSettings: settings });
  addChatMessage("system", "Bridge ayarlari kaydedildi.");
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

async function getCurrentTabSnapshot(limit = 7000) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    return {
      title: "",
      url: "",
      text: ""
    };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (maxChars) => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      return {
        title: document.title || "",
        url: location.href,
        text: text.slice(0, maxChars)
      };
    },
    args: [limit]
  });

  return results[0]?.result || { title: "", url: tab.url || "", text: "" };
}

async function sendPrompt(promptText) {
  const text = String(promptText || "").trim();
  if (!text) {
    return;
  }

  addChatMessage("user", text);
  const thinking = document.createElement("div");
  thinking.className = "bubble system";
  thinking.textContent = "Isleniyor...";
  chatFeed.appendChild(thinking);
  chatFeed.scrollTop = chatFeed.scrollHeight;

  try {
    const response = await callBridge("/agent/ask", {
      method: "POST",
      body: { prompt: text }
    });

    thinking.remove();
    addChatMessage("agent", response.result?.message || JSON.stringify(response, null, 2));
    updateInspector(response.result || {});
  } catch (error) {
    thinking.remove();
    addChatMessage("system", error.message || String(error));
  }
}

function toTaskElement(task) {
  const wrapper = document.createElement("div");
  wrapper.className = "task";

  const title = document.createElement("strong");
  title.textContent = `${task.name} ${task.enabled ? "" : "(pasif)"}`;

  const meta = document.createElement("small");
  meta.textContent = `id: ${task.id.slice(0, 8)} | next: ${task.nextRunAt || "-"}`;

  const actions = document.createElement("div");
  actions.className = "row";

  const runButton = document.createElement("button");
  runButton.textContent = "Simdi";

  runButton.addEventListener("click", async () => {
    try {
      const result = await callBridge(`/tasks/${encodeURIComponent(task.id)}/run`, {
        method: "POST"
      });
      addChatMessage("system", `Gorev calisti: ${JSON.stringify(result)}`);
      await refreshTasks();
    } catch (error) {
      addChatMessage("system", error.message);
    }
  });

  const toggleButton = document.createElement("button");
  toggleButton.className = "secondary";
  toggleButton.textContent = task.enabled ? "Pasif" : "Aktif";

  toggleButton.addEventListener("click", async () => {
    try {
      await callBridge(`/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: {
          enabled: !task.enabled
        }
      });
      await refreshTasks();
    } catch (error) {
      addChatMessage("system", error.message);
    }
  });

  actions.append(runButton, toggleButton);
  wrapper.append(title, meta, actions);
  return wrapper;
}

async function refreshTasks() {
  try {
    const data = await callBridge("/tasks");
    tasksContainer.innerHTML = "";

    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (!tasks.length) {
      tasksContainer.textContent = "Kayitli gorev yok.";
      return;
    }

    for (const task of tasks) {
      tasksContainer.appendChild(toTaskElement(task));
    }
  } catch (error) {
    addChatMessage("system", error.message);
  }
}

function renderInstalledApps(items) {
  installedApps = Array.isArray(items) ? items : [];
  installedAppsSelect.innerHTML = "";

  if (!installedApps.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Program bulunamadi.";
    installedAppsSelect.appendChild(option);
    return;
  }

  for (const app of installedApps) {
    const option = document.createElement("option");
    option.value = app.id || "";
    option.textContent = `${app.name} [${app.source}]`;
    installedAppsSelect.appendChild(option);
  }
}

async function refreshInstalledApps({ refresh = false } = {}) {
  const query = (appQueryInput.value || "").trim();
  const params = new URLSearchParams({
    installed: "1",
    limit: "200"
  });

  if (refresh) {
    params.set("refresh", "1");
  }

  if (query) {
    params.set("query", query);
  }

  const data = await callBridge(`/desktop/apps?${params.toString()}`);
  renderInstalledApps(data.apps || []);
  addChatMessage("system", `Program listesi guncellendi. ${data.returned}/${data.total}`);
}

async function refreshApprovalInfo() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "approval:listRules"
    });

    if (!response?.ok) {
      approvalInfo.textContent = "Kayitli izin kurallari okunamadi.";
      return;
    }

    const count = Array.isArray(response.rules) ? response.rules.length : 0;
    approvalInfo.textContent = `Kayitli izin kurali: ${count}`;
  } catch {
    approvalInfo.textContent = "Kayitli izin kurallari okunamadi.";
  }
}

async function getBackgroundBridgeStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "bridge:status"
    });

    if (!response?.ok || !response.status || typeof response.status !== "object") {
      return null;
    }

    return response.status;
  } catch {
    return null;
  }
}

async function checkConnection() {
  try {
    const [health, chromeStatus] = await Promise.all([callBridge("/health"), callBridge("/chrome/status")]);

    const connected = Boolean(health?.ok && chromeStatus?.extensionConnected);
    setConnectionStatus(connected, connected ? "bridge+extension" : "bridge var, extension yok");
    const changed = lastBridgeConnected !== connected;
    lastBridgeConnected = connected;

    if (!connected && (changed || chromeStatus?.lastPollAt == null)) {
      const backgroundStatus = await getBackgroundBridgeStatus();
      const details = [];

      if (backgroundStatus?.lastBridgeUrl) {
        details.push(`url=${backgroundStatus.lastBridgeUrl}`);
      }

      if (backgroundStatus?.lastPollError) {
        details.push(`workerError=${clipText(backgroundStatus.lastPollError, 120)}`);
      }

      if (backgroundStatus?.lastPollSuccessAt) {
        details.push(`workerLastOk=${backgroundStatus.lastPollSuccessAt}`);
      }

      if (Number.isFinite(backgroundStatus?.consecutivePollFailures)) {
        details.push(`workerFail=${backgroundStatus.consecutivePollFailures}`);
      }

      const suffix = details.length ? ` (${details.join(", ")})` : "";

      addSystemMessageOnce(
        "bridge-extension-disconnected",
        `Bridge acik ama extension baglantisi yok. Gerekirse extension'i reload et.${suffix}`,
        60000
      );
    } else if (connected && changed) {
      addSystemMessageOnce("bridge-extension-connected", "Bridge ve extension baglandi.", 5000);
    }
  } catch (error) {
    setConnectionStatus(false);
    lastBridgeConnected = false;
    const backgroundStatus = await getBackgroundBridgeStatus();
    const suffix =
      backgroundStatus?.lastPollError && String(backgroundStatus.lastPollError).trim()
        ? ` | worker: ${clipText(backgroundStatus.lastPollError, 120)}`
        : "";
    addSystemMessageOnce(
      `bridge-connection-error:${error.message}`,
      `Baglanti hatasi: ${error.message}${suffix}`,
      20000
    );
  }
}

async function initializeSettings() {
  const settings = await getSettings();
  baseUrlInput.value = settings.baseUrl;
  apiTokenInput.value = settings.apiToken;
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = (chatInput.value || "").trim();
  if (!text) {
    return;
  }

  chatInput.value = "";
  await sendPrompt(text);
});

document.getElementById("summarizeTab").addEventListener("click", async () => {
  try {
    const page = await getCurrentTabSnapshot();
    const prompt = `Bu sayfayi Turkce olarak kisa maddelerle ozetle. Baslik: ${page.title}\nURL: ${page.url}\nIcerik: ${page.text}`;
    await sendPrompt(prompt);
  } catch (error) {
    addChatMessage("system", error.message);
  }
});

document.getElementById("checkBridge").addEventListener("click", async () => {
  await checkConnection();
});

document.getElementById("saveSettings").addEventListener("click", async () => {
  try {
    await saveSettings();
    await checkConnection();
  } catch (error) {
    addChatMessage("system", error.message);
  }
});

document.getElementById("clearApprovals").addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({
      type: "approval:clearRules"
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Izin kurallari temizlenemedi");
    }

    addChatMessage("system", "Kayitli izin kurallari temizlendi.");
    await refreshApprovalInfo();
  } catch (error) {
    addChatMessage("system", error.message || String(error));
  }
});

document.getElementById("createTask").addEventListener("click", async () => {
  const name = (taskNameInput.value || "").trim();
  const prompt = (taskPromptInput.value || "").trim();

  if (!name || !prompt) {
    addChatMessage("system", "Gorev adi ve prompt zorunlu.");
    return;
  }

  const intervalMsRaw = (intervalMsInput.value || "").trim();
  const runAtRaw = (runAtInput.value || "").trim();

  try {
    await callBridge("/tasks", {
      method: "POST",
      body: {
        name,
        prompt,
        runAt: runAtRaw || undefined,
        intervalMs: intervalMsRaw ? Number(intervalMsRaw) : undefined,
        enabled: true
      }
    });

    addChatMessage("system", `Gorev olusturuldu: ${name}`);
    await refreshTasks();
  } catch (error) {
    addChatMessage("system", error.message);
  }
});

document.getElementById("refreshTasks").addEventListener("click", async () => {
  await refreshTasks();
});

document.getElementById("openApp").addEventListener("click", async () => {
  const target = (openTargetInput.value || "").trim();
  if (!target) {
    addChatMessage("system", "Uygulama hedefi bos olamaz.");
    return;
  }

  try {
    const response = await callBridge("/desktop/open", {
      method: "POST",
      body: {
        target,
        appName: target
      }
    });

    addChatMessage("system", `Program calistirma sonucu: ${JSON.stringify(response)}`);
  } catch (error) {
    addChatMessage("system", error.message);
  }
});

document.getElementById("refreshApps").addEventListener("click", async () => {
  try {
    await refreshInstalledApps({ refresh: true });
  } catch (error) {
    addChatMessage("system", error.message);
  }
});

document.getElementById("openSelectedApp").addEventListener("click", async () => {
  const appId = installedAppsSelect.value;
  if (!appId) {
    addChatMessage("system", "Secilecek program bulunamadi.");
    return;
  }

  try {
    const response = await callBridge("/desktop/open-installed", {
      method: "POST",
      body: {
        id: appId
      }
    });

    addChatMessage("system", `Program calistirma sonucu: ${JSON.stringify(response)}`);
  } catch (error) {
    addChatMessage("system", error.message);
  }
});

clearInspectorButton.addEventListener("click", () => {
  clearInspector();
});

await initializeSettings();
addChatMessage("system", "Hazir. Ajan komutu girebilirsin.");
clearInspector();
await refreshTasks();
await refreshApprovalInfo();
try {
  await refreshInstalledApps();
} catch (error) {
  addChatMessage("system", error.message);
}
await checkConnection();
