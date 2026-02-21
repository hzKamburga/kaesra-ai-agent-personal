/**
 * Kaesra Agent Message Bus
 * Agent'lar arası iletişim protokolü — pub/sub + direkt mesajlaşma
 */

import EventEmitter from "node:events";

// ─── Mesaj Tipleri ────────────────────────────────────────────────
export const MsgType = {
    // Worker → Lider
    REPORT: "REPORT",           // Görev tamamlandı raporu
    DISCOVERY: "DISCOVERY",     // Yeni hedef/endpoint/subdomain bulundu
    ALERT: "ALERT",             // Kritik zafiyet — acil bildirim
    QUESTION: "QUESTION",       // Worker lidere soru soruyor
    STATUS: "STATUS",           // Worker durumu güncellendi

    // Lider → Worker
    DIRECTIVE: "DIRECTIVE",     // Yeni görev verildi
    RESPONSE: "RESPONSE",       // Worker sorusuna cevap
    PRIORITY: "PRIORITY",       // Öncelik değişikliği
    ABORT: "ABORT",             // Görevi iptal et

    // Çift yönlü
    CHAT: "CHAT",               // Bilgi paylaşımı / sohbet
    BROADCAST: "BROADCAST"      // Herkese yayın
};

// ─── Message Bus ─────────────────────────────────────────────────
export class AgentMessageBus extends EventEmitter {
    constructor() {
        super();
        this.messages = [];           // Tüm mesajlar (log için)
        this.inboxes = new Map();     // agentId → mesaj kuyruğu
        this.agents = new Set();
        this.counter = 0;
    }

    register(agentId) {
        this.agents.add(agentId);
        this.inboxes.set(agentId, []);
    }

    send({ from, to, type, payload, urgent = false }) {
        const msg = {
            id: ++this.counter,
            from,
            to,         // null = broadcast
            type,
            payload,
            urgent,
            timestamp: Date.now(),
            read: false
        };

        this.messages.push(msg);

        // Inbox'a ekle
        if (to) {
            const inbox = this.inboxes.get(to);
            if (inbox) inbox.push(msg);
        } else {
            // Broadcast — herkese gönder
            for (const [agentId, inbox] of this.inboxes.entries()) {
                if (agentId !== from) inbox.push(msg);
            }
        }

        this.emit("message", msg);
        if (urgent) this.emit("urgent", msg);
        return msg.id;
    }

    readInbox(agentId) {
        const inbox = this.inboxes.get(agentId) || [];
        const unread = inbox.filter(m => !m.read);
        unread.forEach(m => { m.read = true; });
        return unread;
    }

    peekInbox(agentId) {
        return (this.inboxes.get(agentId) || []).filter(m => !m.read);
    }

    getHistory(limit = 50) {
        return this.messages.slice(-limit);
    }

    getConversation(agent1, agent2) {
        return this.messages.filter(m =>
            (m.from === agent1 && m.to === agent2) ||
            (m.from === agent2 && m.to === agent1) ||
            (m.to === null && (m.from === agent1 || m.from === agent2))
        );
    }
}

// ─── Task Queue (geliştirilmiş) ───────────────────────────────────
export const TaskStatus = {
    PENDING: "pending",
    RUNNING: "running",
    DONE: "done",
    FAILED: "failed",
    CANCELLED: "cancelled"
};

export const TaskType = {
    CRAWL: "crawl",
    PROBE: "probe",
    CHUNK_SCAN: "chunk_scan",
    ANALYZE: "analyze",
    SUBDOMAIN_ENUM: "subdomain_enum",
    ENDPOINT_DISCOVER: "endpoint_discover",
    NETWORK_MAP: "network_map",
    DEEP_SCAN: "deep_scan",
    EXTRACT: "extract",
    PROGRAM: "program",
    EXECUTE_JS: "execute_js"
};

export class TaskQueue extends EventEmitter {
    constructor() {
        super();
        this.tasks = new Map();
        this.pending = [];
        this.results = new Map();
        this.counter = 0;
        this.paused = false;
    }

