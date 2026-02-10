import readline from "node:readline/promises";
import { cwd, stdin as input, stdout as output } from "node:process";
import { AssistantAgent } from "../agent/assistantAgent.js";
import { createToolRegistry } from "../tools/index.js";
import { runResearchCommand } from "./researchCommand.js";
import { runApiCommand } from "./apiCommand.js";
import { runChromeCommand } from "./chromeCommand.js";
import { runDesktopCommand } from "./desktopCommand.js";
import { runTaskCommand } from "./taskCommand.js";

const MAIN_MENU = [
  "AI Ask (tek prompt)",
  "AI Chat (session)",
  "Research",
  "Task Merkezi",
  "Chrome Quick",
  "Desktop Quick",
  "API Quick",
  "Tools Listesi",
  "Cikis"
];

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  accent: "\x1b[38;5;215m",
  accentSoft: "\x1b[38;5;179m",
  text: "\x1b[38;5;252m",
  muted: "\x1b[38;5;244m",
  ok: "\x1b[38;5;114m",
  warn: "\x1b[38;5;221m",
  err: "\x1b[38;5;203m",
  link: "\x1b[38;5;117m",
  panel: "\x1b[38;5;240m"
};

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function paint(text, ...styles) {
  const content = String(text ?? "");
  if (!styles.length) {
    return content;
  }
  const prefix = styles.map((name) => ANSI[name] || "").join("");
  return `${prefix}${content}${ANSI.reset}`;
}

function stripAnsi(value) {
  return String(value ?? "").replace(ANSI_REGEX, "");
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function termWidth() {
  return clamp(Number(output.columns || 120), 90, 160);
}

function padRightAnsi(value, width) {
  const text = String(value ?? "");
  const visible = stripAnsi(text).length;
  if (visible >= width) {
    return text;
  }
  return `${text}${" ".repeat(width - visible)}`;
}

function hardWrapLine(text, width) {
  if (!text) {
    return [""];
  }

  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [""];
  }

  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      if (word.length <= width) {
        current = word;
      } else {
        let cursor = word;
        while (cursor.length > width) {
          lines.push(cursor.slice(0, width));
          cursor = cursor.slice(width);
        }
        current = cursor;
      }
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    lines.push(current);
    if (word.length <= width) {
      current = word;
      continue;
    }

    let cursor = word;
    while (cursor.length > width) {
      lines.push(cursor.slice(0, width));
      cursor = cursor.slice(width);
    }
    current = cursor;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function wrapText(value, width) {
  const text = String(value ?? "");
  const rawLines = text.split(/\r?\n/);
  const wrapped = [];

  for (const line of rawLines) {
    wrapped.push(...hardWrapLine(line, width));
  }

  return wrapped.length ? wrapped : [""];
}

function boxTop(width, title = "") {
  if (!title) {
    return `+${"-".repeat(width - 2)}+`;
  }

  const rawTitle = ` ${title} `;
  const inner = Math.max(0, width - 2);
  if (rawTitle.length >= inner) {
    return `+${rawTitle.slice(0, inner)}+`;
  }

  const remaining = inner - rawTitle.length;
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return `+${"-".repeat(left)}${rawTitle}${"-".repeat(right)}+`;
}

function renderBox(title, lines, width = termWidth() - 2) {
  const boxWidth = clamp(width, 44, termWidth());
  const inner = boxWidth - 2;
  const outputLines = [paint(boxTop(boxWidth, title), "panel")];

  for (const line of lines) {
    const wrapped = wrapText(line, inner);
    for (const part of wrapped) {
      outputLines.push(`${paint("|", "panel")}${padRightAnsi(part, inner)}${paint("|", "panel")}`);
    }
  }

  outputLines.push(paint(`+${"-".repeat(inner)}+`, "panel"));
  return outputLines.join("\n");
}

function renderSplitPanel(title, leftTitle, rightTitle, leftLines, rightLines) {
  const width = termWidth() - 2;
  const inner = width - 2;
  const divider = " | ";
  const leftWidth = Math.floor((inner - divider.length) * 0.45);
  const rightWidth = inner - divider.length - leftWidth;

  const leftWrapped = [];
  const rightWrapped = [];

  leftWrapped.push(leftTitle);
  rightWrapped.push(rightTitle);

  for (const line of leftLines) {
    leftWrapped.push(...wrapText(line, leftWidth));
  }

  for (const line of rightLines) {
    rightWrapped.push(...wrapText(line, rightWidth));
  }

  const rows = Math.max(leftWrapped.length, rightWrapped.length);
  const content = [];

  for (let i = 0; i < rows; i += 1) {
    const left = leftWrapped[i] || "";
    const right = rightWrapped[i] || "";
    content.push(`${padRightAnsi(left, leftWidth)}${paint(divider, "panel")}${padRightAnsi(right, rightWidth)}`);
  }

  return renderBox(title, content, width);
}

function printSection(title) {
  const width = termWidth() - 2;
  console.log("");
  console.log(paint(`${title}`, "accent", "bold"));
  console.log(paint("-".repeat(Math.min(width, 78)), "panel"));
}

function printError(error) {
  console.log("");
  console.log(paint(`[HATA] ${error?.message || String(error)}`, "err", "bold"));
}

function printSuccess(message) {
  console.log("");
  console.log(paint(`[OK] ${message}`, "ok", "bold"));
}

function printJson(value, title = "Output") {
  const lines = JSON.stringify(value, null, 2).split("\n");
  console.log("");
  console.log(renderBox(title, lines, Math.min(120, termWidth() - 2)));
}

function shortId(value) {
  const text = String(value || "");
  return text.length <= 8 ? text : text.slice(0, 8);
}

function truncate(value, max = 64) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function formatDateTime(isoDate) {
  if (!isoDate) {
    return "-";
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return String(isoDate);
  }

  return date.toISOString().replace("T", " ").slice(0, 19);
}

function printTasksTable(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.log("");
    console.log(paint("Task yok.", "muted"));
    return;
  }

  const rows = tasks.map((task, index) => [
    paint(String(index + 1), "accent"),
    shortId(task.id),
    task.enabled ? paint("Y", "ok") : paint("N", "warn"),
    formatDateTime(task.nextRunAt),
    String(task.runCount || 0),
    truncate(task.name, 32)
  ]);

  const headers = [
    paint("#", "accent", "bold"),
    paint("ID", "accent", "bold"),
    paint("EN", "accent", "bold"),
    paint("NEXT RUN (UTC)", "accent", "bold"),
    paint("RUNS", "accent", "bold"),
    paint("NAME", "accent", "bold")
  ];

  const widths = headers.map((header, idx) =>
    Math.max(stripAnsi(header).length, ...rows.map((row) => stripAnsi(row[idx]).length))
  );

  const buildLine = (cells) => cells.map((cell, idx) => padRightAnsi(cell, widths[idx])).join(" | ");

  console.log("");
  console.log(buildLine(headers));
  console.log(paint(widths.map((width) => "-".repeat(width)).join("-+-"), "panel"));
  rows.forEach((row) => console.log(buildLine(row)));
}

