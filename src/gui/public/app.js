/* ═══════════════════════════════════════════════════════
   KAESRA AI AGENT — Terminal App Controller
   Connected to real backend via /api/* endpoints
   ═══════════════════════════════════════════════════════ */

(function () {
    "use strict";

    // ── API Base URL ──────────────────────────────────────
    const API_BASE = window.location.origin;

    // ── State ─────────────────────────────────────────────
    const state = {
        currentView: "terminal",
        currentMode: "terminal",
        history: [],
        historyIndex: -1,
        isProcessing: false,
        chatMessages: [],
        connectedModel: "...",
        connectedProvider: "..."
    };

    // ── DOM Refs ─────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => [...document.querySelectorAll(sel)];
    const termOutput = $("#terminal-output");
    const termLines = $("#terminal-lines");
    const cmdInput = $("#command-input");
    const btnSend = $("#btn-send");
    const charCount = $("#char-count");
    const promptMarker = $("#prompt-marker");
    const ctxMode = $("#ctx-mode");
    const toastContainer = $("#toast-container");
    const statusDot = $("#status-dot");
    const statusModel = $("#status-model");
    const statusProvider = $("#status-provider");

    // ── ANSI Color Map ────────────────────────────────────
    const COLORS = {
        blue: "#5ba4f5",
        purple: "#a78bfa",
        pink: "#f472b6",
        cyan: "#22d3ee",
        green: "#34d399",
        amber: "#fbbf24",
        red: "#f87171",
        muted: "#64748b",
        text: "#e8ecf4"
    };

    // ── Utility ──────────────────────────────────────────
    function escapeHtml(str) {
        const el = document.createElement("span");
        el.textContent = str;
        return el.innerHTML;
    }

    function shortText(val, max = 200) {
        if (!val) return "";
        const str = typeof val === "string" ? val : JSON.stringify(val);
        return str.length <= max ? str : str.slice(0, max - 3) + "...";
    }

    function parseMarkdown(text) {
        if (!text) return "";
        let html = escapeHtml(text);
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => `<pre class="code-block"><code class="language-${lang || 'text'}">${code}</code></pre>`);
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // ── Toast System ─────────────────────────────────────
    function showToast(message, type = "info", duration = 3500) {
        const icons = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.innerHTML = `
      <span class="toast-icon">${icons[type] || "ℹ"}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
    `;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(20px)";
            toast.style.transition = "all 200ms ease-in";
            setTimeout(() => toast.remove(), 200);
        }, duration);
    }

    // ── Terminal Line Rendering ──────────────────────────
    function addLine(content, type = "system", options = {}) {
        const symbols = {
            user: "❯",
            agent: "✦",
            system: "→",
            error: "✕",
            success: "✓",
            info: "ℹ"
        };

        const line = document.createElement("div");
        line.className = `terminal-line ${type}-line`;

        const symbolEl = document.createElement("span");
        symbolEl.className = "prompt-symbol";
        symbolEl.textContent = options.symbol || symbols[type] || "→";

        const contentEl = document.createElement("span");
        contentEl.className = "line-content";

        // Auto-extract JSON message if applicable
        if (typeof content === "string" && content.trim().startsWith('{"type":"final"') && content.includes('"message":')) {
            try {
                const parsed = JSON.parse(content);
                if (parsed.message) content = parsed.message;
            } catch { /* ignore */ }
        }

        if (options.html) {
            contentEl.innerHTML = content;
        } else if (type === "agent" || type === "user") {
            // Use markdown for chat messages
            contentEl.innerHTML = parseMarkdown(content);
        } else {
            contentEl.textContent = content;
        }

        line.appendChild(symbolEl);
        line.appendChild(contentEl);
        termLines.appendChild(line);
        scrollToBottom();
        return line;
    }

    function renderDiffBlock(changes) {
        if (!Array.isArray(changes) || !changes.length) return "";

        let html = `<div class="diff-container" style="font-family:monospace; font-size:12px; margin-top:10px;">`;

        for (const change of changes) {
            const statusColor = change.status === "added" ? "#4ade80" :
                change.status === "modified" ? "#facc15" : "#94a3b8";

            html += `<div style="margin-bottom:8px; border:1px solid #334155; border-radius:4px; overflow:hidden;">
                <div style="background:#1e293b; padding:4px 8px; border-bottom:1px solid #334155; display:flex; justify-content:space-between;">
                    <span style="color:${statusColor}; font-weight:bold;">${escapeHtml(change.status.toUpperCase())}</span>
                    <span style="color:#e2e8f0;">${escapeHtml(change.path)}</span>
                </div>`;

            if (change.diff) {
                const diffLines = change.diff.split("\n").map(line => {
                    let color = "#cbd5e1";
                    let bg = "transparent";
                    if (line.startsWith("+")) { color = "#86efac"; bg = "rgba(74, 222, 128, 0.1)"; }
                    else if (line.startsWith("-")) { color = "#fda4af"; bg = "rgba(248, 113, 113, 0.1)"; }
                    else if (line.startsWith("@@")) { color = "#c084fc"; }

                    return `<div style="padding:0 4px; background:${bg}; color:${color}; white-space:pre-wrap;">${escapeHtml(line)}</div>`;
                }).join("");

                html += `<div style="padding:8px; background:#0f172a; overflow-x:auto;">${diffLines}</div>`;
            }

            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    function addToolCard(toolName, body, status = "running") {
        const card = document.createElement("div");
        card.className = "tool-card";
        const statusClass = status === "done" ? "done" : status === "error" ? "error" : "running";

        let bodyContent = "";
        let isDiff = false;

        if (typeof body === "string") {
            try {
                // Try to parse if it looks like JSON to see if we can render it better
                const parsed = JSON.parse(body);
                if (parsed && typeof parsed === "object") {
                    if (parsed.changes && Array.isArray(parsed.changes)) {
                        bodyContent = renderDiffBlock(parsed.changes);
                        isDiff = true;
                    } else if (parsed.files && Array.isArray(parsed.files)) {
                        bodyContent = `<div style="color:${COLORS.green}">Generated ${parsed.files.length} files.</div>`;
                    } else {
                        // Fallback to pretty print if small enough, else shortText
                        const pretty = JSON.stringify(parsed, null, 2);
                        bodyContent = pretty.length < 2000 ? `<pre style="margin:0;overflow:auto;">${escapeHtml(pretty)}</pre>` : escapeHtml(shortText(body, 800));
                    }
                } else {
                    bodyContent = escapeHtml(shortText(body, 800));
                }
            } catch {
                bodyContent = escapeHtml(shortText(body, 800));
            }
        } else if (typeof body === "object" && body !== null) {
            if (body.changes && Array.isArray(body.changes)) {
                bodyContent = renderDiffBlock(body.changes);
                isDiff = true;
            } else {
                const pretty = JSON.stringify(body, null, 2);
                bodyContent = pretty.length < 2000 ? `<pre style="margin:0;overflow:auto;">${escapeHtml(pretty)}</pre>` : escapeHtml(shortText(JSON.stringify(body), 800));
            }
        } else {
            bodyContent = escapeHtml(String(body));
        }

        card.innerHTML = `
      <div class="tool-card-header">
        <span class="tool-card-icon">⚙️</span>
        <span class="tool-card-name">${escapeHtml(toolName)}</span>
        <span class="tool-card-status ${statusClass}">${status.toUpperCase()}</span>
      </div>
      <div class="tool-card-body ${isDiff ? 'expanded' : ''}">${bodyContent}</div>
    `;
        card.addEventListener("click", (e) => {
            // Don't toggle if clicking inside diff content interaction
            if (e.target.closest(".tool-card-body") && isDiff) return; // Optional: allow toggle? Let's allow toggle.
            card.querySelector(".tool-card-body").classList.toggle("expanded");
        });
        termLines.appendChild(card);
        scrollToBottom();
        return card;
    }

    function addThinking(text = "Düşünüyor...") {
        removeThinking();
        const indicator = document.createElement("div");
        indicator.className = "thinking-indicator";
        indicator.id = "current-thinking";
        indicator.innerHTML = `
      <div class="thinking-dots"><span></span><span></span><span></span></div>
      <span class="thinking-text">${escapeHtml(text)}</span>
    `;
        termLines.appendChild(indicator);
        scrollToBottom();
        return indicator;
    }

    function removeThinking() {
        const el = $("#current-thinking");
        if (el) el.remove();
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            termOutput.scrollTop = termOutput.scrollHeight;
        });
        // Extra robustness for dynamic content loading
        setTimeout(() => {
            termOutput.scrollTop = termOutput.scrollHeight;
        }, 50);
    }

    function clearTerminal() {
        termLines.innerHTML = "";
    }

    function renderJsonBlock(data, title) {
        const wrapper = document.createElement("div");
        wrapper.className = "code-block";
        wrapper.style.margin = "8px 0";

        let jsonStr;
        try {
            jsonStr = JSON.stringify(data, null, 2);
        } catch {
            jsonStr = String(data);
        }

        // Basic syntax coloring
        const colored = escapeHtml(jsonStr)
            .replace(/"([^"]+)":/g, `<span class="keyword">"$1"</span>:`)
            .replace(/: "([^"]*)"/g, `: <span class="string">"$1"</span>`)
            .replace(/: (\d+)/g, `: <span class="number">$1</span>`)
            .replace(/: (true|false|null)/g, `: <span class="keyword">$1</span>`);

        if (title) {
            const titleEl = document.createElement("div");
            titleEl.style.cssText = `font-weight:600;color:${COLORS.purple};margin-bottom:4px;font-size:11px;`;
            titleEl.textContent = title;
            termLines.appendChild(titleEl);
        }
        wrapper.innerHTML = colored;
        termLines.appendChild(wrapper);
        scrollToBottom();
    }

    // ── API Helpers ──────────────────────────────────────
    async function apiGet(path) {
        const resp = await fetch(`${API_BASE}${path}`);
        return resp.json();
    }

    async function apiPost(path, body) {
        const resp = await fetch(`${API_BASE}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return resp.json();
    }

    // SSE stream for chat/ask endpoints
    function apiSSE(path, body, { onToolCall, onToolResult, onToolError, onDone, onError }) {
        return new Promise((resolve) => {
            fetch(`${API_BASE}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }).then(async (resp) => {
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({ error: "Bağlantı hatası" }));
                    if (onError) onError(err.error || "API hatası");
                    resolve();
                    return;
                }

                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    let currentEvent = null;
                    for (const line of lines) {
                        if (line.startsWith("event: ")) {
                            currentEvent = line.slice(7).trim();
                        } else if (line.startsWith("data: ") && currentEvent) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                switch (currentEvent) {
                                    case "tool_call":
                                        if (onToolCall) onToolCall(data);
                                        break;
                                    case "tool_result":
                                        if (onToolResult) onToolResult(data);
                                        break;
                                    case "tool_error":
                                        if (onToolError) onToolError(data);
                                        break;
                                    case "done":
                                        if (onDone) onDone(data);
                                        break;
                                    case "error":
                                        if (onError) onError(data.error || "Bilinmeyen hata");
                                        break;
                                }
                            } catch { /* ignore parse errors */ }
                            currentEvent = null;
                        }
                    }
                }
                resolve();
            }).catch((err) => {
                if (onError) onError(err.message || "Bağlantı sağlanamadı");
                resolve();
            });
        });
    }

    // ── Navigation ───────────────────────────────────────
    function setActiveView(viewName) {
        state.currentView = viewName;
        $$(".nav-item").forEach((el) => {
            el.classList.toggle("active", el.dataset.view === viewName);
        });
        ctxMode.textContent = viewName;



        const markers = {
            terminal: "❯", chat: "💬", research: "🔍", tasks: "📋",
            chrome: "🌐", desktop: "🖥️", api: "⚡", browser: "🤖",
            project: "📦", tools: "🔧"
        };
        promptMarker.textContent = markers[viewName] || "❯";
        state.currentMode = viewName;

        // Auto-run view initializer
        const viewInit = {
            tools: cmdShowTools,
            tasks: cmdShowTasks,
            chrome: cmdChromeStatus,
            desktop: cmdDesktopApps
        };
        if (viewInit[viewName]) {
            clearTerminal();
            viewInit[viewName]();
        }
    }

    // ── Command Processing ───────────────────────────────
    const COMMANDS = {
        help: cmdHelp,
        clear: cmdClear,
        reset: cmdReset,
        tools: cmdShowTools,
        tasks: cmdShowTasks,
        version: cmdVersion,
        status: cmdStatus,
        exit: cmdExit,
        back: () => setActiveView("terminal")
    };

    async function processInput(raw) {
        const text = raw.trim();
        if (!text || state.isProcessing) return;



        state.history.push(text);
        state.historyIndex = state.history.length;

        if (text.startsWith("/")) {
            const parts = text.slice(1).split(/\s+/);
            const cmd = parts[0].toLowerCase();
            const args = parts.slice(1).join(" ");
            addLine(text, "user");
            if (COMMANDS[cmd]) {
                await COMMANDS[cmd](args);
            } else {
                addLine(`Bilinmeyen komut: /${cmd}. /help ile komutları gör.`, "error");
            }
            return;
        }

        addLine(text, "user");
        state.isProcessing = true;

        try {
            switch (state.currentMode) {
                case "chat":
                    await processChatMessage(text);
                    break;
                case "research":
                    await processResearch(text);
                    break;
                default:
                    await processAsk(text);
                    break;
            }
        } catch (err) {
            addLine(err.message || "Bir hata oluştu", "error");
            showToast(err.message || "Hata", "error");
        } finally {
            state.isProcessing = false;
        }
    }

    // ── Slash Command Handlers ────────────────────────────
    function cmdHelp() {
        addLine("Kaesra AI Agent — Komut Referansı", "success", { symbol: "📖" });
        const help = [
            ["/help", "Komutları listele"],
            ["/clear", "Ekranı temizle"],
            ["/reset", "Chat hafızasını sıfırla"],
            ["/tools", "Mevcut tool'ları listele"],
            ["/tasks", "Görevleri listele"],
            ["/status", "Bağlantı durumunu göster"],
            ["/version", "Versiyon bilgisi"],
            ["/back", "Terminal moduna dön"],
            ["/exit", "Uygulamayı kapat"]
        ];
        help.forEach(([cmd, desc]) => {
            addLine(`  <span style="color:${COLORS.blue};font-weight:600">${cmd}</span>  →  ${desc}`, "system", { html: true });
        });
        addLine("", "system");
        addLine("Herhangi bir metin yazarak AI'ya sorabilirsiniz.", "info", { symbol: "💡" });
    }

    function cmdClear() {
        clearTerminal();
        showToast("Terminal temizlendi", "success");
    }

    async function cmdReset() {
        try {
            await apiPost("/api/reset", {});
            state.chatMessages = [];
            clearTerminal();
            addLine("Chat hafızası sıfırlandı.", "success");
            showToast("Hafıza sıfırlandı", "success");
        } catch (err) {
            addLine("Reset hatası: " + (err.message || ""), "error");
        }
    }

    function cmdVersion() {
        addLine("Kaesra AI Agent v1.0.0", "info", { symbol: "🏷️" });
        addLine(`Node.js runtime · ${state.connectedProvider} / ${state.connectedModel}`, "system");
    }

    async function cmdStatus() {
        addLine("Bağlantı durumu kontrol ediliyor...", "info", { symbol: "📡" });
        try {
            const data = await apiGet("/api/status");
            addLine(`  Provider: ${data.provider || "?"}`, data.ready ? "success" : "system");
            addLine(`  Model:    ${data.model || "?"}`, data.ready ? "success" : "system");
            addLine(`  Durum:    ${data.ready ? "● Hazır" : "○ Bağlı değil"}`, data.ready ? "success" : "error");
        } catch (err) {
            addLine("  Backend bağlantısı sağlanamadı", "error");
        }
    }

    function cmdExit() {
        addLine("Uygulama kapanıyor...", "system");
        setTimeout(() => {
            if (window.electronAPI) window.electronAPI.close();
            else window.close();
        }, 500);
    }

    async function cmdShowTools() {
        addLine("Araç kataloğu yükleniyor...", "info", { symbol: "🔧" });
        try {
            const data = await apiGet("/api/tools");
            if (data.ok && data.tools) {
                addLine(`${data.tools.length} araç mevcut:`, "success");
                data.tools.forEach((t, i) => {
                    const num = String(i + 1).padStart(2, "0");
                    addLine(`  <span style="color:${COLORS.blue}">${num}</span>  <span style="color:${COLORS.cyan};font-weight:600">${escapeHtml(t.name)}</span>`, "system", { html: true });
                    addLine(`      <span style="color:${COLORS.muted}">${escapeHtml(t.description || "")}</span>`, "system", { html: true });
                });
            } else {
                addLine(data.error || "Araçlar yüklenemedi", "error");
            }
        } catch (err) {
            addLine("Backend bağlantısı gerekli: npm run gui", "error");
        }
    }

    async function cmdShowTasks() {
        addLine("Görevler yükleniyor...", "info", { symbol: "📋" });
        try {
            const data = await apiGet("/api/tasks");
            const tasks = data.tasks || [];
            if (!tasks.length) {
                addLine("Henüz görev bulunamadı.", "system");
                addLine(`Oluşturmak için: <span style="color:${COLORS.blue}">kaesra task create "ad" "prompt"</span>`, "system", { html: true });
                return;
            }
            addLine(`${tasks.length} görev bulundu:`, "success");
            tasks.forEach((task, i) => {
                const status = task.enabled
                    ? `<span style="color:${COLORS.green}">● ON</span>`
                    : `<span style="color:${COLORS.muted}">○ OFF</span>`;
                addLine(`  ${String(i + 1).padStart(2, "0")}  ${status}  <span style="font-weight:600">${escapeHtml(task.name || "-")}</span>  <span style="color:${COLORS.muted}">${escapeHtml(task.id || "-")}</span>`, "system", { html: true });
            });
        } catch (err) {
            addLine("Backend bağlantısı gerekli", "error");
        }
    }

    async function cmdChromeStatus() {
        addLine("Chrome Bridge durumu kontrol ediliyor...", "info", { symbol: "🌐" });
        try {
            const data = await apiGet("/api/chrome/status");
            renderJsonBlock(data, "Chrome Bridge Durumu");
        } catch (err) {
            addLine("Bridge bağlantısı sağlanamadı — npm run bridge ile başlatın", "error");
        }
    }

    async function cmdDesktopApps() {
        addLine("Yüklü uygulamalar taranıyor...", "info", { symbol: "🖥️" });
        try {
            const data = await apiGet("/api/desktop/apps?limit=30");
            if (data.ok) {
                renderJsonBlock(data, "Desktop Uygulamalar");
            } else {
                addLine(data.error || "Uygulamalar yüklenemedi", "error");
            }
        } catch (err) {
            addLine("Backend bağlantısı gerekli", "error");
        }
    }

    // ── Real AI Processing ───────────────────────────────

    async function processAsk(text) {
        addThinking("AI düşünüyor...");

        await apiSSE("/api/ask", { message: text }, {
            onToolCall(data) {
                removeThinking();
                addToolCard(data.tool, data.input, "running");
                addThinking("İşleniyor...");
            },
            onToolResult(data) {
                removeThinking();
                addToolCard(data.tool, data.output, "done");
                addThinking("Devam ediyor...");
            },
            onToolError(data) {
                removeThinking();
                addToolCard(data.tool, data.error, "error");
                addThinking("Devam ediyor...");
            },
            onDone(data) {
                removeThinking();
                if (data.message) {
                    addLine(data.message, "agent");
                }
            },
            onError(errMsg) {
                removeThinking();
                addLine(errMsg, "error");
                showToast(errMsg, "error");
            }
        });
    }

    async function processChatMessage(text) {
        state.chatMessages.push({ role: "user", content: text });
        addThinking("Cevaplıyor...");

        await apiSSE("/api/chat", { message: text }, {
            onToolCall(data) {
                removeThinking();
                addToolCard(data.tool, data.input, "running");
                addThinking("Tool çalışıyor...");
            },
            onToolResult(data) {
                removeThinking();
                addToolCard(data.tool, data.output, "done");
                addThinking("Yanıt hazırlanıyor...");
            },
            onToolError(data) {
                removeThinking();
                addToolCard(data.tool, data.error, "error");
            },
            onDone(data) {
                removeThinking();
                if (data.message) {
                    state.chatMessages.push({ role: "assistant", content: data.message });
                    addLine(data.message, "agent");
                }
            },
            onError(errMsg) {
                removeThinking();
                addLine(errMsg, "error");
                showToast(errMsg, "error");
            }
        });
    }

    async function processResearch(text) {
        addThinking("Web araştırması yapılıyor...");
        try {
            const data = await apiPost("/api/research", { query: text, maxResults: 5, summarize: true });
            removeThinking();
            if (data.ok) {
                addLine("Araştırma tamamlandı:", "success");
                renderJsonBlock(data, "🔬 Research Sonuçları");
            } else {
                addLine(data.error || "Araştırma hatası", "error");
            }
        } catch (err) {
            removeThinking();
            addLine(err.message || "Research hatası", "error");
        }
    }

    // ── Input Handling ───────────────────────────────────
    cmdInput.addEventListener("input", () => {
        cmdInput.style.height = "auto";
        cmdInput.style.height = Math.min(cmdInput.scrollHeight, 120) + "px";
        charCount.textContent = `${cmdInput.value.length} / 4000`;
    });

    cmdInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendInput();
            return;
        }
        if (e.key === "ArrowUp" && !e.shiftKey && cmdInput.value === "") {
            e.preventDefault();
            navigateHistory(-1);
            return;
        }
        if (e.key === "ArrowDown" && !e.shiftKey) {
            e.preventDefault();
            navigateHistory(1);
            return;
        }
        if (e.key === "Tab") {
            e.preventDefault();
            handleTabComplete();
        }
    });

    function sendInput() {
        const text = cmdInput.value;
        cmdInput.value = "";
        cmdInput.style.height = "auto";
        charCount.textContent = "0 / 4000";
        processInput(text);
    }

    btnSend.addEventListener("click", sendInput);

    function navigateHistory(dir) {
        if (!state.history.length) return;
        state.historyIndex = Math.max(0, Math.min(state.history.length, state.historyIndex + dir));
        cmdInput.value = state.history[state.historyIndex] || "";
    }

    function handleTabComplete() {
        const val = cmdInput.value.trim();
        if (!val.startsWith("/")) return;
        const partial = val.slice(1).toLowerCase();
        const cmds = Object.keys(COMMANDS);
        const matches = cmds.filter((c) => c.startsWith(partial));
        if (matches.length === 1) {
            cmdInput.value = "/" + matches[0];
        } else if (matches.length > 1) {
            addLine(`Olası eşleşmeler: ${matches.map((m) => "/" + m).join(", ")}`, "info");
        }
    }

    // ── Sidebar Navigation ───────────────────────────────
    $$(".nav-item").forEach((el) => {
        el.addEventListener("click", () => {
            const view = el.dataset.view;
            if (view) setActiveView(view);
        });
    });

    /* Quick Actions and Tip Chips Removed */

    // ── Keyboard Shortcuts ───────────────────────────────
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
            e.preventDefault();
            const items = $$(".nav-item[data-shortcut]");
            const item = items.find((el) => el.dataset.shortcut === e.key);
            if (item && item.dataset.view) setActiveView(item.dataset.view);
            return;
        }
        if (e.ctrlKey && e.key === "k") {
            e.preventDefault();
            $("#sidebar-search").focus();
            return;
        }
        if (e.key === "Escape") {
            cmdInput.focus();
            return;
        }
        if (e.ctrlKey && e.key === "l") {
            e.preventDefault();
            cmdClear();
            return;
        }
    });

    // ── Sidebar Search ───────────────────────────────────
    $("#sidebar-search").addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        $$(".nav-item").forEach((el) => {
            const label = (el.querySelector(".nav-label")?.textContent || "").toLowerCase();
            el.style.display = !query || label.includes(query) ? "" : "none";
        });
    });

    // ── Titlebar Buttons ─────────────────────────────────
    $("#btn-minimize")?.addEventListener("click", () => {
        if (window.electronAPI) window.electronAPI.minimize();
    });
    $("#btn-maximize")?.addEventListener("click", () => {
        if (window.electronAPI) window.electronAPI.maximize();
    });
    $("#btn-close")?.addEventListener("click", () => {
        if (window.electronAPI) window.electronAPI.close();
        else window.close();
    });

    // ── Fetch Server Status on Init ──────────────────────
    async function fetchStatus() {
        try {
            const data = await apiGet("/api/status");
            if (data.ok) {
                state.connectedModel = data.model || "?";
                state.connectedProvider = data.provider || "?";
                statusModel.textContent = state.connectedModel;
                statusProvider.textContent = state.connectedProvider;
                statusDot.classList.toggle("offline", !data.ready);
                if (data.ready) {
                    showToast(`Bağlı: ${data.model} (${data.provider})`, "success", 2500);
                } else {
                    showToast("AI provider yapılandırılmamış — .env dosyasını kontrol edin", "warning", 5000);
                }
            }
        } catch {
            statusDot.classList.add("offline");
            showToast("Backend bağlantısı yok — npm run gui ile başlatın", "error", 5000);
        }
    }

    // ── Init ─────────────────────────────────────────────
    function init() {
        cmdInput.focus();
        fetchStatus();
    }

    // Particle background
    async function runReverseEngineer(url) {
        if (!url) return;
        setActiveView("terminal");
        addLine(`Tersine mühendislik başlatılıyor: ${url}`, "info", { symbol: "🧬" });
        addThinking("Siteye bağlanılıyor ve script'ler analiz ediliyor...");

        try {
            const resp = await fetch("/api/reverse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url, action: "analyze" })
            });
            const data = await resp.json();

            removeThinking();

            if (data.ok && data.results) {
                addLine(`Tersine mühendislik tamamlandı.`, "success");
                addLine(`Bulunan script sayısı: ${data.analyzed_chunks || 0}`, "info");

                data.results.forEach((item, i) => {
                    addLine(`[Chunk ${i + 1}] ${shortText(item.url, 60)}`, "warning");
                    if (item.analysis) {
                        addLine(item.analysis, "system");
                    } else {
                        addLine("Analiz verisi yok: " + (item.error || "Bilinmeyen"), "error");
                    }
                });
            } else {
                addLine("İşlem başarısız: " + (data.error || "Bilinmeyen hata"), "error");
            }
        } catch (e) {
            removeThinking();
            addLine("Servis hatası: " + e.message, "error");
        }
    }

    function initParticles() {
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.3;";
        document.body.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        let particles = [];

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        function createParticle() {
            return {
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 1.5 + 0.5,
                alpha: Math.random() * 0.3 + 0.1
            };
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach((p) => {
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(91, 164, 245, ${p.alpha})`;
                ctx.fill();
            });
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(91, 164, 245, ${0.05 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
            requestAnimationFrame(draw);
        }

        resize();
        window.addEventListener("resize", resize);
        for (let i = 0; i < 30; i++) particles.push(createParticle());
        draw();
    }

    // ── Simple Mode Logic ────────────────────────────────
    const simpleView = $("#simple-view");
    const simpleChat = $("#simple-chat-container");
    const simpleGrid = $(".simple-grid");
    const simpleMsgs = $("#simple-chat-messages");
    const simpleInput = $("#simple-input");
    const simpleBack = $("#simple-back-btn");
    const btnModeToggle = $("#btn-mode-toggle");
    let isSimpleMode = false;

    function toggleSimpleMode() {
        isSimpleMode = !isSimpleMode;
        if (isSimpleMode) {
            $(".main-layout").classList.add("hidden");
            if (simpleView) simpleView.classList.remove("hidden");
            if (btnModeToggle) {
                btnModeToggle.innerHTML = "💻"; // Switch to terminal icon
                btnModeToggle.title = "Terminal Moduna Geç";
            }
        } else {
            $(".main-layout").classList.remove("hidden");
            if (simpleView) simpleView.classList.add("hidden");
            if (btnModeToggle) {
                btnModeToggle.innerHTML = "⚡"; // Switch back to zap icon
                btnModeToggle.title = "Basit Moda Geç";
            }
        }
    }

    if (btnModeToggle) {
        btnModeToggle.addEventListener("click", toggleSimpleMode);
    }

    // Simple Card Actions
    $$(".simple-card").forEach(card => {
        card.addEventListener("click", () => {
            const action = card.dataset.action;
            if (action === "security-scan") {
                if (isSimpleMode) {
                    toggleSimpleMode();
                }
                setTimeout(() => runSecurityScan(), 500);
            } else if (action === "simple-chat" || action === "simple-research" || action === "simple-project") {
                if (simpleGrid) simpleGrid.classList.add("hidden");
                const header = $(".simple-header");
                if (header) header.classList.add("hidden");
                if (simpleChat) simpleChat.classList.remove("hidden");

                if (simpleInput) {
                    simpleInput.value = action === "simple-research" ? "Araştır: " :
                        action === "simple-project" ? "Yeni proje: " : "";
                    simpleInput.focus();
                }
            } else if (action === "reverse-engineer") {
                // Open a mini input dialog or just generic chat for URL
                const url = prompt("Analiz edilecek URL:");
                if (url) {
                    if (isSimpleMode) {
                        toggleSimpleMode();
                    }
                    setTimeout(() => runReverseEngineer(url), 500);
                }
            }
        });
    });

    if (simpleBack) {
        simpleBack.addEventListener("click", () => {
            if (simpleChat) simpleChat.classList.add("hidden");
            const header = $(".simple-header");
            if (header) header.classList.remove("hidden");
            if (simpleGrid) simpleGrid.classList.remove("hidden");
        });
    }

    // Simple Chat Send
    async function sendSimple() {
        const text = simpleInput?.value.trim();
        if (!text) return;

        const userMsg = document.createElement("div");
        userMsg.className = "simple-msg user";
        userMsg.textContent = text;
        simpleMsgs.appendChild(userMsg);
        if (simpleInput) simpleInput.value = "";

        simpleMsgs.scrollTop = simpleMsgs.scrollHeight;

        const thinkingMsg = document.createElement("div");
        thinkingMsg.className = "simple-msg agent";
        thinkingMsg.textContent = "Düşünüyor...";
        simpleMsgs.appendChild(thinkingMsg);

        try {
            await apiSSE("/api/chat", { message: text }, {
                onDone(data) {
                    thinkingMsg.textContent = data.message;
                },
                onError(err) {
                    thinkingMsg.textContent = "Hata: " + err;
                }
            });
        } catch (e) {
            thinkingMsg.textContent = "Bir hata oluştu.";
        }
        simpleMsgs.scrollTop = simpleMsgs.scrollHeight;
    }

    $("#simple-send-btn")?.addEventListener("click", sendSimple);
    simpleInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendSimple();
    });

    // Security Scan Feature
    async function runSecurityScan() {
        setActiveView("terminal");
        addLine("Güvenlik taraması başlatılıyor...", "info", { symbol: "🛡️" });
        addThinking("Kod analizi yapılıyor (bu biraz sürebilir)...");

        try {
            const resp = await fetch("/api/security", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetDir: "." })
            });
            const data = await resp.json();

            removeThinking();

            if (data.ok && data.report) {
                const report = data.report;
                addLine(`Tarama analizi tamamlandı.`, "success");

                if (report.vulnerabilities && report.vulnerabilities.length > 0) {
                    addLine(`${report.vulnerabilities.length} potansiyel sorun bulundu:`, "warning");
                    report.vulnerabilities.forEach(vuln => {
                        const color = vuln.severity === "CRITICAL" ? "red" : vuln.severity === "HIGH" ? "orange" : "yellow";
                        addLine(`  [${vuln.severity}] ${vuln.file} (Satır ${vuln.line})`, "error");
                        addLine(`    ${vuln.description}`, "system");
                        addLine(`    Öneri: ${vuln.recommendation}`, "system");
                    });
                } else {
                    addLine("Güvenlik açığı bulunamadı. Kod temiz görünüyor.", "success");
                }

                if (report.summary) {
                    addLine("Özet:", "info");
                    addLine(report.summary, "system");
                }
            } else {
                addLine("Tarama başarısız: " + (data.error || "Bilinmeyen hata"), "error");
            }
        } catch (e) {
            removeThinking();
            addLine("Servis hatası: " + e.message, "error");
        }
    }

    // Bind Security Action in Quick Actions
    // Using event delegation or checking on init since elements exist
    document.addEventListener("click", (e) => {
        const card = e.target.closest(".action-card");
        if (card && card.dataset.action === "security-scan") {
            welcomeScreen.classList.add("hidden");
            quickActions.classList.add("hidden");
            runSecurityScan();
        }
    });

    initParticles();
    init();
})();
