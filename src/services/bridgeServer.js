import http from "node:http";
import { URL } from "node:url";
import { runDesktopTask } from "../tools/desktopTool.js";
import { createTask, deleteTask, listTasks, updateTask } from "./taskStore.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Agent-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function getTaskRoute(pathname) {
  if (pathname === "/tasks") {
    return { base: true };
  }

  const runMatch = pathname.match(/^\/tasks\/([^/]+)\/run$/);
  if (runMatch) {
    return {
      taskId: decodeURIComponent(runMatch[1]),
      run: true
    };
  }

  const itemMatch = pathname.match(/^\/tasks\/([^/]+)$/);
  if (itemMatch) {
    return {
      taskId: decodeURIComponent(itemMatch[1]),
      run: false
    };
  }

  return null;
}

function isAuthorized(req, expectedToken) {
  if (!expectedToken) {
    return true;
  }

  const incomingToken = req.headers["x-agent-token"];
  return typeof incomingToken === "string" && incomingToken === expectedToken;
}

export function createBridgeServer({
  host,
  port,
  apiToken,
  logger,
  toolRegistry,
  agentFactory,
  schedulerDaemon,
  storePath,
  chromeCommandBus
}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendJson(res, 400, { error: "Invalid request" });
        return;
      }

      if (req.method === "OPTIONS") {
        setCorsHeaders(res);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (!isAuthorized(req, apiToken)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      const parsedUrl = new URL(req.url, `http://${host}:${port}`);
      const pathname = parsedUrl.pathname;

      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          timestamp: new Date().toISOString(),
          schedulerRunning: schedulerDaemon?.isRunning?.() || false
        });
        return;
      }

      if (req.method === "GET" && pathname === "/tools") {
        sendJson(res, 200, { tools: toolRegistry.list() });
        return;
      }

      if (req.method === "POST" && pathname === "/tools/execute") {
        const body = await readJsonBody(req);
        const tool = String(body.tool || "").trim();

        if (!tool) {
          sendJson(res, 400, { error: "tool is required" });
          return;
        }

        const output = await toolRegistry.execute(tool, body.input || {});
        sendJson(res, 200, { ok: true, output });
        return;
      }

      if (req.method === "POST" && pathname === "/agent/ask") {
        const body = await readJsonBody(req);
        const prompt = String(body.prompt || "").trim();

        if (!prompt) {
          sendJson(res, 400, { error: "prompt is required" });
          return;
        }

        if (!agentFactory) {
          sendJson(res, 400, { error: "AI provider is not configured" });
          return;
        }

        const agent = agentFactory();
        const result = await agent.ask(prompt);

        sendJson(res, 200, {
          ok: true,
          result
        });
        return;
      }

      if (req.method === "GET" && pathname === "/chrome/status") {
        if (!chromeCommandBus) {
          sendJson(res, 400, { error: "Chrome command bus is disabled" });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          ...chromeCommandBus.status()
        });
        return;
      }

      if (req.method === "POST" && pathname === "/chrome/commands") {
        if (!chromeCommandBus) {
          sendJson(res, 400, { error: "Chrome command bus is disabled" });
          return;
        }

        const body = await readJsonBody(req);
        const action = String(body.action || "").trim();
        if (!action) {
          sendJson(res, 400, { error: "action is required" });
          return;
        }

        const payload =
          body.input && typeof body.input === "object"
            ? body.input
            : Object.fromEntries(
                Object.entries(body).filter(([key]) => !["action", "timeoutMs"].includes(key))
              );

        const timeoutMs = Number(body.timeoutMs) || 30000;

        try {
          const result = await chromeCommandBus.request(
            {
              action,
              input: payload
            },
            timeoutMs
          );

          sendJson(res, 200, {
            ok: true,
            result
          });
        } catch (error) {
          sendJson(res, 504, {
            ok: false,
            error: error.message || "Chrome command timed out"
          });
        }

        return;
      }

      if (req.method === "GET" && pathname === "/chrome/poll") {
        if (!chromeCommandBus) {
          sendJson(res, 400, { error: "Chrome command bus is disabled" });
          return;
        }

        const waitMs = Number(parsedUrl.searchParams.get("waitMs") || 25000);
        const command = await chromeCommandBus.poll(waitMs);

        sendJson(res, 200, {
          ok: true,
          command
        });
        return;
      }

      if (req.method === "POST" && pathname === "/chrome/results") {
        if (!chromeCommandBus) {
          sendJson(res, 400, { error: "Chrome command bus is disabled" });
          return;
        }

        const body = await readJsonBody(req);
        const accepted = chromeCommandBus.submitResult({
          commandId: body.commandId,
          ok: body.ok !== false,
          result: body.result,
          error: body.error
        });

        sendJson(res, 200, {
          ok: true,
          accepted
        });
        return;
      }

      const taskRoute = getTaskRoute(pathname);
      if (taskRoute) {
        if (req.method === "GET" && taskRoute.base) {
          const tasks = await listTasks({ storePath });
          sendJson(res, 200, { tasks });
          return;
        }

        if (req.method === "POST" && taskRoute.base) {
          const body = await readJsonBody(req);
          const task = await createTask(
            {
              name: body.name,
              prompt: body.prompt,
              runAt: body.runAt,
              intervalMs: body.intervalMs,
              enabled: body.enabled
            },
            { storePath }
          );

          sendJson(res, 201, { task });
          return;
        }

        if (taskRoute.taskId && taskRoute.run && req.method === "POST") {
          if (!schedulerDaemon) {
            sendJson(res, 400, { error: "Scheduler is not enabled" });
            return;
          }

          const output = await schedulerDaemon.runTaskNow(taskRoute.taskId);
          sendJson(res, 200, output);
          return;
        }

        if (taskRoute.taskId && !taskRoute.run && req.method === "PATCH") {
          const body = await readJsonBody(req);
          const task = await updateTask(
            taskRoute.taskId,
            {
              name: body.name,
              prompt: body.prompt,
              runAt: body.runAt,
              intervalMs: body.intervalMs,
              enabled: body.enabled
            },
            { storePath }
          );

          sendJson(res, 200, { task });
          return;
        }

        if (taskRoute.taskId && !taskRoute.run && req.method === "DELETE") {
          const deleted = await deleteTask(taskRoute.taskId, { storePath });
          sendJson(res, 200, { deleted });
          return;
        }
      }

      if (req.method === "POST" && pathname === "/desktop/open") {
        const body = await readJsonBody(req);
        const output = await runDesktopTask({
          action: "open",
          target: body.target,
          args: body.args,
          id: body.id,
          appId: body.appId,
          appName: body.appName,
          refresh: body.refresh,
          deepScan: body.deepScan
        });

        sendJson(res, 200, output);
        return;
      }

      if (req.method === "GET" && pathname === "/desktop/apps") {
        const installedParam = (parsedUrl.searchParams.get("installed") || "").toLowerCase();
        const installed = ["1", "true", "yes", "on"].includes(installedParam);
        const refreshParam = (parsedUrl.searchParams.get("refresh") || "").toLowerCase();
        const refresh = ["1", "true", "yes", "on"].includes(refreshParam);
        const deepScanParam = (parsedUrl.searchParams.get("deepScan") || "").toLowerCase();
        const deepScan = !["0", "false", "no", "off"].includes(deepScanParam);
        const query = parsedUrl.searchParams.get("query") || undefined;
        const limitRaw = parsedUrl.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;

        const output = await runDesktopTask({
          action: installed ? "installed" : "apps",
          query,
          limit,
          refresh,
          deepScan
        });

        sendJson(res, 200, output);
        return;
      }

      if (req.method === "POST" && pathname === "/desktop/open-installed") {
        const body = await readJsonBody(req);
        const output = await runDesktopTask({
          action: "open-installed",
          id: body.id,
          appId: body.appId,
          appName: body.appName,
          args: body.args,
          refresh: body.refresh,
          deepScan: body.deepScan
        });

        sendJson(res, 200, output);
        return;
      }

      if (req.method === "POST" && pathname === "/desktop/shell") {
        const body = await readJsonBody(req);
        const output = await runDesktopTask({
          action: "shell",
          command: body.command,
          timeoutMs: body.timeoutMs
        });

        sendJson(res, 200, output);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      if (logger?.error) {
        logger.error("Bridge request failed", {
          method: req.method,
          url: req.url,
          error: error.message
        });
      }

      sendJson(res, 500, {
        error: error.message || "Unexpected error"
      });
    }
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });

      if (logger?.info) {
        logger.info("Bridge server started", {
          host,
          port
        });
      }
    },
    async stop() {
      await new Promise((resolve) => {
        server.close(() => resolve());
      });

      if (logger?.info) {
        logger.info("Bridge server stopped");
      }
    }
  };
}