async function askText(rl, label, options = {}) {
  const required = Boolean(options.required);
  const defaultValue = options.defaultValue ?? "";

  while (true) {
    const suffix = defaultValue !== "" ? paint(` [${defaultValue}]`, "muted") : "";
    const raw = await rl.question(`${paint(label, "accentSoft")}${suffix}: `);
    const value = raw.trim();

    if (!value && defaultValue !== "") {
      return String(defaultValue);
    }

    if (!value && required) {
      console.log(paint("Bos birakamazsin.", "warn"));
      continue;
    }

    return value;
  }
}

async function askNumber(rl, label, options = {}) {
  const value = await askText(rl, label, {
    required: Boolean(options.required),
    defaultValue: options.defaultValue
  });

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} numerik olmali`);
  }

  return parsed;
}

async function askYesNo(rl, label, defaultValue = true) {
  const fallback = defaultValue ? "y" : "n";
  const value = (await rl.question(`${paint(label, "accentSoft")} (y/n) ${paint(`[${fallback}]`, "muted")}: `))
    .trim()
    .toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (["y", "yes", "1", "true"].includes(value)) {
    return true;
  }

  if (["n", "no", "0", "false"].includes(value)) {
    return false;
  }

  return defaultValue;
}

async function pause(rl) {
  await rl.question(`\n${paint("Devam icin Enter...", "muted")}`);
}

async function chooseMenu(rl, title, options) {
  printSection(title);
  options.forEach((option, idx) => {
    const no = paint(String(idx + 1).padStart(2, "0"), "accent", "bold");
    console.log(` ${no}  ${paint(option, "text")}`);
  });

  while (true) {
    const answer = (await rl.question(`\n${paint("Secim", "accentSoft")}: `)).trim();
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return index - 1;
    }

    console.log(paint(`Gecersiz secim. 1-${options.length} arasi gir.`, "warn"));
  }
}

function createAgent(getProvider, onEvent) {
  const provider = getProvider(true);
  const toolRegistry = createToolRegistry({ provider });

  return new AssistantAgent({
    provider,
    toolRegistry,
    maxSteps: 20,
    onEvent
  });
}

function resolveTaskSelector(tasks, selector) {
  const value = String(selector || "").trim();
  if (!value) {
    throw new Error("Task secimi bos olamaz");
  }

  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1;
    if (index >= 0 && index < tasks.length) {
      return tasks[index];
    }
  }

  const exact = tasks.find((task) => task.id === value);
  if (exact) {
    return exact;
  }

  const prefixed = tasks.filter((task) => String(task.id || "").startsWith(value));
  if (prefixed.length === 1) {
    return prefixed[0];
  }

  if (prefixed.length > 1) {
    throw new Error("Bu ID prefix birden fazla task ile eslesiyor");
  }

  throw new Error("Task bulunamadi");
}

function renderWelcomeDashboard() {
  const leftLines = [
    "Kaesra CLI v1.0",
    "Interactive Control Surface",
    "",
    "Konum",
    cwd(),
    "",
    "Kisa komut",
    "AI Ask, Chat, Research, Task",
    "Chrome, Desktop, API"
  ];

  const rightLines = [
    "Tips",
    "1) Ana menu secimi yap",
    "2) Research sonucu kart olarak gelir",
    "3) Chat icinde /reset ve /back kullan",
    "4) Task merkezinden tasklarini yonet",
    "",
    "Not",
    "Chrome Quick icin bridge + extension gerekli"
  ];

  return renderSplitPanel("KAESRA TERMINAL UI", "Workspace", "Getting Started", leftLines, rightLines);
}

async function runAskFlow(rl, getProvider) {
  printSection("AI Ask");
  const prompt = await askText(rl, "Prompt", { required: true });

  const agent = createAgent(getProvider, (event) => {
    if (event?.type === "tool_call") {
      console.log(paint(`> tool:${event.tool}`, "accentSoft", "dim"));
    }
    if (event?.type === "tool_error") {
      console.log(paint(`> tool-error:${event.tool} ${event.error}`, "err", "dim"));
    }
  });

  const result = await agent.ask(prompt);
  printSuccess("Yanit hazir");
  console.log("");
  console.log(renderBox("Agent", wrapText(String(result.message || "(bos yanit)"), Math.min(100, termWidth() - 6))));
}

async function runChatFlow(rl, getProvider) {
  printSection("AI Chat");
  console.log(paint("Komutlar: /back -> ana menu, /reset -> sohbet hafizasini temizle", "muted"));

  const agent = createAgent(getProvider, (event) => {
    if (event?.type === "tool_call") {
      console.log(paint(`  [tool] ${event.tool}`, "accentSoft", "dim"));
    }
    if (event?.type === "tool_error") {
      console.log(paint(`  [tool-error] ${event.tool}: ${event.error}`, "err", "dim"));
    }
  });

  while (true) {
    const text = (await rl.question(`\n${paint("You", "accent", "bold")} > `)).trim();
    if (!text) {
      continue;
    }

    if (text === "/back") {
      return;
    }

    if (text === "/reset") {
      agent.reset();
      printSuccess("Sohbet hafizasi sifirlandi");
      continue;
    }

    try {
      const result = await agent.ask(text);
      console.log(`\n${paint("Agent", "ok", "bold")} > ${paint(result.message || "", "text")}`);
    } catch (error) {
      printError(error);
    }
  }
}

function printResearchSummary(result) {
  const items = result?.research?.results;
  if (!Array.isArray(items)) {
    printJson(result, "Research");
    return;
  }

  const meta = [
    `Provider: ${result?.research?.provider || "-"}`,
    `Sorgu: ${result?.research?.query || "-"}`,
    `Sonuc: ${items.length}`
  ];
  console.log("");
  console.log(renderBox("Research Summary", meta));

  items.forEach((item, idx) => {
    const title = item?.title || "-";
    const lines = [
      truncate(title, 140),
      item?.url || "-",
      "",
      item?.snippet || "-"
    ];
    console.log("");
    console.log(renderBox(`#${String(idx + 1).padStart(2, "0")}`, lines));
  });

  if (result?.summary) {
    console.log("");
    console.log(renderBox("AI Ozet", wrapText(result.summary, Math.min(termWidth() - 6, 110))));
  }
}

