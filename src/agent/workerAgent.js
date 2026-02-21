/**
 * Kaesra Worker Agent v3
 * Worker'lar (Alpha, Beta) liderle sürekli iletişim halindedir
 * Chrome Live Bridge kullanır (Puppeteer yok)
 */

import {
    TaskType, TaskStatus, MsgType,
    chunkText, extractLinks, extractForms,
    classifyVulns, checkSecurityHeaders
} from "./multiAgentBase.js";

const CLR = {
    "Alpha": "\x1b[38;2;34;211;238m",   // cyan
    "Beta": "\x1b[38;2;167;139;250m"   // purple
};
const R = "\x1b[0m";
const B = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[38;2;248;113;113m";
const AMB = "\x1b[38;2;251;191;36m";
const GRN = "\x1b[38;2;52;211;153m";

// ─── Chrome Live Bridge ───────────────────────────────────────────
export class ChromeBridge {
    constructor(toolRegistry) { this.tr = toolRegistry; }

    async call(action, params = {}) {
        return this.tr.execute("chrome_live", { action, ...params });
    }

    async navigate(url, ms = 2500) {
        await this.call("navigateActive", { url });
        await this.call("wait", { ms });
    }

    async extract(maxChars = 12000) {
        try {
            const res = await this.call("extractActiveText", { maxChars });
            if (typeof res === "object" && res.text) return String(res.text);
            if (typeof res === "string") return res;
            return JSON.stringify(res);
        } catch {
            return "";
        }
    }

    async pageInfo() {
        try {
            const res = await this.call("getPageInfo");
            if (res && res.url) return res;
            throw new Error("Invalid page info");
        } catch (err) {
            // Fallback if background.js lacks getPageInfo
            try {
                const ex = await this.call("extractActiveText", { maxChars: 50 });
                return { url: ex?.url, title: ex?.title, scrollPercent: 0, atBottom: true };
            } catch {
                return { url: "", title: "", scrollPercent: 0, atBottom: true };
            }
        }
    }

    async evaluateJs(script) {
        try {
            return await this.call("executeJs", { script });
        } catch (err) {
            return { error: String(err.message) };
        }
    }

    async wait(ms = 1000) { return this.call("wait", { ms }); }

    async scroll(dir = "down", amount = 900) {
        try {
            return await this.call("scrollElement", { direction: dir, amount });
        } catch {
            return { moved: 0 };
        }
    }

    async fullPage(chunkSize = 3000, maxScrolls = 8) {
        const chunks = [];
        const seen = new Set();
        let scrolls = 0;

        while (scrolls <= maxScrolls) {
            const text = await this.extract(chunkSize * 2);
            if (!text || !text.trim()) break;

            const hash = text.slice(0, 80);
            if (!seen.has(hash)) {
                seen.add(hash);
                chunkText(text, chunkSize).forEach(c => {
                    if (!chunks.some(x => x.slice(0, 60) === c.slice(0, 60))) chunks.push(c);
                });
            }

            const info = await this.pageInfo();
            if (info?.atBottom || info?.scrollPercent >= 95) break;

            const scr = await this.scroll("down", 950);
            if (scr?.moved === 0) break;
            await this.wait(500);
            scrolls++;
        }
        return chunks;
    }
}

// ─── Worker Agent ─────────────────────────────────────────────────
export class WorkerAgent {
    constructor({ id, name, queue, bus, toolRegistry, provider, onEvent }) {
        this.id = id;
        this.name = name; // Alpha or Beta
        this.queue = queue;
        this.bus = bus;
        this.provider = provider;
        this.onEvent = onEvent || (() => { });
        this.chrome = new ChromeBridge(toolRegistry);
        this.color = CLR[name] || "\x1b[37m";

        this.chatHistory = [];
        this.findings = [];
        this.pagesVisited = 0;
        this.alive = true;
        this.currentTask = null;

        bus.register(name);
    }

    log(msg, lvl = "info") {
        const c = lvl === "error" ? RED : lvl === "warn" ? AMB : lvl === "ok" ? GRN : this.color;
        const t = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
        this.onEvent({ type: "worker_log", worker: this.name, level: lvl, message: msg });
    }

    async generateChat(context) {
        if (!this.provider) return context;
        this.chatHistory.push({ role: "user", content: `Bağlam / Olay: ${context}` });
        if (this.chatHistory.length > 6) this.chatHistory.shift();

        try {
            const messages = [{ role: "system", content: `Sen ${this.name} kod adlı elit bir siber güvenlik ajanısın. Alpha: Tarayıcı izleme/Crawl, Beta: Algı/Haritalama/Network, Delta: DOM/JS Analiz, Echo: API/Sorgu, Zeta: OSINT/Veri. Rolüne bürün. Lider'e veya takıma uzman jargonlu, hacker tarzında, kısa Türkçe bildirim sağla. Asla markdown veya tırnak kullanma. Doğrudan söyleyeceğin sözü yaz. Konuşma geçmişini dikkate al.` }, ...this.chatHistory];
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
            if (msg.type === MsgType.DIRECTIVE) {
                this.log(`Lider direktifi: ${msg.payload?.info || ""}`, "info");
            }
            if (msg.type === MsgType.CHAT) {
                if (this.provider && !msg.payload?.text?.includes("Tüm kuyruk tamamlandı")) {
                    try {
                        let isFromLeader = msg.from === "Lider";
                        this.chatHistory.push({ role: "user", content: `[${msg.from} sana diyor ki]: ${msg.payload.text}` });
                        if (this.chatHistory.length > 7) this.chatHistory.shift();

                        const raw = await this.provider.complete({
                            systemPrompt: `Sen ${this.name} kod adlı elit siber güvenlik ajanısın. Kısa, karizmatik ve profesyonel Türkçe yanıt ver. Asla markdown kullanma. Görev bilincini yansıt. Lidere "Sayın Lider" veya "Liderim" şeklinde hitap et, kendi ekip arkadaşlarına (Alpha, Beta vb.) ise yoldaş gibi hitap et.`,
                            messages: this.chatHistory.slice(-4),
                            temperature: 0.6, maxTokens: 150
                        });
                        const reply = String(raw).trim();
                        this.chatHistory.push({ role: "assistant", content: reply });
                        this.chat(reply);
                    } catch {
                        this.chat("Anlaşıldı, yerine getiriyorum.");
                    }
                } else if (msg.from === "Lider") {
                    this.chat("Anlaşıldı lider, yerine getiriyorum.");
                }
            }
        }
    }

    // ─── Görev İşleyiciler ──────────────────────────────────────────

    async doCrawl(task) {
        const { url, depth = 1, domain = "" } = task.payload;
        this.chat(await this.generateChat(`${url} adresinde ${depth} derinlikli geniş çağlı CRAWL (Tarama) operasyonunu başlatıyorum.`));

        await this.chrome.navigate(url, 3000);
        const info = await this.chrome.pageInfo();

        const pageUrl = String(info?.url || "");
        const pageTitle = String(info?.title || "").toLowerCase();

        if (pageUrl.includes("login") || pageTitle.includes("login")) {
            this.chat(await this.generateChat(`${url} adresinde Login doğrulama bariyerine takıldım. İlgili bölgeyi atlıyorum.`));
            return { type: "login_wall", url, pageUrl };
        }

        const chunks = await this.chrome.fullPage(3000);
        this.pagesVisited++;
        const fullText = chunks.join("\n");

        const links = extractLinks(fullText, url);
        const forms = extractForms(fullText);
        const vulns = classifyVulns(fullText, url);

        this.findings.push(...vulns);

        if (vulns.length > 0) {
            this.chat(await this.generateChat(`${url} üzerinde tarama sürecini bitirdim. Toplam ${vulns.length} potansiyel zafiyet/anomali saptadım, Lider'in değerlendirmesini bekliyorum.`));
        } else {
            this.chat(await this.generateChat(`${url} temiz olarak tarandı. ${forms.length} adet form, ${links.length} adet link çıkartıldı.`));
        }

        const criticals = vulns.filter(v => ["CRITICAL", "HIGH"].includes(v.severity));
        if (criticals.length) {
            this.say(MsgType.ALERT, { findings: criticals, url, worker: this.name }, true);
        }

        const sameDomain = links.filter(l => { try { return domain && new URL(l).hostname.includes(domain); } catch { return false; } });
        if (sameDomain.length > 0) {
            this.say(MsgType.DISCOVERY, { type: "links", url, links: sameDomain.slice(0, 10), forms: forms.length, depth });
        }

        if (forms.length > 0) {
            this.say(MsgType.DISCOVERY, { type: "forms", url, forms });
        }

        if (depth > 1 && sameDomain.length > 0) {
            const toQueue = sameDomain.slice(0, 4);
            for (const link of toQueue) {
                this.queue.add({ type: TaskType.CRAWL, payload: { url: link, depth: depth - 1, domain }, priority: 4, label: `crawl:${link.slice(0, 30)}` });
            }
        }

        return { chunks: chunks.length, links: links.length, forms: forms.length, vulns };
    }

    async doEndpointDiscover(task) {
        const { baseUrl, paths } = task.payload;
        this.chat(await this.generateChat(`${baseUrl} hedefinde hassas uç nokta (Endpoint) ve açık dizin tarama protokollerini başlattım.`));

        const targetPaths = paths || [];
        const discovered = [];

        for (const p of targetPaths) {
            const url = `${baseUrl.replace(/\/$/, "")}${p}`;
            try {
                await this.chrome.navigate(url, 1500);
                const text = await this.chrome.extract(2000);
                const info = await this.chrome.pageInfo();

                const title = String(info?.title || "").toLowerCase();
                if (!title.includes("404") && !title.includes("not found")) {
                    discovered.push(url);
                    const vulns = classifyVulns(text, url);
                    if (vulns.length > 0) {
                        this.say(MsgType.DISCOVERY, { type: "sensitive_path", url, path: p, vulns });
                        this.findings.push(...vulns);
                    }
                }
            } catch { /* ignore */ }
        }

        this.chat(await this.generateChat(`Endpoint tarama rutini sonlandı. Keşfedilen aktif ve erişilebilir uç nokta sayısı: ${discovered.length}.`));
        return { discovered };
    }

    async doNetworkMap(task) {
        const { domain } = task.payload;
        this.chat(await this.generateChat(`${domain} hedef kök adresi için dış ve iç Network, Subdomain haritalandırma çalışmalarına geçiyorum.`));

        const subdomains = [];
        try {
            const crtUrl = `https://crt.sh/?q=%.${domain}&output=json`;
            await this.chrome.navigate(crtUrl, 4000);
            const text = await this.chrome.extract(100000);

            let rawText = text;
            if (typeof text === 'object') rawText = JSON.stringify(text);

            const jsonMatch = String(rawText).match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const crtData = JSON.parse(jsonMatch[0])
                    .map(e => String(e.name_value || ""))
                    .filter(n => n.endsWith(`.${domain}`) && !n.includes("*"));
                subdomains.push(...crtData.slice(0, 30));
            }
        } catch (err) {
            this.log(`crt.sh hatası`, "warn");
        }

        const COMMON = task.payload.subdomainsToTest || [];
        for (const sub of COMMON) {
            const url = `https://${sub}.${domain}`;
            try {
                await this.chrome.navigate(url, 2000);
                const info = await this.chrome.pageInfo();
                if (info && info.url && !info.url.includes("error")) {
                    subdomains.push(url);
                    this.say(MsgType.DISCOVERY, { type: "subdomain", subdomain: `${sub}.${domain}`, url });
                    this.queue.add({ type: TaskType.CRAWL, payload: { url, depth: 1, domain }, priority: 6, label: `crawl:${sub}.${domain}` });
                }
            } catch { /* ignore */ }
        }

        const uniqueSubs = [...new Set(subdomains)];
        this.chat(await this.generateChat(`Network/Ağ Analizi başarıyla tamamlandı. Sisteme işlenen yegane subdomain (alt alan adı) sayısı: ${uniqueSubs.length}.`));
        return { subdomains: uniqueSubs };
    }

    async doProbe(task) {
        const { url, probeType } = task.payload;
        this.chat(await this.generateChat(`${url} noktasında spesifik ${probeType} (Probe) sızma simülasyonunu icra ediyorum.`));

        await this.chrome.navigate(url, 2000);
        const before = await this.chrome.extract(6000);
        const vulns = classifyVulns(before, url);
        this.findings.push(...vulns);

        if (probeType === "header_check") {
            const missing = checkSecurityHeaders(before);
            if (missing.length > 0) {
                this.findings.push({
                    type: "Missing Security Headers",
                    severity: "LOW", url, evidence: missing.map(h => h.name)
                });
            }
        }

        this.chat(await this.generateChat(`${url} testine yönelik ${probeType} simülasyonu sonlandırıldı. İleri sürülen bulgu sayısı: ${vulns.length}.`));
        return { url, probeType, vulns };
    }

    async doDeepScan(task) {
        const { url, context } = task.payload;
        if (!this.provider) return {};

        this.chat(await this.generateChat(`${url} hedef sektörü şüpheli faaliyet taşıyor. Nöral AI destekli Derin Analiz Modunu (Deep Scan) an itibariyle tetikledim.`));
        await this.chrome.navigate(url, 2500);
        const chunks = await this.chrome.fullPage(3000);

        try {
            const raw = await this.provider.complete({
                systemPrompt: "You are a cyber security expert. Analyze this HTML for injection, auth bypass, info disclosure.",
                messages: [{ role: "user", content: `URL: ${url}\nContent preview:\n${chunks.join("\n").slice(0, 4000)}\n\nOutput JSON {"findings": [{"type":"","severity":"","description":""}]}` }],
                temperature: 0.1, maxTokens: 1000
            });

            const jm = raw.match(/\{[\s\S]*\}/);
            if (jm) {
                const result = JSON.parse(jm[0]);
                if (result.findings?.length) {
                    this.findings.push(...result.findings.map(f => ({ ...f, url, source: "ai" })));
                    this.chat(await this.generateChat(`Analizimi tamamladım! İşlenen ${url} adresi için mantıksal zafiyet bulundu, toplam açık sayısı: ${result.findings.length}. Acil inceleme gerekir.`));
                } else {
                    this.chat(await this.generateChat(`Bölge temiz. ${url} noktasında yapılan derin analiz sonucunda mantıksal veya yapısal açık saptanamadı.`));
                }
                return result;
            }
        } catch { /* ignore */ }
        return {};
    }

    async doExecuteJs(task) {
        const { url, script } = task.payload;
        this.chat(await this.generateChat(`${url} üzerinde canlı DOM manipulasyonu / Script enjeksiyonu başlatıyorum.`));
        await this.chrome.navigate(url, 2000);

        const res = await this.chrome.evaluateJs(script);

        if (res && res.error) {
            this.log(`JS execution error: ${res.error}`, "warn");
            this.chat(await this.generateChat(`Enjekte edilen script HATA döndürdü. Detaylar: ${res.error.slice(0, 100)}`));
            return { error: res.error };
        } else {
            const outStr = typeof res.result === "string" ? res.result : JSON.stringify(res.result || {});
            this.say(MsgType.REPORT, { findings: [{ type: "JS Exec Result", severity: "INFO", payload: outStr.slice(0, 200) }] });
            this.chat(await this.generateChat(`JS Enjeksiyonu başarılı. Çıktı alındı: ${outStr.slice(0, 50)}... Liderin analizine sunuldu.`));
            return { result: res.result };
        }
    }

    async run() {
        this.chat(await this.generateChat(`Tüm güvenlik bariyerlerim ve sistemlerim devrede. İstekleri karşılamaya hazırım.`));
        while (this.alive) {
            await this.checkInbox();

            // Preferred tasks by name
            const candidates = this.queue.pending.filter(id => {
                const t = this.queue.tasks.get(id);
                return t?.assignTo === this.name || !t?.assignTo;
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
                    case TaskType.CRAWL: result = await this.doCrawl(task); break;
                    case TaskType.ENDPOINT_DISCOVER: result = await this.doEndpointDiscover(task); break;
                    case TaskType.NETWORK_MAP: result = await this.doNetworkMap(task); break;
                    case TaskType.PROBE: result = await this.doProbe(task); break;
                    case TaskType.DEEP_SCAN: result = await this.doDeepScan(task); break;
                    case TaskType.EXECUTE_JS: result = await this.doExecuteJs(task); break;
                    default: result = { skipped: true };
                }
                this.queue.complete(task.id, result);
                this.log(`✓ ${task.label}`, "ok");
            } catch (err) {
                this.queue.fail(task.id, err.message);
                this.say("error", { task: task.label, err: err.message });
                this.chat(await this.generateChat(`${task.label} görevinin ifası sırasında beklenmeyen kritik bir arıza meydana geldi. Hata Özeti: ${err.message}`));
                this.log(`✕ ${task.label}: ${err.message}`, "error");
            }
            this.currentTask = null;
        }

        this.chat(await this.generateChat(`Atanan görev listesi tamamlandı. Bekleme moduna (Idle) geçiş yapıldı lider.`));
        return this.findings;
    }
}
