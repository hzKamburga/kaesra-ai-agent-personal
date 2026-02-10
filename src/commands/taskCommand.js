import { AssistantAgent } from "../agent/assistantAgent.js";
import { createToolRegistry } from "../tools/index.js";
import {
  createTask,
  deleteTask,
  getTaskStorePath,
  listTasks,
  updateTask
} from "../services/taskStore.js";
import { TaskSchedulerDaemon } from "../services/taskScheduler.js";

function normalizeBool(value) {
  if (value === undefined || value === null) {
    return undefined;
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

  return undefined;
}

function buildAgentFactory(provider, storePath) {
  if (!provider) {
    return null;
  }

  const toolRegistry = createToolRegistry({
    provider,
    scheduler: { storePath }
  });

  return () => new AssistantAgent({ provider, toolRegistry, maxSteps: 20 });
}

export async function runTaskCommand({ provider, logger, action, input = {} }) {
  const storePath = getTaskStorePath(input.storePath);

  if (action === "list") {
    return {
      tasks: await listTasks({ storePath })
    };
  }

  if (action === "create") {
    const task = await createTask(
      {
        name: input.name,
        prompt: input.prompt,
        runAt: input.runAt,
        intervalMs: input.intervalMs,
        enabled: normalizeBool(input.enabled)
      },
      { storePath }
    );

    return { task };
  }

  if (action === "update") {
    const task = await updateTask(
      input.id,
      {
        name: input.name,
        prompt: input.prompt,
        runAt: input.runAt,
        intervalMs: input.intervalMs,
        enabled: normalizeBool(input.enabled)
      },
      { storePath }
    );

    return { task };
  }

  if (action === "delete") {
    return {
      deleted: await deleteTask(input.id, { storePath })
    };
  }

  if (action === "run") {
    const agentFactory = buildAgentFactory(provider, storePath);
    if (!agentFactory) {
      throw new Error("AI provider is required for task run action");
    }

    const daemon = new TaskSchedulerDaemon({
      storePath,
      logger,
      tickMs: 60000,
      onExecuteTask: async (task) => {
        const agent = agentFactory();
        const result = await agent.ask(task.prompt);
        return result.message;
      }
    });

    return daemon.runTaskNow(input.id);
  }

  throw new Error(`Unsupported task action: ${action}`);
}
