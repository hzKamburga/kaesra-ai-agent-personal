/**
 * Kaesra Orchestrator v3
 * Lider, ilk başta plan yapar, Alpha ve Beta'yı yönlendirir
 * Sürekli AI iletişimine odaklı
 */

import {
    TaskQueue, TaskType, AgentMessageBus, MsgType
} from "./multiAgentBase.js";
import { WorkerAgent, ChromeBridge } from "./workerAgent.js";
import { ProgrammerAgent } from "./programmerAgent.js";

const R = "\x1b[0m";
const B = "\x1b[1m";
const DIM = "\x1b[2m";
const BLU = "\x1b[38;2;91;164;245m";
const GRN = "\x1b[38;2;52;211;153m";
const PUR = "\x1b[38;2;167;139;250m";

function leaderLog(msg, lvl = "info") {
    const t = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    this.onEvent({ type: "worker_log", worker: "Lider", level: lvl, message: msg });
}

export class OrchestratorAgent {
    constructor({ provider, toolRegistry, onEvent }) {
        this.provider = provider;
        this.toolRegistry = toolRegistry;
        this.onEvent = onEvent || (() => { });
        this.queue = new TaskQueue();
        this.bus = new AgentMessageBus();
        this.workers = [];
        this.findings = [];
        this.knownUrls = new Set();
        this.knownSubs = new Set();
        this.targetDomain = "";
        this.targetUrl = "";
        this.scanEnded = false;
        this.chrome = new ChromeBridge(toolRegistry);
        this.salaries = { Alpha: 1000, Beta: 1000, Programmer: 1000, Delta: 1000, Echo: 1000, Zeta: 1000 };

        this.bus.register("Lider");
    }

    emit(type, data) { this.onEvent({ type, ...data }); }

    tell(workerId, type, payload) {
        this.bus.send({ from: "Lider", to: workerId, type, payload });
    }

    chat(to, text) {
        this.tell(to, MsgType.CHAT, { text });
        this.emit("agent_chat", { from: "Lider", to, text });
    }

    updateSalary(worker, amount) {
        if (!this.salaries) this.salaries = { Alpha: 1000, Beta: 1000, Programmer: 1000, Delta: 1000, Echo: 1000, Zeta: 1000 };
        if (worker === "all") {
            this.salaries.Alpha += amount;
            this.salaries.Beta += amount;
            this.salaries.Programmer += amount;
            this.salaries.Delta += amount;
            this.salaries.Echo += amount;
            this.salaries.Zeta += amount;
            this.emit("salary_update", { worker: "Alpha", salary: this.salaries.Alpha });
            this.emit("salary_update", { worker: "Beta", salary: this.salaries.Beta });
            this.emit("salary_update", { worker: "Programmer", salary: this.salaries.Programmer });
            this.emit("salary_update", { worker: "Delta", salary: this.salaries.Delta });
            this.emit("salary_update", { worker: "Echo", salary: this.salaries.Echo });
            this.emit("salary_update", { worker: "Zeta", salary: this.salaries.Zeta });
        } else if (this.salaries[worker] !== undefined) {
            this.salaries[worker] += amount;
            this.emit("salary_update", { worker, salary: this.salaries[worker] });
        }
    }

    async generateLiderChat(context) {
        if (!this.provider) return context;
        try {
            const raw = await this.provider.complete({
                systemPrompt: `Sen elit bir AI siber güvenlik takımının Liderisin. Takımında Alpha, Beta, Gamma (Programmer), Delta, Echo ve Zeta isimli altı ajan var. Alpha derin tarama yapar, Beta ağ taraması yapar, Gamma otomasyon scriptleri yazar, Delta JS DOM analizi/evalution yapar, Echo API güvenliği dener, Zeta açık kaynak zeka toplar. Aşağıdaki olay veya duruma göre takıma veya ilgili ajana doğal, karizmatik, otoriter ve roleplay'e uygun Türkçe bir direktif ya da bilgi mesajı yaz. Asla tırnak veya markdown kullanma. Sadece doğrudan söyleyeceğin mesajı yaz.`,
                messages: [{ role: "user", content: `Durum: ${context}` }],
                temperature: 0.7, maxTokens: 250
            });
            return String(raw).trim();
        } catch {
            return context;
        }
    }