    add({ type, payload, priority = 5, parentId = null, label = "", assignTo = null }) {
        const id = `T${String(++this.counter).padStart(3, "0")}`;
        const task = {
            id, type, payload, priority, parentId, label: label || `${type}#${this.counter}`,
            status: TaskStatus.PENDING, createdAt: Date.now(),
            startedAt: null, finishedAt: null, workerId: null, assignTo
        };
        this.tasks.set(id, task);
        this.pending.push(id);
        this._sortPending();
        this.emit("added", task);
        return id;
    }

    _sortPending() {
        this.pending.sort((a, b) => {
            const ta = this.tasks.get(a);
            const tb = this.tasks.get(b);
            return (tb?.priority || 0) - (ta?.priority || 0);
        });
    }

    claim(workerId) {
        if (this.paused) return null;
        // Prefer tasks assigned to this worker
        const assignedIdx = this.pending.findIndex(id => {
            const t = this.tasks.get(id);
            return t?.assignTo === workerId || !t?.assignTo;
        });
        if (assignedIdx === -1) return null;
        const id = this.pending.splice(assignedIdx, 1)[0];
        const task = this.tasks.get(id);
        if (!task) return null;
        task.status = TaskStatus.RUNNING;
        task.startedAt = Date.now();
        task.workerId = workerId;
        this.emit("started", { taskId: id, workerId });
        return task;
    }

    complete(id, result) {
        const t = this.tasks.get(id);
        if (!t) return;
        t.status = TaskStatus.DONE;
        t.finishedAt = Date.now();
        this.results.set(id, result);
        this.emit("done", { taskId: id, result });
    }

    fail(id, error) {
        const t = this.tasks.get(id);
        if (!t) return;
        t.status = TaskStatus.FAILED;
        t.finishedAt = Date.now();
        this.results.set(id, { error: String(error) });
        this.emit("failed", { taskId: id, error: String(error) });
    }

    cancel(id) {
        const t = this.tasks.get(id);
        if (!t) return;
        t.status = TaskStatus.CANCELLED;
        const idx = this.pending.indexOf(id);
        if (idx !== -1) this.pending.splice(idx, 1);
        this.emit("cancelled", { taskId: id });
    }

    stats() {
        const all = [...this.tasks.values()];
        return {
            total: all.length,
            pending: this.pending.length,
            running: all.filter(t => t.status === TaskStatus.RUNNING).length,
            done: all.filter(t => t.status === TaskStatus.DONE).length,
            failed: all.filter(t => t.status === TaskStatus.FAILED).length,
            cancelled: all.filter(t => t.status === TaskStatus.CANCELLED).length
        };
    }

    allDone() {
        if (this.pending.length > 0) return false;
        return [...this.tasks.values()].every(t =>
            [TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(t.status)
        );
    }

    results_all() {
        const out = {};
        for (const [id, res] of this.results.entries()) {
            out[id] = { task: this.tasks.get(id), result: res };
        }
        return out;
    }
}

// ─── Yardımcı Fonksiyonlar ────────────────────────────────────────
export function chunkText(text, size = 3000, overlap = 200) {
    const chunks = [];
    let i = 0;
    const str = String(text || "");
    while (i < str.length) {
        chunks.push(str.slice(i, i + size));
        i += size - overlap;
    }
    return chunks;
}

export function extractLinks(text, baseUrl = "") {
    const links = new Set();
    const urlRx = /https?:\/\/[^\s"'<>)\]]+/g;
    const hrefRx = /href=["']([^"'#?][^"']*?)["']/g;
    let m;
    while ((m = urlRx.exec(text)) !== null) links.add(m[0].replace(/[.,;)\]]+$/, ""));
    if (baseUrl) {
        try {
            const base = new URL(baseUrl);
            while ((m = hrefRx.exec(text)) !== null) {
                try {
                    const r = new URL(m[1], base).href;
                    if (r.startsWith(base.origin)) links.add(r);
                } catch { /* */ }
            }
        } catch { /* */ }
    }
    return [...links];
}

