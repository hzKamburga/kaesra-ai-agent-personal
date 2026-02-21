import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AssistantAgent } from "../agent/assistantAgent.js";

/* ─── ANSI Colors ─── */
const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[38;2;91;164;245m",
  purple: "\x1b[38;2;167;139;250m",
  pink: "\x1b[38;2;244;114;182m",
  cyan: "\x1b[38;2;34;211;238m",
  green: "\x1b[38;2;52;211;153m",
  amber: "\x1b[38;2;251;191;36m",
  red: "\x1b[38;2;248;113;113m",
  text: "\x1b[38;2;232;236;244m",
  muted: "\x1b[38;2;100;116;139m",
  faint: "\x1b[38;2;71;85;105m"
};

function paint(val, ...styles) {
  const t = String(val ?? "");
  if (!styles.length) return t;
  return styles.map((s) => A[s] || "").join("") + t + A.reset;
}

function gradientLine(text) {
  const colors = [[91, 164, 245], [167, 139, 250], [244, 114, 182]];
  let out = "";
  const len = Math.max(1, text.length - 1);
  for (let i = 0; i < text.length; i++) {
    const t = i / len;
    const idx = Math.min(Math.floor(t * (colors.length - 1)), colors.length - 2);
    const lt = (t * (colors.length - 1)) - idx;
    const [r, g, b] = colors[idx].map((c, j) => Math.round(c + (colors[idx + 1][j] - c) * lt));
    out += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
  }
  return out + A.reset;
}

const LOGO = [
  " _  __    _    _____ ____  ____      _",
  "| |/ /   / \\   | ____/ ___||  _ \\    / \\",
  "| ' /   / _ \\  |  _| \\___ \\| |_) |  / _ \\",
  "| . \\  / ___ \\ | |___ ___) |  _ <  / ___ \\",
  "|_|\\_\\/_/   \\_\\_____|____/|_| \\_\\/_/   \\_\\"
];

