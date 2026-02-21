import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AssistantAgent } from "../agent/assistantAgent.js";
import { createToolRegistry } from "../tools/index.js";
import { runResearchCommand } from "../commands/researchCommand.js";
import { runTaskCommand } from "../commands/taskCommand.js";
import { runChromeCommand } from "../commands/chromeCommand.js";
import { runDesktopCommand } from "../commands/desktopCommand.js";

import { runApiCommand } from "../commands/apiCommand.js";
import { runSecurityCommand } from "../commands/securityCommand.js";
import { runReverseCommand } from "../commands/reverseCommand.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf"
};

/* ── Helpers ─────────────────────────────────────────── */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

function sendJson(res, data, status = 200) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(body);
}

function sendError(res, message, status = 500) {
    sendJson(res, { ok: false, error: message }, status);
}

function sendSSE(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function serveStatic(req, res) {
    let filePath = req.url === "/" ? "/index.html" : req.url;
    filePath = filePath.split("?")[0];

    const fullPath = path.join(PUBLIC_DIR, filePath);
    const ext = path.extname(fullPath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    if (!fs.existsSync(fullPath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
    }

    const content = fs.readFileSync(fullPath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
}

/* ── Main Export ─────────────────────────────────────── */
export function startGuiServer({ host = "127.0.0.1", port = 3939, getProvider, config, logger } = {}) {

    // ── Shared agent (persistent chat session) ────────
    let chatAgent = null;

    function getChatAgent() {
        if (chatAgent) return chatAgent;
        const provider = getProvider(true);
        const toolRegistry = createToolRegistry({ provider });
        chatAgent = new AssistantAgent({ provider, toolRegistry, maxSteps: -1 });
        return chatAgent;
    }

    function createFreshAgent(onEvent) {
        const provider = getProvider(true);
        const toolRegistry = createToolRegistry({ provider });
        return new AssistantAgent({ provider, toolRegistry, maxSteps: -1, onEvent });
    }

    // ── Request Router ────────────────────────────────
    async function handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // CORS preflight
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            });
            res.end();
            return;
        }

        // ── API Routes ─────────────────────────────────

        // GET /api/status — provider + model info
        if (pathname === "/api/status" && req.method === "GET") {
            try {
                const provider = getProvider(false);
                sendJson(res, {
                    ok: true,
                    provider: config?.provider || "unknown",
                    model: provider?.model || config?.model || "unknown",
                    ready: Boolean(provider)
                });
            } catch {
                sendJson(res, { ok: true, provider: config?.provider || "unknown", model: config?.model || "unknown", ready: false });
            }
            return;
        }

        // GET /api/tools — tool catalog
        if (pathname === "/api/tools" && req.method === "GET") {
            try {
                const provider = getProvider(false);
                const registry = createToolRegistry({ provider });
                sendJson(res, { ok: true, tools: registry.list() });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // GET /api/tasks — list tasks
        if (pathname === "/api/tasks" && req.method === "GET") {
            try {
                const result = await runTaskCommand({
                    provider: null,
                    logger: logger || console,
                    action: "list",
                    input: {}
                });
                sendJson(res, { ok: true, ...result });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // POST /api/chat — chat with streaming events (SSE)
        if (pathname === "/api/chat" && req.method === "POST") {
            try {
                const body = JSON.parse(await readBody(req));
                const message = String(body.message || "").trim();
                if (!message) {
                    sendError(res, "message is required", 400);
                    return;
                }

                // SSE setup
                res.writeHead(200, {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Origin": "*"
                });

                const agent = getChatAgent();
                // Override onEvent temporarily for this request
                const originalOnEvent = agent.onEvent;
                agent.onEvent = (event) => {
                    if (!event) return;
                    try {
                        if (event.type === "tool_call") {
                            sendSSE(res, "tool_call", { tool: event.tool, input: event.input, step: event.step });
                        } else if (event.type === "tool_result") {
                            const outputStr = typeof event.output === "string" ? event.output : JSON.stringify(event.output || "");
                            sendSSE(res, "tool_result", { tool: event.tool, output: outputStr.slice(0, 200000) });
                        } else if (event.type === "tool_error") {
                            sendSSE(res, "tool_error", { tool: event.tool, error: String(event.error || "") });
                        } else if (event.type === "tool_retry") {
                            sendSSE(res, "tool_retry", { tool: event.tool, step: event.step });
                        }
                    } catch { /* stream might be closed */ }
                };

                try {
                    const result = await agent.ask(message);
                    sendSSE(res, "done", { message: result.message || "", activities: result.activities || [] });
                } catch (err) {
                    sendSSE(res, "error", { error: err.message || "Agent error" });
                } finally {
                    agent.onEvent = originalOnEvent;
                    res.end();
                }
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // POST /api/ask — single-shot ask with streaming events (SSE)
        if (pathname === "/api/ask" && req.method === "POST") {
            try {
                const body = JSON.parse(await readBody(req));
                const message = String(body.message || "").trim();
                if (!message) {
                    sendError(res, "message is required", 400);
                    return;
                }

                res.writeHead(200, {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Origin": "*"
                });

                const agent = createFreshAgent((event) => {
                    if (!event) return;
                    try {
                        if (event.type === "tool_call") {
                            sendSSE(res, "tool_call", { tool: event.tool, input: event.input, step: event.step });
                        } else if (event.type === "tool_result") {
                            const outputStr = typeof event.output === "string" ? event.output : JSON.stringify(event.output || "");
                            sendSSE(res, "tool_result", { tool: event.tool, output: outputStr.slice(0, 200000) });
                        } else if (event.type === "tool_error") {
                            sendSSE(res, "tool_error", { tool: event.tool, error: String(event.error || "") });
                        }
                    } catch { /* stream might be closed */ }
                });

                try {
                    const result = await agent.ask(message);
                    sendSSE(res, "done", { message: result.message || "" });
                } catch (err) {
                    sendSSE(res, "error", { error: err.message || "Agent error" });
                } finally {
                    res.end();
                }
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // POST /api/reset — reset chat memory
        if (pathname === "/api/reset" && req.method === "POST") {
            if (chatAgent) {
                chatAgent.reset();
            }
            chatAgent = null;
            sendJson(res, { ok: true, message: "Chat memory reset" });
            return;
        }

        // POST /api/research — web research
        if (pathname === "/api/research" && req.method === "POST") {
            try {
                const body = JSON.parse(await readBody(req));
                const query = String(body.query || "").trim();
                if (!query) {
                    sendError(res, "query is required", 400);
                    return;
                }
                const maxResults = Number(body.maxResults || 5);
                const summarize = body.summarize !== false;
                const provider = summarize ? getProvider(true) : getProvider(false);
                const result = await runResearchCommand({ query, maxResults, summarize, provider });
                sendJson(res, { ok: true, ...result });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // GET /api/chrome/status — chrome bridge status
        if (pathname === "/api/chrome/status" && req.method === "GET") {
            try {
                const result = await runChromeCommand({ action: "status" });
                sendJson(res, { ok: true, ...result });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // GET /api/desktop/apps — desktop app list
        if (pathname === "/api/desktop/apps" && req.method === "GET") {
            try {
                const limit = Number(url.searchParams.get("limit") || 50);
                const result = await runDesktopCommand({ action: "installed", limit });
                sendJson(res, { ok: true, ...result });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // POST /api/security — security scan
        if (pathname === "/api/security" && req.method === "POST") {
            try {
                const body = JSON.parse(await readBody(req));
                const targetDir = String(body.targetDir || ".").trim();
                const provider = getProvider(true);
                const result = await runSecurityCommand({ targetDir, provider, maxFiles: 20 });
                sendJson(res, { ok: true, report: result });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // POST /api/reverse — website reverse engineering
        if (pathname === "/api/reverse" && req.method === "POST") {
            try {
                const body = JSON.parse(await readBody(req));
                const url = String(body.url || "").trim();
                const provider = getProvider(true);
                const result = await runReverseCommand({ url, provider, chunkFilter: body.filter, action: body.action || "analyze" });
                sendJson(res, { ok: true, ...result });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // POST /api/api-call — proxy API call
        if (pathname === "/api/api-call" && req.method === "POST") {
            try {
                const body = JSON.parse(await readBody(req));
                const result = await runApiCommand({
                    method: body.method || "GET",
                    url: body.url,
                    headers: body.headers,
                    body: body.body,
                    timeoutMs: Number(body.timeoutMs || 30000)
                });
                sendJson(res, { ok: true, ...result });
            } catch (err) {
                sendError(res, err.message);
            }
            return;
        }

        // ── Static Files (fallback) ─────────────────────
        serveStatic(req, res);
    }

    const server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
            console.error("[GUI] Unhandled error:", err);
            if (!res.headersSent) {
                sendError(res, "Internal Server Error");
            }
        });
    });

    server.listen(port, host, () => {
        console.log(`[GUI] Server running at http://${host}:${port}`);
    });

    return server;
}