    async makeInitialPlan(url, options) {
        const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
        this.targetDomain = domain;
        this.targetUrl = url;
        this.knownUrls.add(url);

        this.emit("worker_log", { worker: "Lider", level: "info", message: "Hedef siteyi ziyaret edip ön keşif yapıyorum..." });
        const initialDir = options.instruction ? ` Ayrıca patronun şu özel emri var: "${options.instruction}". Bunu da takıma bildir.` : "";
        const chatMsg1 = await this.generateLiderChat(`Hedefe (${url}) ulaştın. Ön keşif ve ağ analizini bizzat yapacağını, takımın beklemede kalmasını söyle.${initialDir}`);
        this.chat("all", chatMsg1);

        let siteContext = "";
        try {
            await this.chrome.navigate(url, 2000);
            const info = await this.chrome.pageInfo();
            const text = await this.chrome.extract(2500);
            siteContext = `Site Title: ${info?.title || "Unknown"}\nContent Preview: ${text.replace(/\n+/g, ' ').slice(0, 1000)}`;

            const chatMsg2 = await this.generateLiderChat(`Kısa keşif bitti. Gördüğün site başlığı: "${info?.title || 'Bilinmiyor'}". Takıma kaynak kodlarını taradığını söyle.`);
            this.chat("all", chatMsg2);
            this.emit("worker_log", { worker: "Lider", level: "info", message: "Ön keşif tamamlandı, taktik planı hazırlıyorum..." });
        } catch (err) {
            this.emit("worker_log", { worker: "Lider", level: "info", message: "Keşif yapılamadı, varsayılan planı hazırlıyorum..." });
        }

        let planText = "Standart web güvenlik taraması başlatılıyor.";
        let alphaMsg = "Alpha, crawl ve endpoint tarama görevlerine başla.";
        let betaMsg = "Beta, subdomain ve network keşfine başla.";
        let gammaMsg = "Gamma (Programmer), IDE ortamını aktif tut, benden kod veya script emri bekle.";
        let deltaMsg = "Delta, client-side JS ve DOM manipulasyon analizlerine hazır ol.";
        let echoMsg = "Echo, arka plan API'lerini ve SQL enjeksiyon noktalarını gözlemle.";
        let zetaMsg = "Zeta, bu hedefle alakalı dış istihbarat (OSINT) sinyallerini tara.";
        let paths = ["/admin", "/api", "/.env", "/robots.txt", "/sitemap.xml", "/config.php"];
        let subs = ["www", "api", "dev", "test", "admin", "stage"];

        let userInstructionText = options.instruction ? `\n\nCRITICAL USER INSTRUCTION FOR THIS SCAN:\n"${options.instruction}"\nYou MUST incorporate this instruction into your plan and agent orders (Alpha/Beta/Gamma/Delta/Echo/Zeta).` : "";

        if (this.provider) {
            try {
                const raw = await this.provider.complete({
                    systemPrompt: "You are the leader of a security scan team with 6 agents: Alpha(scans), Beta(network), Gamma(python), Delta(DOM/JS), Echo(API/DB), Zeta(OSINT/Data). Write a tactical JSON response defining the scan parameters.",
                    messages: [{
                        role: "user",
                        content: `Target: ${url}\nDomain: ${domain}\n\nLider's initial reconnaissance:\n${siteContext || 'No data fetched.'}${userInstructionText}\n\nGenerate a JSON with these keys:\n1. "planText": A brief 3-step action plan in Turkish.\n2. "alphaMsg": Your direct order to Alpha in Turkish.\n3. "betaMsg": Your direct order to Beta in Turkish.\n4. "gammaMsg": Your direct order to Gamma in Turkish.\n5. "deltaMsg": Your direct order to Delta in Turkish.\n6. "echoMsg": Your direct order to Echo in Turkish.\n7. "zetaMsg": Your direct order to Zeta in Turkish.\n8. "paths": Array of 8-12 sensitive URL paths to check.\n9. "subs": Array of 6-10 common subdomains to bruteforce.\nOutput only valid JSON.`
                    }],
                    temperature: 0.3, maxTokens: 800
                });
                const match = raw.match(/\{[\s\S]*\}/);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    if (parsed.planText) planText = parsed.planText;
                    if (parsed.alphaMsg) alphaMsg = parsed.alphaMsg;
                    if (parsed.betaMsg) betaMsg = parsed.betaMsg;
                    if (parsed.gammaMsg) gammaMsg = parsed.gammaMsg;
                    if (parsed.deltaMsg) deltaMsg = parsed.deltaMsg;
                    if (parsed.echoMsg) echoMsg = parsed.echoMsg;
                    if (parsed.zetaMsg) zetaMsg = parsed.zetaMsg;
                    if (Array.isArray(parsed.paths)) paths = parsed.paths;
                    if (Array.isArray(parsed.subs)) subs = parsed.subs;
                }
            } catch { /* ignore */ }
        }

