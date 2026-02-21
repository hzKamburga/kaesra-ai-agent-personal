import readline from "node:readline/promises";
import { cwd, stdin as input, stdout as output } from "node:process";
import { config } from "../core/config.js";
import { AssistantAgent } from "../agent/assistantAgent.js";
import { createToolRegistry } from "../tools/index.js";
import { runResearchCommand } from "./researchCommand.js";
import { runApiCommand } from "./apiCommand.js";
import { runChromeCommand } from "./chromeCommand.js";
import { runDesktopCommand } from "./desktopCommand.js";
import { runTaskCommand } from "./taskCommand.js";

/* ═══════════════════════════════════════════════════════════════
   DESIGN SYSTEM — Premium Terminal Colors & Utilities
   ═══════════════════════════════════════════════════════════════ */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  blink: "\x1b[5m",
  inverse: "\x1b[7m",
  strikethrough: "\x1b[9m",

  // Brand palette
  blue: "\x1b[38;2;91;164;245m",
  purple: "\x1b[38;2;167;139;250m",
  pink: "\x1b[38;2;244;114;182m",
  cyan: "\x1b[38;2;34;211;238m",
  green: "\x1b[38;2;52;211;153m",
  amber: "\x1b[38;2;251;191;36m",
  red: "\x1b[38;2;248;113;113m",
  orange: "\x1b[38;2;251;146;60m",

  // Text hierarchy
  text: "\x1b[38;2;232;236;244m",
  secondary: "\x1b[38;2;148;163;184m",
  muted: "\x1b[38;2;100;116;139m",
  faint: "\x1b[38;2;71;85;105m",

  // Backgrounds
  bgCard: "\x1b[48;2;22;29;46m",
  bgHighlight: "\x1b[48;2;30;40;64m",
  bgSuccess: "\x1b[48;2;16;40;32m",
  bgError: "\x1b[48;2;48;16;16m",
  bgInfo: "\x1b[48;2;16;28;52m"
};

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

const MAIN_MENU = [
  { label: "AI Ask", icon: "🧠", desc: "Tek prompt, tool-calling" },
  { label: "AI Chat", icon: "💬", desc: "Çok turlu sohbet" },
  { label: "Research", icon: "🔬", desc: "Web araştırması" },
  { label: "Task Merkezi", icon: "📋", desc: "Görev yönetimi" },
  { label: "Chrome Bridge", icon: "🌐", desc: "Extension bridge" },
  { label: "Desktop Apps", icon: "🖥️", desc: "Uygulama yönetimi" },
  { label: "API Quick", icon: "⚡", desc: "HTTP çağrısı" },
  { label: "Araç Listesi", icon: "🔧", desc: "Tool kataloğu" },
  { label: "Çıkış", icon: "🚪", desc: "" }
];

/* ═══════════════════════════════════════════════════════
   RENDERING UTILITIES
   ═══════════════════════════════════════════════════════ */

function paint(value, ...styles) {
  const text = String(value ?? "");
  if (!styles.length) return text;
  const prefix = styles.map((s) => ANSI[s] || "").join("");
  return `${prefix}${text}${ANSI.reset}`;
}

function stripAnsi(value) {
  return String(value ?? "").replace(ANSI_REGEX, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function termWidth() {
  return clamp(Number(output.columns || 120), 80, 180);
}

function gradientText(value) {
  const text = String(value ?? "");
  const colors = [
    [91, 164, 245],   // blue
    [130, 152, 250],   // blue-purple
    [167, 139, 250],   // purple
    [200, 128, 220],   // purple-pink
    [244, 114, 182]    // pink
  ];
  const len = Math.max(1, text.length - 1);
  let out = "";

  for (let i = 0; i < text.length; i++) {
    const t = i / len;
    const segLen = colors.length - 1;
    const segIndex = Math.min(Math.floor(t * segLen), segLen - 1);
    const segT = (t * segLen) - segIndex;
    const c0 = colors[segIndex];
    const c1 = colors[segIndex + 1];
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * segT);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * segT);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * segT);
    out += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
  }

  return `${out}${ANSI.reset}`;
}

function padAnsi(text, width) {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  return `${text}${" ".repeat(width - visible)}`;
}

function centerAnsi(text, width) {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  const left = Math.floor((width - visible) / 2);
  const right = width - visible - left;
  return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
}

