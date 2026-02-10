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

let installedApps = [];

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

function setConnectionStatus(online, detail = "") {
  statusDot.classList.toggle("online", Boolean(online));
  statusText.textContent = online ? `online${detail ? ` (${detail})` : ""}` : "offline";
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

  const response = await fetch(`${settings.baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Bridge request failed (${response.status})`);
  }

  return data;
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

async function checkConnection() {
  try {
    const [health, chromeStatus] = await Promise.all([
      callBridge("/health"),
      callBridge("/chrome/status")
    ]);

    const connected = Boolean(health?.ok && chromeStatus?.extensionConnected);
    setConnectionStatus(connected, connected ? "bridge+extension" : "bridge var, extension yok");

    if (!connected) {
      addChatMessage("system", "Bridge acik ama extension baglantisi yok. Gerekirse extension'i reload et.");
    }
  } catch (error) {
    setConnectionStatus(false);
    addChatMessage("system", `Baglanti hatasi: ${error.message}`);
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

await initializeSettings();
addChatMessage("system", "Hazir. Ajan komutu girebilirsin.");
await refreshTasks();
await refreshApprovalInfo();
try {
  await refreshInstalledApps();
} catch (error) {
  addChatMessage("system", error.message);
}
await checkConnection();