async function runResearchFlow(rl, getProvider) {
  printSection("Research");
  const query = await askText(rl, "Sorgu", { required: true });
  const maxResults = await askNumber(rl, "Max sonuc", { defaultValue: "5" });
  const summarize = await askYesNo(rl, "AI ile ozetlensin mi", true);

  console.log(paint("\nArama yapiliyor...", "accentSoft"));

  const provider = summarize ? getProvider(true) : getProvider(false);
  const result = await runResearchCommand({
    query,
    maxResults: Number(maxResults || 5),
    summarize,
    provider
  });

  printResearchSummary(result);
}

async function runTaskListFlow(logger) {
  const result = await runTaskCommand({
    provider: null,
    logger,
    action: "list",
    input: {}
  });

  printTasksTable(result.tasks || []);
}

async function pickTask(rl, logger) {
  const result = await runTaskCommand({
    provider: null,
    logger,
    action: "list",
    input: {}
  });

  const tasks = result.tasks || [];
  printTasksTable(tasks);
  if (!tasks.length) {
    return null;
  }

  const selector = await askText(rl, "Task sec (# / id / id-prefix)", { required: true });
  return resolveTaskSelector(tasks, selector);
}

async function runTaskCreateFlow(rl, logger) {
  printSection("Task Olustur");
  const name = await askText(rl, "Task adi", { required: true });
  const prompt = await askText(rl, "Task prompt", { required: true });
  const runAt = await askText(rl, "Run at (ISO, bos birak = yok)", {});
  const intervalMs = await askText(rl, "Interval ms (bos birak = yok)", {});
  const enabled = await askYesNo(rl, "Enabled", true);

  const result = await runTaskCommand({
    provider: null,
    logger,
    action: "create",
    input: {
      name,
      prompt,
      runAt: runAt || undefined,
      intervalMs: intervalMs ? Number(intervalMs) : undefined,
      enabled
    }
  });

  printSuccess(`Task olustu: ${result?.task?.id || "-"}`);
}