export function extractForms(text) {
    const forms = [];
    const formRx = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
    const inputRx = /<input([^>]+)>/gi;
    let fm;
    while ((fm = formRx.exec(text)) !== null) {
        const attr = fm[1], body = fm[2];
        const action = (/action=["']([^"']+)["']/i.exec(attr) || [])[1] || "";
        const method = ((/method=["']([^"']+)["']/i.exec(attr) || [])[1] || "GET").toUpperCase();
        const inputs = [];
        let im;
        while ((im = inputRx.exec(body)) !== null) {
            const n = (/name=["']([^"']+)["']/i.exec(im[1]) || [])[1];
            const t = (/type=["']([^"']+)["']/i.exec(im[1]) || [])[1] || "text";
            if (n) inputs.push({ name: n, type: t });
        }
        forms.push({ action, method, inputs });
    }
    return forms;
}

export const VULN_DB = [
    { name: "SQL Injection", severity: "CRITICAL", signs: ["sql syntax", "mysql_fetch", "ora-0", "microsoft ole", "unclosed quotation", "syntax error in query", "you have an error in your sql"] },
    { name: "XSS Reflected", severity: "HIGH", signs: ["<script>alert", "onerror=alert", "javascript:alert", "><img src=x", "document.cookie"] },
    { name: "Path Traversal", severity: "HIGH", signs: ["../etc/passwd", "/etc/passwd", "root:x:0:0", "c:\\windows\\system32"] },
    { name: "SSRF", severity: "HIGH", signs: ["169.254.169.254", "metadata.internal", "internal.cloudapp", "169.254.170.2"] },
    { name: "RCE/Command Injection", severity: "CRITICAL", signs: ["uid=0(root)", "bin/bash", "command not found", "system32", "/proc/self"] },
    { name: "Info Disclosure", severity: "MEDIUM", signs: ["traceback (most recent", "stack trace:", "unhandled exception", "debug=true", "at line ", "at column "] },
    { name: "Open Redirect", severity: "MEDIUM", signs: ["redirecting to http", "location: http://", "next=http", "url=http", "goto=http"] },
    { name: "Dir Listing", severity: "LOW", signs: ["index of /", "parent directory", "[to parent directory]", "directory listing"] },
    { name: "Default Creds", severity: "HIGH", signs: ["default password", "admin:admin", "admin:password", "password: admin", "test:test"] },
    { name: "Sensitive Files", severity: "HIGH", signs: [".env found", "api_key=", "secret_key=", "aws_access_key_id", "-----begin rsa"] },
    { name: "Version Disclosure", severity: "INFO", signs: ["apache/2.", "nginx/1.", "php/7.", "php/8.", "iis/10.", "express 4.", "server: microsoft-iis"] },
    { name: "CORS Misconfiguration", severity: "MEDIUM", signs: ["access-control-allow-origin: *", "access-control-allow-credentials: true"] },
    { name: "Missing Security Headers", severity: "LOW", signs: [] } // handled separately
];

export function classifyVulns(text, url = "") {
    const lower = (text + " " + url).toLowerCase();
    const findings = [];
    for (const v of VULN_DB) {
        if (!v.signs.length) continue;
        const matched = v.signs.filter(s => lower.includes(s));
        if (matched.length > 0) {
            findings.push({
                type: v.name,
                severity: v.severity,
                url,
                evidence: matched.slice(0, 3),
                confidence: Math.min(95, matched.length * 25 + 20)
            });
        }
    }
    return findings.sort((a, b) => {
        const o = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
        return (o[a.severity] ?? 5) - (o[b.severity] ?? 5);
    });
}

export function checkSecurityHeaders(text) {
    const lower = text.toLowerCase();
    const required = [
        { header: "content-security-policy", name: "CSP", severity: "MEDIUM" },
        { header: "x-frame-options", name: "X-Frame-Options", severity: "MEDIUM" },
        { header: "x-content-type-options", name: "X-Content-Type-Options", severity: "LOW" },
        { header: "strict-transport-security", name: "HSTS", severity: "MEDIUM" },
        { header: "referrer-policy", name: "Referrer-Policy", severity: "LOW" },
        { header: "permissions-policy", name: "Permissions-Policy", severity: "LOW" }
    ];
    const missing = required.filter(r => !lower.includes(r.header));
    return missing;
}