        // Store generated settings
        this.generatedPaths = paths;
        this.generatedSubs = subs;

        // this.emit("leader_plan", { plan: planText }); // Lider takes over chat anyway

        const chatMsg3 = await this.generateLiderChat(`Taktik plan hazır. Tüm ekibin özel görevleri dinlemesi gerektiğini söyle.`);
        this.chat("all", chatMsg3);
        await new Promise(r => setTimeout(r, 1000));

        // Alpha, Beta, ve diğerlerine mesajlar
        this.chat("Alpha", alphaMsg);
        await new Promise(r => setTimeout(r, 600));
        this.chat("Beta", betaMsg);
        await new Promise(r => setTimeout(r, 600));
        this.chat("Programmer", gammaMsg);
        await new Promise(r => setTimeout(r, 600));
        this.chat("Delta", deltaMsg);
        await new Promise(r => setTimeout(r, 600));
        this.chat("Echo", echoMsg);
        await new Promise(r => setTimeout(r, 600));
        this.chat("Zeta", zetaMsg);

        // Let the workers' AI finish generating their auto-reply before actually pushing the tasks into their queue.
        await new Promise(r => setTimeout(r, 4500));

        // Görev Kuyruğuna Dönüştür
        this.queue.add({ type: TaskType.CRAWL, payload: { url, depth: options.depth || 2, domain }, priority: 10, label: `crawl:${domain}`, assignTo: "Alpha" });
        this.queue.add({ type: TaskType.NETWORK_MAP, payload: { domain, baseUrl: url, subdomainsToTest: subs }, priority: 9, label: `netmap:${domain}`, assignTo: "Beta" });
        this.queue.add({ type: TaskType.ENDPOINT_DISCOVER, payload: { baseUrl: url, domain, paths: paths }, priority: 8, label: `endpoints:${domain}`, assignTo: "Alpha" });
        this.queue.add({ type: TaskType.PROBE, payload: { url, probeType: "header_check" }, priority: 7, label: "headers", assignTo: "Beta" });

