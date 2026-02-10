import { AssistantAgent } from "../agent/assistantAgent.js";
import { createToolRegistry } from "../tools/index.js";
import { createBridgeServer } from "../services/bridgeServer.js";
import { ChromeCommandBus } from "../services/chromeCommandBus.js";
import { TaskSchedulerDaemon } from "../services/taskScheduler.js";
import { getTaskStorePath } from "../services/taskStore.js";

function buildAgentFactory(provider, toolRegistry) {
  if (!provider) {
    return null;
  }

  return () =>
    new AssistantAgent({
      provider,
      toolRegistry,
      maxSteps: 20
    });
}

export async function runBridgeCommand({ provider, logger, options = {} }) {
  const host = options.host;
  const port = Number(options.port);
  const apiToken = options.apiToken;
  const schedulerEnabled = Boolean(options.scheduler);
  const tickMs = Number(options.tickMs);
  const storePath = getTaskStorePath(options.storePath);

  const schedulerContext = {
    storePath
  };

  const toolRegistry = createToolRegistry({
    provider,
    scheduler: schedulerContext
  });

  const agentFactory = buildAgentFactory(provider, toolRegistry);
  const chromeCommandBus = new ChromeCommandBus();

  let schedulerDaemon = null;

  if (schedulerEnabled) {
    schedulerDaemon = new TaskSchedulerDaemon({
      storePath,
      tickMs,
      logger,
      onExecuteTask: async (task) => {
        if (!agentFactory) {
          throw new Error("AI provider is required to execute scheduled prompts");
        }

        const agent = agentFactory();
        const result = await agent.ask(task.prompt);
        return result.message;
      }
    });

    schedulerDaemon.start();
  }

  const bridgeServer = createBridgeServer({
    host,
    port,
    apiToken,
    logger,
    toolRegistry,
    agentFactory,
    schedulerDaemon,
    storePath,
    chromeCommandBus
  });

  await bridgeServer.start();

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    if (logger?.info) {
      logger.info("Shutting down bridge", { signal });
    }

    schedulerDaemon?.stop();
    await bridgeServer.stop();
  };

  await new Promise((resolve) => {
    const onSignal = async (signal) => {
      await shutdown(signal);
      resolve();
    };

    process.once("SIGINT", () => {
      void onSignal("SIGINT");
    });

    process.once("SIGTERM", () => {
      void onSignal("SIGTERM");
    });
  });
}
