#!/usr/bin/env node
import { Command } from "commander";
import { config } from "./core/config.js";
import { logger } from "./core/logger.js";
import { createProvider } from "./llm/providerFactory.js";
import { createToolRegistry } from "./tools/index.js";
import { runChatCommand } from "./commands/chatCommand.js";
import { runResearchCommand } from "./commands/researchCommand.js";
import { runBrowseCommand } from "./commands/browseCommand.js";
import { runProjectCommand } from "./commands/projectCommand.js";
import { runApiCommand } from "./commands/apiCommand.js";
import { runChromeCommand } from "./commands/chromeCommand.js";
import { runBridgeCommand } from "./commands/bridgeCommand.js";
import { runTaskCommand } from "./commands/taskCommand.js";
import { runDesktopCommand } from "./commands/desktopCommand.js";
import { runScanCommand } from "./commands/scanCommand.js";

import { runUiCommand } from "./commands/uiCommand.js";
import { runSecurityCommand } from "./commands/securityCommand.js";
import { runReverseCommand } from "./commands/reverseCommand.js";
import { AssistantAgent } from "./agent/assistantAgent.js";
import { startGuiServer } from "./gui/server.js";

const program = new Command();

let cachedProvider;

function getProvider(required = false) {
  if (cachedProvider) {
    return cachedProvider;
  }

  try {
    cachedProvider = createProvider(config);
    return cachedProvider;
  } catch (error) {
    if (required) {
      throw error;
    }

    return null;
  }
}

function parseJsonOption(value, label) {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON. ${error.message}`);
  }
}

function parseBooleanOption(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

async function runWithErrorHandling(fn) {
  try {
    await fn();
  } catch (error) {
    logger.error(error.message || "Unexpected error");
    process.exitCode = 1;
  }
}

program
  .name("kaesra")
  .description("Node.js AI agent: research, browser automation, project generation, API orchestration")
  .version("1.0.0");

program
  .command("chat")
  .description("Interactive chat mode with tool usage")
  .action(() =>
    runWithErrorHandling(async () => {
      const provider = getProvider(true);
      const toolRegistry = createToolRegistry({ provider });
      await runChatCommand({ provider, toolRegistry });
    })
  );

program
  .command("scan <url> [instruction...]")
  .description("Multi-agent güvenlik taraması (Chrome Live, Puppeteer yok)")
  .option("-d, --depth <number>", "Crawl derinliği", "2")
  .option("-p, --max-pages <number>", "Maksimum sayfa sayısı", "10")
  .option("-t, --timeout <seconds>", "Timeout (saniye)", "180")
  .option("-i, --instruction <text>", "Özel tarama talimatı")
  .option("--no-ai", "AI analizini devre dışı bırak")
  .option("--no-sqli", "SQL injection testini atla")
  .option("--no-xss", "XSS testini atla")
  .option("--no-headers", "Header testini atla")
  .action((url, instructionParts, options) =>
    runWithErrorHandling(async () => {
      const provider = getProvider(false);
      const toolRegistry = createToolRegistry({ provider });

      let finalInstruction = options.instruction || null;
      if (!finalInstruction && instructionParts && instructionParts.length > 0) {
        finalInstruction = instructionParts.join(" ");
      }

      await runScanCommand({
        url,
        provider,
        toolRegistry,
        options: {
          depth: Number(options.depth) || 2,
          maxPages: Number(options.maxPages) || 10,
          timeout: Number(options.timeout) || 180,
          instruction: finalInstruction,
          ai: options.ai !== false,
          probeSqli: options.sqli !== false,
          probeXss: options.xss !== false,
          probeHeaders: options.headers !== false
        }
      });
    })
  );


program
  .command("ui")
  .description("Interactive CLI UI dashboard")
  .action(() =>
    runWithErrorHandling(async () => {
      await runUiCommand({
        getProvider,
        logger
      });
    })
  );

program
  .command("gui")
  .description("Start web-based GUI dashboard (open in browser or use with Electron)")
  .option("--host <host>", "server host", "127.0.0.1")
  .option("--port <number>", "server port", "3939")
  .action((options) =>
    runWithErrorHandling(async () => {
      const host = options.host || "127.0.0.1";
      const port = Number(options.port || 3939);
      startGuiServer({ host, port, getProvider, config, logger });
      logger.info(`Dashboard: http://${host}:${port}`);
      logger.info("Tarayıcıda aç veya 'npm run electron' ile masaüstü uygulaması başlat.");
      // Keep process alive
      await new Promise(() => { });
    })
  );

program
  .command("ask <prompt...>")
  .description("Single-turn ask mode with agent tool usage")
  .action((promptParts) =>
    runWithErrorHandling(async () => {
      const provider = getProvider(true);
      const toolRegistry = createToolRegistry({ provider });
      const agent = new AssistantAgent({ provider, toolRegistry, maxSteps: -1 });
      const result = await agent.ask(promptParts.join(" "));
      printResult(result);
    })
  );