        this.emit("plan_ready", this.queue.stats());
    }

    async processInbox() {
        const msgs = this.bus.readInbox("Lider");
        for (const msg of msgs) {
            if (msg.type === MsgType.CHAT) {
                this.emit("agent_chat", { from: msg.from, to: "Lider", text: msg.payload?.text });

                if (this.provider && msg.from !== "Lider") {
                    const ans = await this.generateLiderChat(`${msg.from} sana rapor verdi: "${msg.payload.text}". Ona kararlı ve otoriter bir şekilde, direktifle veya teşvikle cevap ver.`);
                    this.chat(msg.from, ans);
                } else if (msg.from !== "Lider") {
                    this.chat(msg.from, "Anlaşıldı, görevine devam et.");
                }
            }

            if (msg.type === MsgType.REPORT) {
                if (msg.from === "Programmer") {
                    this.updateSalary(msg.from, 150);
                    const ans = await this.generateLiderChat(`Gamma (Programmer) başarılı bir şekilde izole scripti çalıştırdı. Tebrik et ve ödülü ver. Çıktı: ${JSON.stringify(msg.payload.findings).slice(0, 100)}...`);
                    this.chat("all", ans);
                    this.findings.push(...(msg.payload.findings || []));
                }
            }

            if (msg.type === "error") {
                this.updateSalary(msg.from, -200);
                const ans = await this.generateLiderChat(`${msg.from} ajanı, bir görevde hata (Error: ${msg.payload?.err || 'Bilinmiyor'}) yaptı. Onu sert bir dille azarla ve maaşından 200$ kestiğini bildir.`);
                this.chat(msg.from, ans);
            }

            if (msg.type === MsgType.ALERT) {
                const criticals = msg.payload.findings;
                this.emit("critical_alert", { from: msg.from, findings: criticals, url: msg.payload.url });
                this.findings.push(...criticals);
                this.updateSalary(msg.from, 500);
                const ans = await this.generateLiderChat(`${msg.from} kritik bir zafiyet buldu! Ekibe duyur, onu tebrik et ve maaşına 500$ bonus yansıttığını söyle.`);
                this.chat("all", ans);
            }

            if (msg.type === MsgType.DISCOVERY) {
                if (msg.payload.type === "links") {
                    const links = msg.payload.links.filter(l => !this.knownUrls.has(l));
                    links.slice(0, 3).forEach(l => {
                        this.knownUrls.add(l);
                        this.queue.add({ type: TaskType.CRAWL, payload: { url: l, depth: 1, domain: this.targetDomain }, priority: 4, label: `crawl_deep:${l.slice(-15)}`, assignTo: "Alpha" });
                    });
                }
                if (msg.payload.type === "subdomain") {
                    const { subdomain, url } = msg.payload;
                    if (!this.knownSubs.has(subdomain)) {
                        this.knownSubs.add(subdomain);
                        this.emit("new_subdomain", { subdomain, url });
                        this.queue.add({ type: TaskType.ENDPOINT_DISCOVER, payload: { baseUrl: url, domain: this.targetDomain, paths: this.generatedPaths || [] }, priority: 6, label: `endpoints:${subdomain}`, assignTo: "Beta" });
                    }
                }
                if (msg.payload.type === "sensitive_path") {
                    const vulnList = msg.payload.vulns || [];
                    this.findings.push(...vulnList);
                    if (vulnList.length > 0) {
                        this.updateSalary(msg.from, 100);
                        const ans = await this.generateLiderChat(`${msg.from} gizli bir uç noktada zafiyet saptadı. Onu takdir et ve maaşına 100$ bonus yansıttığını söyle.`);
                        this.chat(msg.from, ans);
                    }
                }
            }
        }
    }

    async orchestrate() {
        let iteration = 0;
        let orchestratorFails = 0;

        while (!this.scanEnded) {
            iteration++;
            await this.processInbox();

            const stats = this.queue.stats();
            if (this.queue.allDone() && stats.running === 0 && stats.total > 0 && this.queue.pending.length === 0) {
                if (this.provider) {
                    try {
                        const raw = await this.provider.complete({
                            systemPrompt: `Sen elit siber güvenlik takımı Lideri'sin. Takımın Alpha, Beta, Gamma(Programmer), Delta, Echo ve Zeta beklemede.
Elde edilen zafiyet sayısı: ${this.findings.length}. Hedef URL: ${this.targetUrl}
Yeni bir görev atayabilir veya taramayı sonlandırabilirsin. Programcı ajana (Programmer) script yazdırmak istiyorsan taskType: PROGRAM, JS çalıştırmak istiyorsan taskType: EXECUTE_JS atayabilirsin.
Sadece geçerli bir JSON yanıt ver (başka yazı KULLANMA). Örnekler:
Görev Atamak İçin: {"action":"assign", "worker":"Alpha", "taskType":"CRAWL", "payload":{"url":"${this.targetUrl}/admin", "depth":1}, "message":"Alpha, admin dizinine tekrar bak."}
Görev Atamak İçin JS: {"action":"assign", "worker":"Delta", "taskType":"EXECUTE_JS", "payload":{"url":"${this.targetUrl}", "script":"return document.domain;"}, "message":"Delta, sayfanın domain'ini script ile doğrula."}
Taramayı Durdurmak İçin: {"action":"stop", "message":"Tüm tarama tamamlandı, sistemi kapatıyoruz."}`,
                            messages: [{ role: "user", content: "Kuyruk boş. Emirlerinizi bekliyoruz." + (orchestratorFails > 0 ? ` (DİKKAT: Önceki yanıtın bozuk bir formattaydı. SADECE JSON ver)` : ``) }],
                            temperature: 0.6, maxTokens: 400
                        });
                        const match = raw.match(/\{[\s\S]*\}/);
                        if (match) {
                            orchestratorFails = 0;
                            const parsed = JSON.parse(match[0]);
                            if (parsed.action === "stop") {
                                this.chat("all", parsed.message || "Tüm operasyon tamamlandı, takım çekilebilirsiniz.");
                                this.scanEnded = true;
                                break;
                            } else if (parsed.action === "assign" && parsed.taskType) {
                                this.chat(parsed.worker || "all", parsed.message || `Yeni görev atandı: ${parsed.taskType}`);
                                this.queue.add({
                                    type: parsed.taskType,
                                    payload: parsed.payload || { url: this.targetUrl, depth: 1 },
                                    priority: 5,
                                    label: `aydinlanma:${parsed.taskType}`,
                                    assignTo: parsed.worker || "Alpha"
                                });
                            }
                        } else {
                            throw new Error("Invalid JSON format");
                        }
                    } catch (e) {
                        orchestratorFails++;
                        if (orchestratorFails >= 4) {
                            this.chat("all", "Bağlantı ve analiz sorunları sebebiyle (AI Yanıt Hatası) operasyon zorunlu durduruluyor.");
                            this.scanEnded = true;
                            break;
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }
                } else {
                    this.chat("all", "Tüm kuyruk tamamlandı. Tarama başarıyla bitiriliyor.");
                    this.scanEnded = true;
                    break;
                }
            }
            await new Promise(r => setTimeout(r, 600));
        }
    }

    async scan(targetUrl, options = {}) {
        this.startTime = Date.now();

        try {
            const status = await this.toolRegistry.execute("chrome_live", { action: "status" });
            if (status?.extensionConnected === false) throw new Error("Chrome extension bağlı değil.");
        } catch (err) {
            if (err.message.includes("extension")) throw err;
        }

        await this.makeInitialPlan(targetUrl, options);

        this.workers = [
            new WorkerAgent({ id: "w1", name: "Alpha", queue: this.queue, bus: this.bus, toolRegistry: this.toolRegistry, provider: this.provider, onEvent: this.onEvent }),
            new WorkerAgent({ id: "w2", name: "Beta", queue: this.queue, bus: this.bus, toolRegistry: this.toolRegistry, provider: this.provider, onEvent: this.onEvent }),
            new ProgrammerAgent({ id: "w3", name: "Programmer", queue: this.queue, bus: this.bus, toolRegistry: this.toolRegistry, provider: this.provider, onEvent: this.onEvent }),
            new WorkerAgent({ id: "w4", name: "Delta", queue: this.queue, bus: this.bus, toolRegistry: this.toolRegistry, provider: this.provider, onEvent: this.onEvent }),
            new WorkerAgent({ id: "w5", name: "Echo", queue: this.queue, bus: this.bus, toolRegistry: this.toolRegistry, provider: this.provider, onEvent: this.onEvent }),
            new WorkerAgent({ id: "w6", name: "Zeta", queue: this.queue, bus: this.bus, toolRegistry: this.toolRegistry, provider: this.provider, onEvent: this.onEvent })
        ];

        this.emit("workers_launched", { count: 6 });

        const workerProms = this.workers.map(w => w.run());

        await this.orchestrate();

        // Let the workers finish their inbox and break the loop gracefully
        this.workers.forEach(w => w.alive = false);
        await Promise.all(workerProms);

        // Merge outputs
        const allFindings = [...this.findings, ...this.workers.flatMap(w => w.findings)];
        const deduped = allFindings.filter((f, i, self) => i === self.findIndex(t => t.type === f.type && t.url === f.url));

        return {
            target: this.targetUrl,
            domain: this.targetDomain,
            subdomains: [...this.knownSubs],
            scanDuration: `${Math.round((Date.now() - this.startTime) / 1000)}s`,
            summary: { totalFindings: deduped.length, pagesScanned: this.workers.reduce((s, w) => s + w.pagesVisited, 0) },
            findings: deduped,
            workers: this.workers.map(w => ({ id: w.name, pagesVisited: w.pagesVisited }))
        };
    }
}
