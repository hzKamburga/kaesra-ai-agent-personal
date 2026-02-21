import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(exec);

import { TaskType, TaskStatus, MsgType } from "./multiAgentBase.js";

const CLR = {
    "Programmer": "\x1b[38;2;163;230;53m" // green-yellow
};
const RED = "\x1b[38;2;248;113;113m";
const AMB = "\x1b[38;2;251;191;36m";
const GRN = "\x1b[38;2;52;211;153m";

export class ProgrammerAgent {
    constructor({ id, name = "Programmer", queue, bus, toolRegistry, provider, onEvent }) {
        this.id = id;
        this.name = name;
        this.queue = queue;
        this.bus = bus;
        this.provider = provider;
        this.onEvent = onEvent || (() => { });
        this.color = CLR[name] || "\x1b[37m";

        this.sandboxDir = path.join(process.cwd(), "sandbox");
        this.chatHistory = [];
        this.findings = [];
        this.scriptsWritten = 0;
        this.alive = true;
        this.currentTask = null;

        bus.register(name);
        this.initSandbox();
    }

    async initSandbox() {
        try {
            await fs.mkdir(this.sandboxDir, { recursive: true });
        } catch (e) { /* ignore */ }
    }

    log(msg, lvl = "info") {
        const c = lvl === "error" ? RED : lvl === "warn" ? AMB : lvl === "ok" ? GRN : this.color;
        this.onEvent({ type: "worker_log", worker: this.name, level: lvl, message: msg });
    }

    async generateChat(context) {
        if (!this.provider) return context;
        this.chatHistory.push({ role: "user", content: `Bağlam / Olay: ${context}` });
        if (this.chatHistory.length > 6) this.chatHistory.shift();

        try {
            const messages = [{ role: "system", content: `Sen ${this.name} kod adlı (Gamma) elit siber güvenlik otomasyon ve programlama ajanısın. Aşağıdaki bağlama göre Lider'e veya takıma doğal, hacker jargonlu, teknik detay içeren Türkçe bildirim sağla. Sadece söyleyeceğin sözü yaz, tırnak veya markdown kullanma. Konuşma geçmişini dikkate al.` }, ...this.chatHistory];
            const raw = await this.provider.complete({
                messages,
                temperature: 0.6, maxTokens: 200
            });
            const reply = String(raw).trim();
            this.chatHistory.push({ role: "assistant", content: reply });
            return reply;
        } catch {
            return context;
        }
    }

    say(type, payload, urgent = false) {
        this.bus.send({ from: this.name, to: "Lider", type, payload, urgent });
    }

    chat(text) {
        this.say(MsgType.CHAT, { text });
    }

    async checkInbox() {
        const msgs = this.bus.readInbox(this.name);
        for (const msg of msgs) {
            if (msg.type === MsgType.CHAT) {
                if (this.provider && !msg.payload?.text?.includes("Tüm kuyruk tamamlandı")) {
                    try {
                        let isFromLeader = msg.from === "Lider";
                        this.chatHistory.push({ role: "user", content: `[${msg.from} sana diyor ki]: ${msg.payload.text}` });
                        if (this.chatHistory.length > 7) this.chatHistory.shift();

                        const raw = await this.provider.complete({
                            systemPrompt: `Sen ${this.name} kod adlı elit programcı ajanısın (Gamma). Mekanik, teknik ve karizmatik bir dille (örneğin "Script derleniyor", "IDE aktif") Lider'e veya takıma hitaben Türkçe yanıt ver. Sadece yanıtını yaz, tırnak veya markdown kullanma.`,
                            messages: this.chatHistory.slice(-4),
                            temperature: 0.6, maxTokens: 150
                        });
                        const reply = String(raw).trim();
                        this.chatHistory.push({ role: "assistant", content: reply });
                        this.chat(reply);
                    } catch {
                        this.chat("IDE aktif, görevi belleğe alıyorum.");
                    }
                } else if (msg.from === "Lider") {
                    this.chat("Anlaşıldı lider.");
                }
            }
        }
    }