program
  .command("research <query...>")
  .description("Run web research")
  .option("-m, --max-results <number>", "maximum result count", "5")
  .option("-s, --summarize", "summarize with selected LLM")
  .action((queryParts, options) =>
    runWithErrorHandling(async () => {
      const provider = options.summarize ? getProvider(true) : getProvider(false);
      const result = await runResearchCommand({
        query: queryParts.join(" "),
        maxResults: Number(options.maxResults),
        summarize: Boolean(options.summarize),
        provider
      });
      printResult(result);
    })
  );

program
  .command("browse")
  .description("Browser automation: search | extract | screenshot")
  .requiredOption("-a, --action <type>", "search | extract | screenshot")
  .option("-q, --query <query>", "search query")
  .option("-u, --url <url>", "target url")
  .option("-l, --limit <number>", "search result limit", "5")
  .option("-o, --output-path <path>", "output file path for screenshot")
  .option("-p, --profile-dir <path>", "Chrome user data dir")
  .option("--headless", "run browser headless")
  .option("--max-chars <number>", "max chars for extract", "4000")
  .action((options) =>
    runWithErrorHandling(async () => {
      const result = await runBrowseCommand({
        action: options.action,
        query: options.query,
        url: options.url,
        limit: Number(options.limit),
        outputPath: options.outputPath,
        profileDir: options.profileDir,
        headless: options.headless,
        maxChars: Number(options.maxChars)
      });
      printResult(result);
    })
  );

const projectCommand = program.command("project").description("Project creation and scaffolding");

projectCommand
  .command("templates")
  .description("List available local templates")
  .action(() =>
    runWithErrorHandling(async () => {
      const result = await runProjectCommand({ mode: "list" });
      printResult(result);
    })
  );

projectCommand
  .command("scaffold <template> <name>")
  .description("Create a project from template")
  .option("-d, --description <text>", "project description")
  .option("-t, --target-dir <path>", "base target directory", ".")
  .option("--overwrite", "overwrite existing target")
  .action((template, name, options) =>
    runWithErrorHandling(async () => {
      const result = await runProjectCommand({
        mode: "scaffold",
        template,
        name,
        description: options.description,
        targetDir: options.targetDir,
        overwrite: Boolean(options.overwrite)
      });
      printResult(result);
    })
  );

projectCommand
  .command("generate <name> <prompt...>")
  .description("Generate project files with AI")
  .option("-t, --target-dir <path>", "base target directory", ".")
  .option("-f, --max-files <number>", "max generated file count", "12")
  .option("--overwrite", "overwrite existing target")
  .action((name, promptParts, options) =>
    runWithErrorHandling(async () => {
      const provider = getProvider(true);
      const result = await runProjectCommand(
        {
          mode: "generate",
          name,
          prompt: promptParts.join(" "),
          targetDir: options.targetDir,
          maxFiles: Number(options.maxFiles),
          overwrite: Boolean(options.overwrite)
        },
        { provider }
      );
      printResult(result);
    })
  );

projectCommand
  .command("link [projectPath]")
  .description("Run npm link for a project and optionally link it into another project")
  .option("--package-name <name>", "package name override for npm link <name>")
  .option("--link-to <path>", "consumer project path for npm link <package-name>")
  .option("--no-global", "skip npm link in source project")
  .action((projectPath, options) =>
    runWithErrorHandling(async () => {
      const result = await runProjectCommand({
        mode: "link",
        projectPath: projectPath || process.cwd(),
        packageName: options.packageName,
        linkTo: options.linkTo,
        global: Boolean(options.global)
      });
      printResult(result);
    })
  );

program
  .command("api <method> <url>")
  .description("Call any HTTP API")
  .option("-H, --headers <json>", "request headers as JSON")
  .option("-b, --body <jsonOrText>", "request body as JSON or string")
  .option("--timeout-ms <number>", "request timeout milliseconds", "30000")
  .action((method, url, options) =>
    runWithErrorHandling(async () => {
      const headers = parseJsonOption(options.headers, "headers");
      let body;
      if (options.body) {
        try {
          body = JSON.parse(options.body);
        } catch {
          body = options.body;
        }
      }

      const result = await runApiCommand({
        method,
        url,
        headers,
        body,
        timeoutMs: Number(options.timeoutMs)
      });
      printResult(result);
    })
  );

const chromeCommand = program.command("chrome").description("Control real Chrome tab via extension bridge");

chromeCommand
  .command("status")
  .description("Show Chrome extension bridge status")
  .action(() =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "status"
      });
      printResult(result);
    })
  );

