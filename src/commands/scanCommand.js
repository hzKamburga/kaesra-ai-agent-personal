/**
 * Kaesra Scan Command v3
 * Canlı AI Takım Sohbeti (Lider, Alpha, Beta) + Güvenlik Taraması
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { OrchestratorAgent } from "../agent/orchestratorAgent.js";

const A = {
    r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", it: "\x1b[3m",
    blue: "\x1b[38;2;91;164;245m",
    purple: "\x1b[38;2;167;139;250m",
    pink: "\x1b[38;2;244;114;182m",
    cyan: "\x1b[38;2;34;211;238m",
    green: "\x1b[38;2;52;211;153m",
    amber: "\x1b[38;2;251;191;36m",
    red: "\x1b[38;2;248;113;113m",
    text: "\x1b[38;2;232;236;244m",
    muted: "\x1b[38;2;100;116;139m",
    faint: "\x1b[38;2;71;85;105m",
    CRITICAL: "\x1b[38;2;239;68;68m",
    HIGH: "\x1b[38;2;249;115;22m",
    MEDIUM: "\x1b[38;2;234;179;8m",
    LOW: "\x1b[38;2;34;197;94m",
    INFO: "\x1b[38;2;100;116;139m"
};
const p = (v, ...s) => s.map(x => A[x] || "").join("") + String(v ?? "") + A.r;

function grad(t) {
    const stops = [[91, 164, 245], [167, 139, 250], [244, 114, 182]];
    const n = Math.max(1, t.length - 1);
    return t.split("").map((ch, i) => {
        const p = i / n;
        const si = Math.min(Math.floor(p * (stops.length - 1)), stops.length - 2);
        const lt = p * (stops.length - 1) - si;
        const [r, g, b] = stops[si].map((c, j) => Math.round(c + (stops[si + 1][j] - c) * lt));
        return `\x1b[38;2;${r};${g};${b}m${ch}`;
    }).join("") + A.r;
}

function banner(url) {
    console.clear();
    const title = `
 ██╗  ██╗ █████╗ ███████╗███████╗██████╗  █████╗ 
 ██║ ██╔╝██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗
 █████╔╝ ███████║█████╗  ███████╗██████╔╝███████║
 ██╔═██╗ ██╔══██║██╔══╝  ╚════██║██╔══██╗██╔══██║
 ██║  ██╗██║  ██║███████╗███████║██║  ██║██║  ██║
 ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝`;

    title.split('\n').filter(Boolean).forEach(l => console.log(`  ${grad(l)}`));
    console.log(`\n  ${p("MULTI-AGENT SCAN", "purple", "b")} ${p("v3", "muted")} ${p("│", "faint")} ${p("Lider + 5 Uzman Ajan", "blue")} ${p("│", "faint")} ${p("AI Team", "cyan")}\n`);

    console.log(`  ${A.blue}╔${"═".repeat(60)}╗${A.r}`);
    console.log(`  ${A.blue}║${A.r} ${p("🎯 Hedef:", "muted", "b")}  ${p(url, "amber", "b").padEnd(46 + 18)} ${A.blue}║${A.r}`);
    console.log(`  ${A.blue}║${A.r} ${p("🤖 Ekip:", "muted")}   ${p("[LİDER]", "blue", "b")} ${p("[Alpha]", "cyan", "b")} ${p("[Beta]", "purple", "b")} ${p("[Gamma]", "green", "b")} ${p("[Delta]", "amber", "b")} ${p("[Echo]", "pink", "b")} ${p("[Zeta]", "blue", "dim")} ${A.blue}║${A.r}`);
    console.log(`  ${A.blue}╚${"═".repeat(60)}╝${A.r}\n`);
}

function makeHandler() {
    const spin = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let frame = 0, timer = null, phase = "";
    const agents = { Alpha: "idle", Beta: "idle", Programmer: "idle", Delta: "idle", Echo: "idle", Zeta: "idle" };
    let findings = 0;
    let salaries = { Alpha: 1000, Beta: 1000, Programmer: 1000, Delta: 1000, Echo: 1000, Zeta: 1000 };

    let queue = [];
    let isProcessing = false;

    const start = () => {
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
            frame = (frame + 1) % spin.length;
            const alphaSal = salaries.Alpha !== undefined ? p(` $${salaries.Alpha}`, "green") : "";
            const betaSal = salaries.Beta !== undefined ? p(` $${salaries.Beta}`, "green") : "";
            const progSal = salaries.Programmer !== undefined ? p(` $${salaries.Programmer}`, "green") : "";
            const deltaSal = salaries.Delta !== undefined ? p(` $${salaries.Delta}`, "green") : "";
            const echoSal = salaries.Echo !== undefined ? p(` $${salaries.Echo}`, "green") : "";
            const zetaSal = salaries.Zeta !== undefined ? p(` $${salaries.Zeta}`, "green") : "";

            const alpha = agents.Alpha === "run" ? p(`●Alpha${alphaSal}`, "cyan", "b") : p(`○Alpha${alphaSal}`, "faint");
            const beta = agents.Beta === "run" ? p(`●Beta${betaSal}`, "purple", "b") : p(`○Beta${betaSal}`, "faint");
            const prog = agents.Programmer === "run" ? p(`●Gamma${progSal}`, "green", "b") : p(`○Gamma${progSal}`, "faint");
            const delta = agents.Delta === "run" ? p(`●Delta${deltaSal}`, "amber", "b") : p(`○Delta${deltaSal}`, "faint");
            const echo = agents.Echo === "run" ? p(`●Echo${echoSal}`, "pink", "b") : p(`○Echo${echoSal}`, "faint");
            const zeta = agents.Zeta === "run" ? p(`●Zeta${zetaSal}`, "blue", "b") : p(`○Zeta${zetaSal}`, "faint");

            const errs = findings > 0 ? p(` ${findings}🔴`, "amber") : "";
            process.stdout.write(`\r  ${A.blue}${A.b}${spin[frame]}${A.r} ${p(phase.slice(0, 40), "text")} [${alpha} ${beta} ${prog} ${delta} ${echo} ${zeta}]${errs}   `);
        }, 80);
    };

    const stop = () => { if (timer) clearInterval(timer); process.stdout.write("\r\x1b[2K"); };

    const streamText = async (prefix, text, speed = 8) => {
        stop();
        process.stdout.write(prefix);
        const chars = [...text];
        for (const char of chars) {
            process.stdout.write(char);
            await new Promise(r => setTimeout(r, speed));
        }
        process.stdout.write("\n");
        start();
    };

    const processQueue = async () => {
        if (isProcessing) return;
        isProcessing = true;
        while (queue.length > 0) {
            const action = queue.shift();
            await action();
            await new Promise(r => setTimeout(r, 50));
        }
        isProcessing = false;
    };

    const enqueue = (action) => {
        queue.push(action);
        processQueue();
    };

    return {
        start, stop,
        async flush() {
            while (isProcessing || queue.length > 0) {
                await new Promise(r => setTimeout(r, 100));
            }
        },
        handle(e) {
            if (e.type === "leader_plan") {
                enqueue(async () => {
                    stop();
                    console.log(`  ${p("📋", "faint")} ${p("LİDER PLANI", "blue", "b")}`);
                    const lines = (e.plan || "").split("\n");
                    for (const line of lines) {
                        await streamText(`  ${p("│", "faint")} `, p(line, "text"), 4);
                    }
                    console.log(`  ${p("╰", "faint")}${"─".repeat(60)}\n`);
                    start();
                });
            } else if (e.type === "salary_update") {
                salaries[e.worker] = e.salary;
            } else if (e.type === "agent_chat") {
                enqueue(async () => {
                    const fColorMatch = { Lider: "blue", Alpha: "cyan", Beta: "purple", Programmer: "green", Delta: "amber", Echo: "pink", Zeta: "blue" };
                    const fC = fColorMatch[e.from] || "muted";
                    const tC = fColorMatch[e.to] || "muted";
                    const toStr = e.to && e.to !== "all" ? p(" → " + e.to, tC) : "";
                    const isHackerScript = e.text && e.text.includes("[=== HACKER SCRIPT ===]");
                    if (isHackerScript) {
                        stop();
                        console.log(`\n  ${p("💻", "cyan")} ${p(e.from, fC, "b")}${toStr}:`);
                        const lines = e.text.split("\n");
                        for (const line of lines) {
                            if (line.includes("HACKER") || line.includes("EOF")) {
                                console.log(`    ${p(line, "amber", "b")}`);
                            } else if (line.startsWith("🔧") || line.startsWith("📦")) {
                                console.log(`    ${p(line, "cyan")}`);
                            } else {
                                console.log(`    ${p(line, "green")}`);
                            }
                        }
                        console.log("");
                        start();
                    } else {
                        const prefix = `  ${p("💬", "faint")} ${p(e.from, fC, "b")}${toStr}: `;
                        await streamText(prefix, p(e.text || "", "text"), 10);
                    }
                });
            } else if (e.type === "worker_log") {
                agents[e.worker] = "run";
                phase = `[${e.worker}] ${String(e.message || "").slice(0, 50)}`;
            } else if (e.type === "task_start") {
                agents[e.worker] = "run";
                phase = `[${e.worker}] ${e.label}`;
            } else if (e.type === "critical_alert") {
                enqueue(async () => {
                    stop();
                    console.log(`\n  ${p("🚨 KRİTİK UYARI!", "CRITICAL", "b")} ${p(e.url?.slice(0, 50), "muted")}`);
                    (e.findings || []).forEach(f => {
                        findings++;
                        console.log(`  ${p("►", "CRITICAL")} ${p(f.type, "b")} ${p(`[${f.severity}]`, A[f.severity] || "CRITICAL")}`);
                    });
                    console.log("");
                    start();
                });
            }
        }
    };
}

export async function runBossChat({ url, provider, options, toolRegistry }) {
    console.log(`\n  ${p("👔", "amber")} ${p("PATRON BAĞLANDI (Boss Mode)", "amber", "b")}`);
    console.log(`  ${p("Lider ile tarama şablonunu belirlemek için konuşabilirsiniz.", "muted")}`);
    console.log(`  ${p("Taramayı başlatmak için", "faint")} ${p('"başla"', "green", "b")}, ${p('"onaylıyorum"', "green", "b")} ${p("veya", "faint")} ${p('"start"', "green", "b")} ${p("yazın.", "faint")}\n`);

    const rl = readline.createInterface({ input, output });
    let bossContext = [];
    let allInstructions = options.instruction ? [options.instruction] : [];

    const streamText = async (prefix, text, speed = 10) => {
        process.stdout.write(prefix);
        const chars = [...text];
        for (const char of chars) {
            process.stdout.write(char);
            await new Promise(r => setTimeout(r, speed));
        }
        process.stdout.write("\n");
    };

    while (true) {
        const answer = await rl.question(`  ${p("Siz (Patron): ", "amber", "b")}`);
        const userText = answer.trim().toLowerCase();

        if (userText === "başla" || userText === "start" || userText === "onaylıyorum" || userText === "yapmaya başla" || userText === "başlayın") {
            await streamText(`  ${p("💬", "faint")} ${p("Lider", "blue", "b")} → ${p("Patron", "amber", "dim")}: `, p("Emredersiniz patron. Operasyonu hemen başlatıyorum.", "text"));
            break;
        }

        if (userText) {
            allInstructions.push(userText);
            bossContext.push({ role: "user", content: `Patron'un yeni talimatı: "${userText}"` });

            if (provider) {
                let autonomousSteps = 0;
                while (autonomousSteps < 15) {
                    try {
                        const ans = await provider.complete({
                            systemPrompt: `Sen Kaesra siber güvenlik takımının "Lider"ısın. Kullanıcı (Patron) sana hedefler gösterir. Hedef (${url}) üzerinde araştırma yapmak için Chrome eklentisini otonom olarak kullanmalısın.

### TEMEL ÇALIŞMA PROTOKOLÜ:
1. SADECE GEÇERLİ BİR JSON YANITI VER (Eksik veya hatalı karakter içermemeli).
2. Araştırma BİTMEDEN Patron'a geri dönme. JS Çalıştır -> Çıktıyı Oku -> Yeni JS Çalıştır döngüsüyle DERİNLERE İN.
3. KENDİ KENDİNE "Sistem beni engelledi", "JS desteklenmiyor" gibi sahte bahaneler uydurma (Halüsinasyon yasak!). Sistem sana gerçek HTML çıktısı verecektir. Çıktı boşsa, taktik değiştir.

### MODERN WEB (React/Vue/Next) TAKTİKLERİ:
ReelShort gibi siteler kaynak kodda direkt <video src="..."> tutmazlar. DOM okumak yerine arka planı hedefini al:
- State'leri Çal: "return JSON.stringify(window.__NEXT_DATA__ || window.__NUXT__)"
- Depoları Boşalt: "return JSON.stringify({...localStorage, ...sessionStorage})"
- API Ağını Dinle: "return Array.from(performance.getEntriesByType('resource')).filter(r=>r.name.includes('api')).map(r=>r.name)"
- Medya Kaynakları: "return Array.from(document.querySelectorAll('iframe, video, source')).map(e => e.src)"

### ÇIKTI FORMATLARI (ZORUNLU JSON):
Aksiyon Modu (Araştırmaya Devam): 
{"reply": "LocalStorage depolarını yokluyorum patron...", "action": {"type": "script", "target": "return JSON.stringify({...localStorage})"}}

Aksiyon Modu 2 (Yeniden Sayfa Gez):
{"reply": "Dizi sayfasına geçiyorum...", "action": {"type": "navigate", "target": "https://reelshort.com/series/123"}}

Rapor Modu (İş Bitti, Taktik Patron'a Sunulur):
{"reply": "Patron, incelemeyi tamamladım. Diziler API üzerinden gizli bir tokenle çekiliyor, token localStorage'da [xyz] anahtarında. Taktik olarak bu tokeni kopyalayıp sahte istek atabiliriz.", "action": {"type": "finish", "target": ""}}`,
                            messages: bossContext.slice(-8),
                            temperature: 0.6, maxTokens: 5000
                        });

                        const match = String(ans).match(/\{[\s\S]*\}/);
                        if (match) {
                            const parsed = JSON.parse(match[0]);
                            const reply = parsed.reply || "İşleme devam ediyorum...";
                            bossContext.push({ role: "assistant", content: reply });

                            // Only stream the reply if it's meant for the Boss (and not empty)
                            if (parsed.reply) {
                                await streamText(`  ${p("💬", "faint")} ${p("Lider", "blue", "b")} → ${p("Patron", "amber", "dim")}: `, p(reply, "text"));
                            }

                            if (parsed.action && toolRegistry) {
                                autonomousSteps++;
                                if (parsed.action.type === "navigate") {
                                    await streamText(`  ${p("🔧", "faint")} ${p("[Chrome Live]", "cyan")} `, p(`Sayfaya gidiliyor: ${parsed.action.target}`, "faint"), 5);
                                    try {
                                        await toolRegistry.execute("chrome_live", { action: "navigate", url: parsed.action.target });
                                        await new Promise(r => setTimeout(r, 2000)); // Sayfanın yüklenmesi için bekle
                                        bossContext.push({ role: "user", content: `(Araç Çıktısı) Navigate to ${parsed.action.target} - Success. Sırada ne yapacaksın? Lütfen yeni bir JSON 'action' üret.` });
                                    } catch (e) {
                                        bossContext.push({ role: "user", content: `(Araç Hatası): ${e.message}` });
                                    }
                                } else if (parsed.action.type === "script") {
                                    await streamText(`  ${p("🔧", "faint")} ${p("[Chrome Live]", "cyan")} `, p(`JS Çağrılıyor: ${parsed.action.target.substring(0, 40)}...`, "faint"), 5);
                                    try {
                                        await new Promise(r => setTimeout(r, 1000)); // JS öncesi küçük bekleme
                                        const jsRes = await toolRegistry.execute("chrome_live", { action: "executeJs", script: parsed.action.target });
                                        const resStr = JSON.stringify(jsRes).slice(0, 800);
                                        bossContext.push({ role: "user", content: `(Araç Çıktısı): ${resStr}\n\nLütfen bu sonucu analiz et ve sıradaki hedefine göre yeni bir JSON eylemi (navigate, script veya araştırma bittiyse finish) üret.` });
                                        await streamText(`  ${p("➤", "cyan")} ${p("Sonuç: ", "muted")}`, p(resStr.substring(0, 100) + (resStr.length > 100 ? "..." : ""), "text"), 5);
                                    } catch (e) {
                                        bossContext.push({ role: "user", content: `(Araç Hatası): ${e.message}` });
                                    }
                                } else if (parsed.action.type === "finish") {
                                    break; // Lider explicitly ended their thought loop
                                } else {
                                    // LLM outputted an action type that doesn't exist (e.g. "analyze"). Let it auto-correct.
                                    bossContext.push({ role: "user", content: `HATA: "${parsed.action.type}" geçerli bir eylem değil. Sadece "navigate", "script" veya "finish" tiplerini kullanabilirsin.` });
                                }
                            } else {
                                break; // No action needed, wait for boss input again
                            }
                        } else {
                            // LLM didn't return JSON. Inject reminder and loop again.
                            bossContext.push({ role: "user", content: "LÜTFEN SADECE JSON FORMATINDA YANIT VER. Eylem yoksa 'action' gönderme." });
                            autonomousSteps++;
                        }
                    } catch (err) {
                        bossContext.push({ role: "user", content: `(Sistem Hatası): Yapay zeka sağlayıcısına bağlanırken hata oluştu (${err.message}). Lütfen tekrar dene.` });
                        await streamText(`  ${p("💬", "faint")} ${p("Lider", "blue", "b")} → ${p("Patron", "amber", "dim")}: `, p("Anlaşıldı patron.", "text"));
                        break;
                    }
                }
            } else {
                await streamText(`  ${p("💬", "faint")} ${p("Lider", "blue", "b")} → ${p("Patron", "amber", "dim")}: `, p("Anlaşıldı patron.", "text"));
            }
        }
    }

    rl.close();
    console.log(`  ${p("╰", "faint")}${"─".repeat(60)}\n`);

    return allInstructions.join(" | ");
}

export async function runScanCommand({ url, provider, toolRegistry, options = {} }) {
    if (!url) throw new Error("URL gerekli: kaesra scan <url>");
    let targetUrl = url;
    if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;

    banner(targetUrl);

    // Run interactive boss chat before scan initialization
    const aggregatedInstruction = await runBossChat({ url: targetUrl, provider, options, toolRegistry });
    if (aggregatedInstruction) options.instruction = aggregatedInstruction;
    const handler = makeHandler();

    const orchestrator = new OrchestratorAgent({
        provider,
        toolRegistry,
        onEvent: e => handler.handle(e)
    });

    handler.start();
    let result;
    try {
        result = await orchestrator.scan(targetUrl, options);
    } catch (err) {
        await handler.flush();
        handler.stop();
        console.log(`\n  ${p("✕ Hata:", "red", "b")} ${p(err.message, "red")}\n`);
        return;
    }

    await handler.flush();
    handler.stop();

    console.log(`\n  ${p("✓", "green", "b")} Tarama başarıyla sona erdi! Bulgu sayısı: ${result.findings?.length || 0}`);
}