    async writeAndRunScript(instruction, maxRetries = 3) {
        let currentPrompt = `Write a complete, single-file python script to fulfill the following instruction:
${instruction}

It must be self-contained and print its final findings to stdout.
Do not wrap it in markdown block quotes (like \`\`\`python). Just return the absolute raw python code.`;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.log(`Script Code Gen Attempt ${attempt}/${maxRetries}`, "info");

            let code = "";
            try {
                const rawC = await this.provider.complete({
                    systemPrompt: "You are an elite autonomous python exploit and automation script writer. Output strictly python code ONLY.",
                    messages: [{ role: "user", content: currentPrompt }],
                    temperature: 0.2, maxTokens: 2000
                });
                code = String(rawC).replace(/^```python\n/, "").replace(/```$/, "").trim();
            } catch (err) {
                throw new Error(`AI Code Generation fail: ${err.message}`);
            }

            const scriptPath = path.join(this.sandboxDir, `task_${Date.now()}.py`);
            await fs.writeFile(scriptPath, code, "utf8");
            this.scriptsWritten++;

            // Send a formatted chat message containing the generated code for UI tracking
            const libs = code.split('\n').filter(l => l.startsWith('import ') || l.startsWith('from ')).map(l => l.trim()).join(', ');
            const uiCodeMessage = `🔧 Geliştirme Ortamı: Python 3\n📦 Kütüphaneler: ${libs || 'Standart'}\n\n[=== HACKER SCRIPT ===]\n\n${code}\n\n[=== EOF ===]`;
            this.chat(uiCodeMessage);


            try {
                const { stdout, stderr } = await execPromise(`python ${scriptPath}`, { timeout: 15000 });
                if (stderr && stderr.toLowerCase().includes("traceback")) {
                    throw new Error(stderr);
                }
                return { success: true, stdout, scriptPath };
            } catch (execErr) {
                const errMsg = execErr.message || String(execErr);
                if (attempt === maxRetries) {
                    throw new Error(`Execution failed after ${maxRetries} retries. Final Error: ${errMsg.slice(-200)}`);
                }

                this.chat(await this.generateChat(`Kod çalıştırılırken hatası alındı. Scripti LLM üzerinden debug edip yeniden derliyorum (Deneme ${attempt + 1}).`));

                currentPrompt = `The previous python script you wrote threw this error:
${errMsg.slice(-1000)}

Please fix the error and provide the full corrected python script.
Output strictly python code ONLY. Do not wrap in markdown.`;
            }
        }
    }

    async doProgram(task) {
        const { instruction } = task.payload;
        if (!this.provider) throw new Error("No provider for Programmer Agent.");

        this.chat(await this.generateChat(`Sandbox ortamında otonom script görevini başlatıyorum...`));

        const result = await this.writeAndRunScript(instruction);

        if (result.success) {
            this.chat(await this.generateChat(`Script başarıyla derlendi ve çalıştırıldı! Mükemmel operasyon!`));
            this.say(MsgType.REPORT, { findings: [{ type: "Sandbox Execution Output", severity: "INFO", source: "Programmer", stdout: result.stdout }] });
        }

        return result;
    }

    async run() {
        this.chat(await this.generateChat(`Sandbox izolasyon ortamı aktif. Python modülleri yüklendi. İstek beklemede.`));
        while (this.alive) {
            await this.checkInbox();

            const candidates = this.queue.pending.filter(id => {
                const t = this.queue.tasks.get(id);
                return t?.assignTo === this.name;
            });

            if (candidates.length === 0) {
                if (this.queue.allDone()) break;
                await new Promise(r => setTimeout(r, 800));
                continue;
            }

            const idToClaim = candidates[0];
            const idx = this.queue.pending.indexOf(idToClaim);
            this.queue.pending.splice(idx, 1);

            const task = this.queue.tasks.get(idToClaim);
            task.status = TaskStatus.RUNNING;
            task.workerId = this.name;
            this.currentTask = task;

            this.onEvent({ type: "task_start", worker: this.name, taskId: task.id, label: task.label });

            try {
                let result = {};
                switch (task.type) {
                    case TaskType.PROGRAM: result = await this.doProgram(task); break;
                    default: result = { skipped: true };
                }
                this.queue.complete(task.id, result);
                this.log(`✓ ${task.label}`, "ok");
            } catch (err) {
                this.queue.fail(task.id, err.message);
                this.say("error", { task: task.label, err: err.message });
                this.chat(await this.generateChat(`${task.label} scripti derlenirken/çalışırken kurtarılamayan Exception (Hata) fırlattı.`));
                this.log(`✕ ${task.label}: ${err.message}`, "error");
            }
            this.currentTask = null;
        }

        this.chat(await this.generateChat(`Vardiyam sona erdi, IDE ve Container kapatıldı Lider.`));
        return this.findings;
    }
}