chromeCommand
  .command("send <action>")
  .description("Send generic action to Chrome extension")
  .option("-i, --input <json>", "JSON payload for action input")
  .option("--timeout-ms <number>", "timeout milliseconds", "30000")
  .action((action, options) =>
    runWithErrorHandling(async () => {
      const payload = options.input ? parseJsonOption(options.input, "input") : {};
      if (payload && typeof payload !== "object") {
        throw new Error("input must be a JSON object");
      }

      const result = await runChromeCommand({
        action,
        ...(payload || {}),
        timeoutMs: Number(options.timeoutMs)
      });
      printResult(result);
    })
  );

chromeCommand
  .command("navigate <url>")
  .description("Navigate active tab to URL")
  .action((url) =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "navigateActive",
        url
      });
      printResult(result);
    })
  );

chromeCommand
  .command("open <url>")
  .description("Open URL in new tab")
  .option("--background", "open in background tab")
  .action((url, options) =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "openTab",
        url,
        active: !Boolean(options.background)
      });
      printResult(result);
    })
  );

chromeCommand
  .command("active")
  .description("Get active tab info")
  .action(() =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "getActiveTab"
      });
      printResult(result);
    })
  );

chromeCommand
  .command("tabs")
  .description("List tabs in current window")
  .action(() =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "listTabs",
        currentWindow: true
      });
      printResult(result);
    })
  );

chromeCommand
  .command("extract")
  .description("Extract active tab text")
  .option("--max-chars <number>", "max chars", "6000")
  .action((options) =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "extractActiveText",
        maxChars: Number(options.maxChars)
      });
      printResult(result);
    })
  );

chromeCommand
  .command("scroll")
  .description("Scroll active tab")
  .option("--direction <dir>", "down | up", "down")
  .option("--amount <number>", "scroll amount in px", "900")
  .action((options) =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "scrollPage",
        direction: options.direction,
        amount: Number(options.amount)
      });
      printResult(result);
    })
  );

chromeCommand
  .command("click-text <text...>")
  .description("Click a link/button containing text on active tab")
  .option("--exact", "exact text match")
  .action((textParts, options) =>
    runWithErrorHandling(async () => {
      const result = await runChromeCommand({
        action: "clickText",
        text: textParts.join(" "),
        exact: Boolean(options.exact)
      });
      printResult(result);
    })
  );

const desktopCommand = program.command("desktop").description("Desktop application manager");

desktopCommand
  .command("apps")
  .description("List known apps or full installed apps")
  .option("--installed", "list installed apps from OS inventory")
  .option("--query <text>", "filter by app name/id")
  .option("--limit <number>", "max items to return", "200")
  .option("--refresh", "refresh cached OS app inventory before listing")
  .option("--no-deep-scan", "disable deep app search fallback")
  .action((options) =>
    runWithErrorHandling(async () => {
      const result = await runDesktopCommand({
        action: options.installed ? "installed" : "apps",
        query: options.query,
        limit: Number(options.limit),
        refresh: Boolean(options.refresh),
        deepScan: Boolean(options.deepScan)
      });
      printResult(result);
    })
  );

desktopCommand
  .command("open [target]")
  .description("Open app by target, or by installed app id/appName/appId")
  .option("--id <id>", "installed app id")
  .option("--app-name <name>", "installed app name")
  .option("--app-id <appId>", "Windows AppID")
  .option("--args <jsonArray>", "args as JSON array, e.g. [\"--incognito\"]")
  .option("--refresh", "refresh installed-app inventory before matching")
  .option("--no-deep-scan", "disable deep app search fallback")
  .action((target, options) =>
    runWithErrorHandling(async () => {
      const args = options.args ? parseJsonOption(options.args, "args") : undefined;
      if (args !== undefined && !Array.isArray(args)) {
        throw new Error("args must be a JSON array");
      }
      const result = await runDesktopCommand({
        action: "open",
        target,
        id: options.id,
        appName: options.appName,
        appId: options.appId,
        args,
        refresh: Boolean(options.refresh),
        deepScan: Boolean(options.deepScan)
      });
      printResult(result);
    })
  );

desktopCommand
  .command("shell <command...>")
  .description("Run shell command (requires DESKTOP_ALLOW_SHELL=true)")
  .option("--timeout-ms <number>", "timeout milliseconds", "30000")
  .action((commandParts, options) =>
    runWithErrorHandling(async () => {
      const result = await runDesktopCommand({
        action: "shell",
        command: commandParts.join(" "),
        timeoutMs: Number(options.timeoutMs)
      });
      printResult(result);
    })
  );