async function runTaskRunFlow(rl, logger, getProvider) {
  printSection("Task Simdi Calistir");
  const task = await pickTask(rl, logger);
  if (!task) {
    return;
  }

  const result = await runTaskCommand({
    provider: getProvider(true),
    logger,
    action: "run",
    input: {
      id: task.id
    }
  });

  printJson(result, "Task Run");
}

async function runTaskDeleteFlow(rl, logger) {
  printSection("Task Sil");
  const task = await pickTask(rl, logger);
  if (!task) {
    return;
  }

  const confirmed = await askYesNo(rl, `Silinsin mi: ${task.name}`, false);
  if (!confirmed) {
    printSuccess("Iptal edildi");
    return;
  }

  const result = await runTaskCommand({
    provider: null,
    logger,
    action: "delete",
    input: {
      id: task.id
    }
  });

  printSuccess(result.deleted ? "Task silindi" : "Task bulunamadi");
}

async function runTaskToggleFlow(rl, logger) {
  printSection("Task Enable/Disable");
  const task = await pickTask(rl, logger);
  if (!task) {
    return;
  }

  const nextEnabled = !Boolean(task.enabled);
  const result = await runTaskCommand({
    provider: null,
    logger,
    action: "update",
    input: {
      id: task.id,
      enabled: nextEnabled
    }
  });

  printSuccess(`Task ${result?.task?.enabled ? "enabled" : "disabled"}`);
}

async function runTaskCenterFlow(rl, logger, getProvider) {
  const menu = [
    "Task listesi",
    "Task olustur",
    "Task simdi calistir",
    "Task enable/disable",
    "Task sil",
    "Geri"
  ];

  while (true) {
    const choice = await chooseMenu(rl, "Task Merkezi", menu);

    try {
      if (choice === 0) {
        await runTaskListFlow(logger);
      } else if (choice === 1) {
        await runTaskCreateFlow(rl, logger);
      } else if (choice === 2) {
        await runTaskRunFlow(rl, logger, getProvider);
      } else if (choice === 3) {
        await runTaskToggleFlow(rl, logger);
      } else if (choice === 4) {
        await runTaskDeleteFlow(rl, logger);
      } else if (choice === 5) {
        return;
      }
    } catch (error) {
      printError(error);
    }

    await pause(rl);
  }
}