function wrapText(value, width) {
  const lines = [];
  const rawLines = String(value ?? "").split(/\r?\n/);

  for (const rawLine of rawLines) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }

      const candidate = `${current} ${word}`;
      if (candidate.length <= width) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length ? lines : [""];
}

function shortText(value, max = 140) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

/* ═══════════════════════════════════════════════════════
   VISUAL COMPONENTS
   ═══════════════════════════════════════════════════════ */

const LOGO = [
  " ╦╔═  ╔═╗  ╔═╗  ╔═╗  ╦═╗  ╔═╗ ",
  " ╠╩╗  ╠═╣  ║╣   ╚═╗  ╠╦╝  ╠═╣ ",
  " ╩ ╩  ╩ ╩  ╚═╝  ╚═╝  ╩╚═  ╩ ╩ "
];

const LOGO_DETAIL = [
  " _  __    _    _____ ____  ____      _",
  "| |/ /   / \\   | ____/ ___||  _ \\    / \\",
  "| ' /   / _ \\  |  _| \\___ \\| |_) |  / _ \\",
  "| . \\  / ___ \\ | |___ ___) |  _ <  / ___ \\",
  "|_|\\_\\/_/   \\_\\_____|____/|_| \\_\\/_/   \\_\\"
];

function printDivider(char = "─", color = "faint") {
  const w = termWidth();
  console.log(paint(char.repeat(w), color));
}

function printGradientDivider() {
  const w = termWidth();
  console.log(gradientText("━".repeat(w)));
}

function printSpacer(lines = 1) {
  for (let i = 0; i < lines; i++) console.log("");
}

function printLogo() {
  for (const line of LOGO_DETAIL) {
    console.log(`  ${gradientText(line)}`);
  }
}

function printHeader(title, icon = "") {
  const w = termWidth();
  const label = icon ? `${icon}  ${title}` : title;
  printSpacer();
  printGradientDivider();
  console.log(centerAnsi(paint(label, "bold", "text"), w));
  printGradientDivider();
}

function printSectionTitle(title) {
  const w = termWidth();
  const label = paint(` ${title} `, "bold", "text");
  const labelLen = stripAnsi(label).length;
  const remaining = w - labelLen - 2;
  const leftLen = 2;
  const rightLen = Math.max(0, remaining - leftLen);
  console.log(`${paint("─".repeat(leftLen), "faint")} ${label} ${paint("─".repeat(rightLen), "faint")}`);
}

function printStatusBar(modelName = "") {
  const w = termWidth();
  const pathStr = paint(`📂 ${cwd().replace(/\\/g, "/")}`, "blue");
  const model = paint(modelName || config.model || "model", "purple", "bold");
  const provider = paint(config.provider || "provider", "muted");
  const status = paint("● READY", "green");

  const left = `  ${pathStr}`;
  const right = `${status}  ${model} ${paint("via", "faint")} ${provider}  `;
  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;
  const gap = Math.max(1, w - leftLen - rightLen);

  console.log(`${left}${" ".repeat(gap)}${right}`);
}

function printCard(title, content, options = {}) {
  const { tone = "muted", icon = "⚡", border = "purple" } = options;
  const w = Math.max(50, termWidth() - 6);
  const inner = w - 4;
  const borderColor = ANSI[border] || ANSI.purple;

  console.log(`  ${borderColor}╭${"─".repeat(inner + 2)}╮${ANSI.reset}`);

  const heading = `${icon}  ${paint(String(title || ""), "bold", border === "red" ? "red" : "purple")}`;
  console.log(`  ${borderColor}│${ANSI.reset} ${padAnsi(heading, inner)} ${borderColor}│${ANSI.reset}`);

  console.log(`  ${borderColor}├${"─".repeat(inner + 2)}┤${ANSI.reset}`);

  const messageLines = wrapText(String(content || ""), inner - 2);
  for (const line of messageLines) {
    console.log(`  ${borderColor}│${ANSI.reset} ${padAnsi(paint(line, tone), inner)} ${borderColor}│${ANSI.reset}`);
  }

  console.log(`  ${borderColor}╰${"─".repeat(inner + 2)}╯${ANSI.reset}`);
}

function printToolCard(toolName, body, status = "running") {
  const icon = status === "done" ? "✓" : status === "error" ? "✕" : "⟳";
  const tone = status === "done" ? "green" : status === "error" ? "red" : "amber";
  const statusLabel = paint(` ${icon} ${status.toUpperCase()} `, "bold", tone);
  const title = `${paint(toolName, "cyan", "bold")} ${statusLabel}`;

  printCard(title, body, { tone: "muted", icon: "⚙️", border: status === "error" ? "red" : "purple" });
}