program
  .command("bridge")
  .description("Start localhost bridge server for Chrome extension and scheduler")
  .option("--host <host>", "bridge host", config.bridge.host)
  .option("--port <number>", "bridge port", String(config.bridge.port))
  .option("--api-token <token>", "optional API token for extension auth", config.bridge.apiToken)
  .option("--no-scheduler", "disable scheduler daemon")
  .option("--tick-ms <number>", "scheduler tick interval milliseconds", String(config.scheduler.tickMs))
  .option("--store-path <path>", "task store path override")
  .action((options) =>
    runWithErrorHandling(async () => {
      await runBridgeCommand({
        provider: getProvider(false),
        logger,
        options: {
          host: options.host || config.bridge.host,
          port: Number(options.port || config.bridge.port),
          apiToken: options.apiToken || config.bridge.apiToken,
          scheduler: Boolean(options.scheduler),
          tickMs: Number(options.tickMs || config.scheduler.tickMs),
          storePath: options.storePath
        }
      });
    })
  );

const taskCommand = program.command("task").description("Manage scheduled agent tasks");

taskCommand
  .command("list")
  .option("--store-path <path>", "task store path override")
  .action((options) =>
    runWithErrorHandling(async () => {
      const result = await runTaskCommand({
        provider: getProvider(false),
        logger,
        action: "list",
        input: {
          storePath: options.storePath
        }
      });

      printResult(result);
    })
  );

taskCommand
  .command("create <name> <prompt...>")
  .description("Create a scheduled task")
  .option("--run-at <isoDate>", "single execution time, e.g. 2026-02-10T09:00:00Z")
  .option("--interval-ms <number>", "repeat interval in milliseconds")
  .option("--enabled <bool>", "true | false", "true")
  .option("--store-path <path>", "task store path override")
  .action((name, promptParts, options) =>
    runWithErrorHandling(async () => {
      const result = await runTaskCommand({
        provider: getProvider(false),
        logger,
        action: "create",
        input: {
          name,
          prompt: promptParts.join(" "),
          runAt: options.runAt,
          intervalMs: options.intervalMs ? Number(options.intervalMs) : undefined,
          enabled: parseBooleanOption(options.enabled, true),
          storePath: options.storePath
        }
      });

      printResult(result);
    })
  );

taskCommand
  .command("update <id>")
  .description("Update a scheduled task")
  .option("--name <name>", "task name")
  .option("--prompt <prompt>", "task prompt")
  .option("--run-at <isoDate>", "single execution time")
  .option("--interval-ms <number>", "repeat interval in milliseconds")
  .option("--enabled <bool>", "true | false")
  .option("--store-path <path>", "task store path override")
  .action((id, options) =>
    runWithErrorHandling(async () => {
      const result = await runTaskCommand({
        provider: getProvider(false),
        logger,
        action: "update",
        input: {
          id,
          name: options.name,
          prompt: options.prompt,
          runAt: options.runAt,
          intervalMs: options.intervalMs ? Number(options.intervalMs) : undefined,
          enabled: parseBooleanOption(options.enabled, undefined),
          storePath: options.storePath
        }
      });

      printResult(result);
    })
  );

taskCommand
  .command("delete <id>")
  .description("Delete a scheduled task")
  .option("--store-path <path>", "task store path override")
  .action((id, options) =>
    runWithErrorHandling(async () => {
      const result = await runTaskCommand({
        provider: getProvider(false),
        logger,
        action: "delete",
        input: {
          id,
          storePath: options.storePath
        }
      });

      printResult(result);
    })
  );

taskCommand
  .command("run <id>")
  .description("Run task now once (AI provider required)")
  .option("--store-path <path>", "task store path override")
  .action((id, options) =>
    runWithErrorHandling(async () => {
      const result = await runTaskCommand({
        provider: getProvider(true),
        logger,
        action: "run",
        input: {
          id,
          storePath: options.storePath
        }
      });

      printResult(result);
    })
  );

program
  .command("tools")
  .description("List tool catalog")
  .action(() =>
    runWithErrorHandling(async () => {
      const provider = getProvider(false);
      const toolRegistry = createToolRegistry({ provider });
      printResult(toolRegistry.list());
    })
  );

program
  .command("reverse <url>")
  .description("Reverse engineer a website using Chrome bridge & AI")
  .option("--filter <text>", "filter chunks by name", "main")
  .option("--list", "list chunks only")
  .action((url, options) =>
    runWithErrorHandling(async () => {
      const provider = getProvider(true);
      const result = await runReverseCommand({
        url,
        provider,
        chunkFilter: options.filter,
        action: options.list ? "list" : "analyze"
      });
      printResult(result);
    })
  );

program
  .command("security <target...>")
  .description("Scan target directory for security vulnerabilities")
  .option("--max-files <number>", "max files to analyze", "20")
  .action((targetParts, options) =>
    runWithErrorHandling(async () => {
      const provider = getProvider(true);
      const result = await runSecurityCommand({
        targetDir: targetParts.join(" ") || ".",
        provider,
        maxFiles: Number(options.maxFiles)
      });
      printResult(result);
    })
  );

if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  await program.parseAsync(process.argv);
}
