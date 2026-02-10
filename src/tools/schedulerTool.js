import { createTask, deleteTask, listTasks, updateTask } from "../services/taskStore.js";

export async function runSchedulerTask(input = {}, context = {}) {
  const action = input.action || "list";
  const storePath = context?.scheduler?.storePath;

  if (action === "list") {
    return {
      action,
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
        enabled: input.enabled
      },
      { storePath }
    );

    return {
      action,
      task
    };
  }

  if (action === "update") {
    if (!input.id) {
      throw new Error("scheduler update action requires 'id'");
    }

    const task = await updateTask(
      input.id,
      {
        name: input.name,
        prompt: input.prompt,
        runAt: input.runAt,
        intervalMs: input.intervalMs,
        enabled: input.enabled
      },
      { storePath }
    );

    return {
      action,
      task
    };
  }

  if (action === "delete") {
    if (!input.id) {
      throw new Error("scheduler delete action requires 'id'");
    }

    const deleted = await deleteTask(input.id, { storePath });
    return {
      action,
      deleted
    };
  }

  throw new Error(`Unsupported scheduler action: ${action}`);
}

export const schedulerTool = {
  name: "scheduler",
  description:
    "Ajan gorevlerini zamanlar. Input: { action: list|create|update|delete, id?, name?, prompt?, runAt?, intervalMs? }",
  async run(input, context) {
    return runSchedulerTask(input, context);
  }
};