function printSuccess(message) {
  console.log(`\n  ${paint("✓", "green", "bold")} ${paint(message, "green")}`);
}

function printError(error) {
  console.log(`\n  ${paint("✕", "red", "bold")} ${paint(error?.message || String(error), "red")}`);
}

function printInfo(message) {
  console.log(`  ${paint("ℹ", "blue")} ${paint(message, "secondary")}`);
}

function printJson(value, title = "Output") {
  const lines = JSON.stringify(value, null, 2).split("\n");
  printSpacer();
  console.log(`  ${paint(title, "purple", "bold")}`);
  printDivider("─", "faint");
  for (const line of lines) {
    // Basic syntax coloring
    const colored = line
      .replace(/"([^"]+)":/g, `${ANSI.cyan}"$1"${ANSI.reset}:`)
      .replace(/: "([^"]*)"/g, `: ${ANSI.green}"$1"${ANSI.reset}`)
      .replace(/: (\d+)/g, `: ${ANSI.amber}$1${ANSI.reset}`)
      .replace(/: (true|false|null)/g, `: ${ANSI.purple}$1${ANSI.reset}`);
    console.log(`  ${colored}`);
  }
}

/* ═══════════════════════════════════════════════════════
   INPUT HELPERS
   ═══════════════════════════════════════════════════════ */

async function askText(rl, label, options = {}) {
  const required = Boolean(options.required);
  const defaultValue = options.defaultValue ?? "";
  const prompt = defaultValue
    ? `  ${paint("❯", "blue")} ${paint(label, "text")} ${paint(`[${defaultValue}]`, "faint")}: `
    : `  ${paint("❯", "blue")} ${paint(label, "text")}: `;

  while (true) {
    const raw = await rl.question(prompt);
    const value = raw.trim();
    if (!value && defaultValue !== "") return String(defaultValue);
    if (!value && required) {
      console.log(`  ${paint("⚠ Bu alan zorunludur.", "amber")}`);
      continue;
    }
    return value;
  }
}