export async function runChatCommand({ provider, toolRegistry }) {
  if (!provider) {
    throw new Error("Chat mode needs a configured AI provider");
  }

  const printLiveEvent = (event) => {
    if (!event || typeof event !== "object") return;

    if (event.type === "tool_call") {
      console.log(`\n  ${paint("⚙️  →", "cyan", "bold")} ${paint(event.tool, "purple", "bold")} ${paint(JSON.stringify(event.input).slice(0, 80), "muted")}`);
    } else if (event.type === "tool_result") {
      const out = typeof event.output === "string" ? event.output : JSON.stringify(event.output);
      console.log(`  ${paint("✓", "green", "bold")} ${paint(event.tool, "purple")} ${paint("done", "green")} ${paint(out.slice(0, 60), "faint")}`);
    } else if (event.type === "tool_error") {
      if (event.tool === "parser") return;
      console.log(`  ${paint("✕", "red", "bold")} ${paint(event.tool, "red")} ${paint(String(event.error).slice(0, 80), "red")}`);
    } else if (typeof event.log === "string" && event.log.trim()) {
      console.log(`  ${paint(event.log, "muted")}`);
    }
  };

  const agent = new AssistantAgent({
    provider,
    toolRegistry,
    maxSteps: -1,
    onEvent: printLiveEvent
  });

  const rl = readline.createInterface({ input, output });

  console.clear();
  console.log("");
  for (const line of LOGO) {
    console.log(`  ${gradientLine(line)}`);
  }
  console.log("");
  console.log(`  ${paint("💬 Chat Modu", "purple", "bold")}  ${paint("●", "green")} ${paint(provider.model || "ai", "blue")}`);
  console.log(`  ${paint("━".repeat(Math.min(80, (output.columns || 80) - 4)), "faint")}`);
  console.log(`  ${paint("Komutlar:", "muted")} ${paint("/clear", "blue")} ${paint("·", "faint")} ${paint("/reset", "blue")} ${paint("·", "faint")} ${paint("/mode", "cyan")} ${paint("·", "faint")} ${paint("/stats", "green")} ${paint("·", "faint")} ${paint("/memory", "purple")} ${paint("·", "faint")} ${paint("/help", "amber")} ${paint("·", "faint")} ${paint("exit", "amber")}`);
  console.log("");

  while (true) {
    // Show skill mode indicator in prompt
    const modeTag = agent.skillMode !== "general" ? paint(` [${agent.skillMode}]`, "cyan") : "";
    const userInput = (await rl.question(`  ${paint("❯", "blue", "bold")}${modeTag} `)).trim();

    if (!userInput) continue;

    if (["exit", "quit", "q"].includes(userInput.toLowerCase())) {
      console.log(`\n  ${paint("Görüşürüz! 👋", "purple")}\n`);
      break;
    }

    if (userInput === "/clear") {
      console.clear();
      console.log("");
      for (const line of LOGO) {
        console.log(`  ${gradientLine(line)}`);
      }
      console.log("");
      console.log(`  ${paint("💬 Chat Modu", "purple", "bold")}  ${paint("●", "green")} ${paint(provider.model || "ai", "blue")}`);
      console.log(`  ${paint("━".repeat(Math.min(80, (output.columns || 80) - 4)), "faint")}`);
      console.log(`  ${paint("✓ Ekran temizlendi, sohbet hafızası korundu.", "green")}`);
      console.log("");
      continue;
    }

    if (userInput === "/reset") {
      agent.reset();
      console.log(`\n  ${paint("✓", "green", "bold")} ${paint("Sohbet hafızası sıfırlandı.", "green")}\n`);
      continue;
    }

    if (userInput === "/help") {
      console.log(`\n  ${paint("📖 Kaesra Agent — Özel Komutlar:", "purple", "bold")}`);
      console.log(`  ${paint("/clear", "blue")}        Ekranı temizler (hafıza korunur)`);
      console.log(`  ${paint("/reset", "blue")}        Sohbet hafızasını sıfırlar`);
      console.log(`  ${paint("/mode <mod>", "cyan")}   Skill modunu değiştirir: general | code | research | chrome | creative`);
      console.log(`  ${paint("/stats", "green")}        Token sayacı ve oturum istatistikleri`);
      console.log(`  ${paint("/memory", "purple")}      Kaydedilmiş hafıza özeti`);
      console.log(`  ${paint("/help", "amber")}         Bu yardım menüsü`);
      console.log(`  ${paint("exit / quit", "red")}   Çıkış`);
      console.log("");
      continue;
    }

    if (userInput.startsWith("/mode")) {
      const parts = userInput.split(/\s+/);
      const newMode = parts[1]?.toLowerCase() || "";
      const valid = ["general", "code", "research", "chrome", "creative"];
      if (!newMode || !valid.includes(newMode)) {
        console.log(`\n  ${paint("Geçerli modlar:", "amber")} ${valid.map(m => paint(m, "cyan")).join(paint(" | ", "faint"))}\n`);
      } else {
        agent.setSkillMode(newMode);
        console.log(`\n  ${paint("✓", "green", "bold")} ${paint(`Skill modu değiştirildi: ${newMode.toUpperCase()}`, "green")}\n`);
      }
      continue;
    }

    if (userInput === "/stats") {
      const stats = agent.getStats();
      console.log(`\n  ${paint("📊 Oturum İstatistikleri:", "green", "bold")}`);
      console.log(`  ${paint("Mesaj sayısı:", "muted")}      ${paint(stats.messageCount, "text")}`);
      console.log(`  ${paint("Tahmini token:", "muted")}     ${paint(stats.estimatedTokens.toLocaleString(), "amber")}`);
      console.log(`  ${paint("Toplam token:", "muted")}      ${paint(stats.totalTokensUsed.toLocaleString(), "amber")}`);
      console.log(`  ${paint("Skill modu:", "muted")}        ${paint(stats.skillMode.toUpperCase(), "cyan")}`);
      console.log(`  ${paint("Oturum başladı:", "muted")}    ${paint(new Date(stats.sessionStarted).toLocaleTimeString("tr-TR"), "text")}`);
      if (stats.topics?.length) {
        console.log(`  ${paint("Konular:", "muted")}           ${paint(stats.topics.join(", "), "purple")}`);
      }
      console.log("");
      continue;
    }

    if (userInput === "/memory") {
      console.log(`\n  ${paint("🧠 Hafıza yükleniyor...", "purple")}`);
      try {
        const memResult = await agent.toolRegistry.execute("memory", { action: "list" });
        const cats = memResult?.categories || {};
        const catNames = Object.keys(cats);
        if (!catNames.length) {
          console.log(`  ${paint("Hafıza boş.", "muted")}`);
        } else {
          for (const [cat, keys] of Object.entries(cats)) {
            console.log(`  ${paint(`[${cat}]`, "cyan", "bold")} ${paint(keys.join(", "), "text")}`);
          }
        }
      } catch (err) {
        console.log(`  ${paint("Hafıza okunamadı: " + err.message, "red")}`);
      }
      console.log("");
      continue;
    }

    try {
      console.log(`\n  ${paint("⟳ Düşünüyor...", "amber")}`);
      const result = await agent.ask(userInput);
      console.log("");

      // Wrap response text nicely
      const maxW = Math.max(48, (output.columns || 80) - 8);
      const words = (result.message || "").split(/\s+/);
      let current = "";
      const lines = [];

      for (const w of words) {
        if (!current) { current = w; continue; }
        if ((current + " " + w).length <= maxW) { current += " " + w; }
        else { lines.push(current); current = w; }
      }
      if (current) lines.push(current);

      if (lines.length) {
        console.log(`  ${paint("✦", "purple", "bold")} ${paint(lines[0], "text")}`);
        for (let i = 1; i < lines.length; i++) {
          console.log(`    ${paint(lines[i], "text")}`);
        }
      }
      console.log("");
    } catch (error) {
      console.log(`\n  ${paint("✕", "red", "bold")} ${paint(error.message, "red")}\n`);
    }
  }

  rl.close();
}
