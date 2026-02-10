const actionEl = document.getElementById("action");
const hostEl = document.getElementById("host");
const summaryEl = document.getElementById("summary");
const inputEl = document.getElementById("input");
const scopeEl = document.getElementById("scope");
const statusEl = document.getElementById("status");

const params = new URLSearchParams(location.search);
const requestId = params.get("requestId") || "";

function setStatus(text) {
  statusEl.textContent = text;
}

function pretty(value) {
  if (value === undefined || value === null) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function loadRequest() {
  if (!requestId) {
    setStatus("Gecersiz istek kimligi.");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "approval:getRequest",
    requestId
  });

  if (!response?.ok) {
    setStatus(response?.error || "Istek bulunamadi.");
    return;
  }

  const request = response.request || {};

  actionEl.textContent = request.action || "-";
  hostEl.textContent = request.host || "(domain yok)";
  summaryEl.textContent = request.summary || "-";
  inputEl.textContent = pretty(request.input || {});

  if (!request.host) {
    scopeEl.value = "global";
    scopeEl.disabled = true;
  }

  setStatus("Onay bekleniyor...");
}

async function submitDecision(decision, remember) {
  if (!requestId) {
    return;
  }

  try {
    setStatus("Gonderiliyor...");

    const response = await chrome.runtime.sendMessage({
      type: "approval:submitDecision",
      requestId,
      decision,
      remember,
      scope: scopeEl.value
    });

    if (!response?.ok) {
      setStatus(response?.error || "Karar kaydedilemedi.");
      return;
    }

    setStatus("Karar gonderildi.");
    setTimeout(() => window.close(), 150);
  } catch (error) {
    setStatus(error?.message || String(error));
  }
}

document.getElementById("allowOnce").addEventListener("click", () => {
  void submitDecision("allow", false);
});

document.getElementById("allowAlways").addEventListener("click", () => {
  void submitDecision("allow", true);
});

document.getElementById("denyOnce").addEventListener("click", () => {
  void submitDecision("deny", false);
});

document.getElementById("denyAlways").addEventListener("click", () => {
  void submitDecision("deny", true);
});

void loadRequest();