async function askNumber(rl, label, options = {}) {
  const value = await askText(rl, label, options);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} numerik olmalı`);
  }
  return parsed;
}

async function chooseMenu(rl, title, menuItems) {
  printSpacer();
  if (title) {
    console.log(`  ${paint(title, "bold", "text")}`);
    printSpacer();
  }

  menuItems.forEach((item, index) => {
    const num = paint(String(index + 1).padStart(2, " "), "blue", "bold");
    const icon = item.icon || "";
    const label = paint(item.label, "text");
    const desc = item.desc ? paint(` ─ ${item.desc}`, "muted") : "";
    console.log(`   ${num}  ${icon}  ${label}${desc}`);
  });

  printSpacer();

  while (true) {
    const raw = await askText(rl, "Seçim", { required: true });
    const choice = Number(raw) - 1;
    if (Number.isInteger(choice) && choice >= 0 && choice < menuItems.length) {
      return choice;
    }
    console.log(`  ${paint("⚠ Geçersiz seçim. 1-${menuItems.length} arası girin.", "amber")}`);
  }
}

async function pause(rl) {
  await rl.question(`\n  ${paint("↵ Devam etmek için Enter...", "faint")}`);
}

/* ═══════════════════════════════════════════════════════
   SHELL SCREENS
   ═══════════════════════════════════════════════════════ */

function printMenuShell() {
  console.clear();
  printSpacer();
  printLogo();
  printSpacer();
  console.log(centerAnsi(gradientText("AI Agent — Research, Automation, Orchestration"), termWidth()));
  printSpacer();
  printStatusBar(config.model || config.provider);
  printGradientDivider();

  // Tips
  console.log(`  ${paint("Quickstart:", "bold", "text")}`);
  console.log(`  ${paint("1.", "blue")} ${paint("AI Chat", "text")} — çok turlu sohbet modu`, paint("(önerilen)", "green"));
  console.log(`  ${paint("2.", "blue")} ${paint("AI Ask", "text")} — tek prompt ile yanıt`);
  console.log(`  ${paint("3.", "blue")} ${paint("Research & Task", "text")} — araştır ve otomatize et`);
}

function printChatShell(modelName = "") {
  console.clear();
  printSpacer();
  printLogo();
  printSpacer();

  const w = termWidth();
  const left = `  ${paint("💬 Chat Modu", "purple", "bold")}`;
  const right = `${paint(modelName || config.model, "blue")} ${paint("●", "green")}  `;
  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;
  const gap = Math.max(1, w - leftLen - rightLen);
  console.log(`${left}${" ".repeat(gap)}${right}`);
  printGradientDivider();

  printInfo("/help → komutlar · /back → ana menü · /clear → temizle · /reset → hafıza sıfırla");
  printSpacer();
}

/* ═══════════════════════════════════════════════════════
   AGENT HELPERS
   ═══════════════════════════════════════════════════════ */

function createAgent(getProvider, onEvent) {
  const provider = getProvider(true);
  const toolRegistry = createToolRegistry({ provider });

  return new AssistantAgent({
    provider,
    toolRegistry,
    maxSteps: -1,
    onEvent
  });
}

function makeEventHandler() {
  return (event) => {
    if (!event) return;
    if (event.type === "tool_call") {
      printToolCard(event.tool, shortText(event.input), "running");
    } else if (event.type === "tool_result") {
      printToolCard(event.tool, shortText(event.output), "done");
    } else if (event.type === "tool_error") {
      if (event.tool === "parser") return;
      printToolCard(event.tool, shortText(event.error), "error");
    }
  };
}

function printAgentResponse(message) {
  const w = Math.max(48, termWidth() - 8);
  const lines = wrapText(message || "", w);
  printSpacer();
  console.log(`  ${paint("✦", "purple", "bold")} ${paint(lines[0] || "", "text")}`);
  for (let i = 1; i < lines.length; i++) {
    console.log(`    ${paint(lines[i], "text")}`);
  }
}

/* ═══════════════════════════════════════════════════════
   FLOW HANDLERS
   ═══════════════════════════════════════════════════════ */

async function runAskFlow(rl, getProvider) {
  printHeader("AI Ask", "🧠");
  printInfo("Tek prompt girin, agent tüm araçlarıyla yanıt verecek.");
  printSpacer();

  const prompt = await askText(rl, "Prompt", { required: true });
  const agent = createAgent(getProvider, makeEventHandler());

  console.log(`\n  ${paint("⟳ İşleniyor...", "amber", "bold")}`);
  const result = await agent.ask(prompt);
  printAgentResponse(result.message);
}

async function runChatFlow(rl, getProvider) {
  const provider = getProvider(true);
  const modelName = provider?.model || config.model;
  const agent = createAgent(getProvider, makeEventHandler());

  printChatShell(modelName);

  while (true) {
    const text = (await rl.question(`  ${paint("❯", "blue", "bold")} `)).trim();
    if (!text) continue;

    if (text === "/back") return;

    if (text === "/clear") {
      printChatShell(modelName);
      printSuccess("Ekran temizlendi, sohbet hafızası korundu.");
      continue;
    }

    if (text === "/reset") {
      agent.reset();
      printSuccess("Sohbet hafızası sıfırlandı.");
      continue;
    }

    if (text === "/help") {
      printSpacer();
      printSectionTitle("Chat Komutları");
      [
        ["/back", "Ana menüye dön"],
        ["/clear", "Ekranı temizle (hafıza korunur)"],
        ["/reset", "Sohbet hafızasını sıfırla"]
      ].forEach(([cmd, desc]) => {
        console.log(`  ${paint(cmd, "blue", "bold")}  ${paint("→", "faint")}  ${paint(desc, "secondary")}`);
      });
      continue;
    }

    try {
      console.log(`\n  ${paint("⟳ Düşünüyor...", "amber")}`);
      const result = await agent.ask(text);
      printAgentResponse(result.message);
    } catch (error) {
      printError(error);
    }
  }
}

async function runResearchFlow(rl, getProvider) {
  printHeader("Web Research", "🔬");
  printInfo("Tavily/SerpAPI/DuckDuckGo ile web araştırması yapın.");
  printSpacer();

  const query = await askText(rl, "Araştırma sorgusu", { required: true });
  const maxResults = await askNumber(rl, "Max sonuç", { defaultValue: "5" });

  console.log(`\n  ${paint("⟳ Araştırma yapılıyor...", "amber", "bold")}`);

  const result = await runResearchCommand({
    query,
    maxResults: Number(maxResults || 5),
    summarize: true,
    provider: getProvider(true)
  });

  printJson(result, "🔬 Research Sonuçları");
}

async function runTaskFlow(rl, logger) {
  printHeader("Task Merkezi", "📋");

  const result = await runTaskCommand({
    provider: null,
    logger,
    action: "list",
    input: {}
  });

  const tasks = result.tasks || [];
  printSpacer();

  if (!tasks.length) {
    printInfo("Henüz görev bulunamadı.");
    printSpacer();
    printInfo("Görev oluşturmak için: kaesra task create \"ad\" \"prompt\"");
    return;
  }

  printSectionTitle(`${tasks.length} Görev`);
  printSpacer();

  tasks.forEach((task, index) => {
    const num = paint(String(index + 1).padStart(2, " "), "blue", "bold");
    const status = task.enabled
      ? paint("● ON", "green", "bold")
      : paint("○ OFF", "muted");
    const name = paint(task.name || "-", "text", "bold");
    const id = paint(task.id || "-", "faint");
    console.log(`   ${num}  ${status}  ${name}  ${id}`);
  });
}

async function runChromeQuickFlow() {
  printHeader("Chrome Bridge", "🌐");
  console.log(`  ${paint("⟳ Durum kontrol ediliyor...", "amber")}`);
  try {
    const status = await runChromeCommand({ action: "status" });
    printJson(status, "🌐 Chrome Bridge Durumu");
  } catch (err) {
    printError(err);
    printInfo("Bridge başlatmak için: npm run bridge");
  }
}

async function runDesktopQuickFlow() {
  printHeader("Desktop Uygulamalar", "🖥️");
  console.log(`  ${paint("⟳ Uygulamalar taranıyor...", "amber")}`);
  try {
    const list = await runDesktopCommand({
      action: "installed",
      limit: 30
    });
    printJson(list, "🖥️ Yüklü Uygulamalar");
  } catch (err) {
    printError(err);
  }
}

async function runApiQuickFlow(rl) {
  printHeader("API Quick Call", "⚡");
  printInfo("Hızlı HTTP isteği gönderin.");
  printSpacer();

  const method = (await askText(rl, "Method", { defaultValue: "GET" })).toUpperCase();
  const url = await askText(rl, "URL", { required: true });

  console.log(`\n  ${paint("⟳ İstek gönderiliyor...", "amber")}`);
  const result = await runApiCommand({ method, url, timeoutMs: 30000 });
  printJson(result, "⚡ API Yanıtı");
}

async function runToolsFlow(getProvider) {
  printHeader("Araç Kataloğu", "🔧");

  const provider = getProvider(false);
  const registry = createToolRegistry({ provider });
  const list = registry.list();

  printSpacer();
  printSectionTitle(`${list.length} Araç Mevcut`);
  printSpacer();

  list.forEach((tool, index) => {
    const num = paint(String(index + 1).padStart(2, " "), "blue", "bold");
    const name = paint(tool.name, "cyan", "bold");
    const desc = paint(tool.description || "", "secondary");
    console.log(`   ${num}  ${name}`);
    console.log(`       ${desc}`);
    if (index < list.length - 1) console.log("");
  });
}

/* ═══════════════════════════════════════════════════════
   MAIN UI LOOP
   ═══════════════════════════════════════════════════════ */

export async function runUiCommand({ getProvider, logger }) {
  const rl = readline.createInterface({ input, output });

  try {
    printMenuShell();

    while (true) {
      const choice = await chooseMenu(rl, "Ana Menü", MAIN_MENU);

      try {
        switch (choice) {
          case 0:
            await runAskFlow(rl, getProvider);
            await pause(rl);
            printMenuShell();
            break;

          case 1:
            await runChatFlow(rl, getProvider);
            printMenuShell();
            break;

          case 2:
            await runResearchFlow(rl, getProvider);
            await pause(rl);
            printMenuShell();
            break;

          case 3:
            await runTaskFlow(rl, logger);
            await pause(rl);
            printMenuShell();
            break;

          case 4:
            await runChromeQuickFlow();
            await pause(rl);
            printMenuShell();
            break;

          case 5:
            await runDesktopQuickFlow();
            await pause(rl);
            printMenuShell();
            break;

          case 6:
            await runApiQuickFlow(rl);
            await pause(rl);
            printMenuShell();
            break;

          case 7:
            await runToolsFlow(getProvider);
            await pause(rl);
            printMenuShell();
            break;

          case 8:
            return;

          default:
            break;
        }
      } catch (error) {
        printError(error);
        await pause(rl);
        printMenuShell();
      }
    }
  } finally {
    rl.close();
  }
}