async function runChromeQuickFlow(rl) {
  const menu = [
    "Bridge status",
    "Aktif tab",
    "Tab listesi",
    "Navigate aktif tab",
    "Aktif tab text extract",
    "Geri"
  ];

  while (true) {
    const choice = await chooseMenu(rl, "Chrome Quick", menu);

    try {
      if (choice === 0) {
        printJson(await runChromeCommand({ action: "status" }), "Chrome Status");
      } else if (choice === 1) {
        printJson(await runChromeCommand({ action: "getActiveTab" }), "Chrome Active Tab");
      } else if (choice === 2) {
        printJson(await runChromeCommand({ action: "listTabs", currentWindow: true }), "Chrome Tabs");
      } else if (choice === 3) {
        const url = await askText(rl, "URL", { required: true });
        printJson(await runChromeCommand({ action: "navigateActive", url }), "Chrome Navigate");
      } else if (choice === 4) {
        const maxChars = await askNumber(rl, "Max chars", { defaultValue: "5000" });
        printJson(await runChromeCommand({ action: "extractActiveText", maxChars }), "Chrome Extract");
      } else if (choice === 5) {
        return;
      }
    } catch (error) {
      printError(error);
    }

    await pause(rl);
  }
}

async function runDesktopQuickFlow(rl) {
  const menu = ["Installed app ara/listele", "App ac", "Geri"];

  while (true) {
    const choice = await chooseMenu(rl, "Desktop Quick", menu);

    try {
      if (choice === 0) {
        const query = await askText(rl, "Query (bos = tumu)", {});
        const limit = await askNumber(rl, "Limit", { defaultValue: "120" });
        const result = await runDesktopCommand({
          action: "installed",
          query: query || undefined,
          limit,
          refresh: false
        });
        printJson(result, "Desktop Installed");
      } else if (choice === 1) {
        const target = await askText(rl, "Hedef (or: notepad.exe veya app name)", { required: true });
        const useAppName = await askYesNo(rl, "Bunu app-name olarak dene", true);

        const result = await runDesktopCommand(
          useAppName
            ? {
                action: "open",
                appName: target
              }
            : {
                action: "open",
                target
              }
        );
        printJson(result, "Desktop Open");
      } else if (choice === 2) {
        return;
      }
    } catch (error) {
      printError(error);
    }

    await pause(rl);
  }
}

function parseJsonOrUndefined(label, value) {
  const text = String(value || "").trim();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} gecerli JSON olmali (${error.message})`);
  }
}

async function runApiQuickFlow(rl) {
  printSection("API Quick");
  const method = (await askText(rl, "Method", { defaultValue: "GET" })).toUpperCase();
  const url = await askText(rl, "URL", { required: true });
  const headersRaw = await askText(rl, "Headers JSON (bos birak = yok)", {});
  const bodyRaw = await askText(rl, "Body (JSON veya text, bos birak = yok)", {});
  const timeoutMs = await askNumber(rl, "Timeout ms", { defaultValue: "30000" });

  const headers = parseJsonOrUndefined("Headers", headersRaw);
  let body = undefined;
  if (bodyRaw) {
    try {
      body = JSON.parse(bodyRaw);
    } catch {
      body = bodyRaw;
    }
  }

  const result = await runApiCommand({
    method,
    url,
    headers,
    body,
    timeoutMs
  });

  printJson(result, "API");
}

async function runToolsFlow(getProvider) {
  printSection("Tools Listesi");
  const provider = getProvider(false);
  const registry = createToolRegistry({ provider });
  const list = registry.list();

  list.forEach((tool, idx) => {
    const name = paint(`${String(idx + 1).padStart(2, "0")} ${tool.name}`, "accent", "bold");
    console.log(name);
    console.log(`   ${paint(tool.description, "muted")}`);
  });
}

export async function runUiCommand({ getProvider, logger }) {
  const rl = readline.createInterface({ input, output });

  try {
    console.clear();
    console.log(renderWelcomeDashboard());

    while (true) {
      const choice = await chooseMenu(rl, "Ana Menu", MAIN_MENU);

      try {
        if (choice === 0) {
          await runAskFlow(rl, getProvider);
          await pause(rl);
          continue;
        }

        if (choice === 1) {
          await runChatFlow(rl, getProvider);
          continue;
        }

        if (choice === 2) {
          await runResearchFlow(rl, getProvider);
          await pause(rl);
          continue;
        }

        if (choice === 3) {
          await runTaskCenterFlow(rl, logger, getProvider);
          continue;
        }

        if (choice === 4) {
          await runChromeQuickFlow(rl);
          continue;
        }

        if (choice === 5) {
          await runDesktopQuickFlow(rl);
          continue;
        }

        if (choice === 6) {
          await runApiQuickFlow(rl);
          await pause(rl);
          continue;
        }

        if (choice === 7) {
          await runToolsFlow(getProvider);
          await pause(rl);
          continue;
        }

        if (choice === 8) {
          break;
        }
      } catch (error) {
        printError(error);
        await pause(rl);
      }
    }
  } finally {
    rl.close();
  }
}
