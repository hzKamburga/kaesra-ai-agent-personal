import {
  computeNextRunAfterExecution,
  getTaskById,
  listDueTasks,
  updateTask
} from "./taskStore.js";

function summarizeValue(value, maxLength = 2000) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...[truncated]`;
}

export class TaskSchedulerDaemon {
  constructor({ storePath, tickMs = 15000, onExecuteTask, logger }) {
    if (typeof onExecuteTask !== "function") {
      throw new Error("TaskSchedulerDaemon requires onExecuteTask callback");
    }

    this.storePath = storePath;
    this.tickMs = Math.max(5000, Number(tickMs) || 15000);
    this.onExecuteTask = onExecuteTask;
    this.logger = logger;
    this.intervalId = null;
    this.runningTick = false;
  }

  isRunning() {
    return Boolean(this.intervalId);
  }

  start() {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.tick().catch((error) => {
        if (this.logger?.error) {
          this.logger.error("Scheduler tick failed", { error: error.message });
        }
      });
    }, this.tickMs);

    this.tick().catch((error) => {
      if (this.logger?.error) {
        this.logger.error("Scheduler initial tick failed", { error: error.message });
      }
    });
  }

  stop() {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  async tick() {
    if (this.runningTick) {
      return;
    }

    this.runningTick = true;

    try {
      const dueTasks = await listDueTasks(Date.now(), { storePath: this.storePath });

      for (const task of dueTasks) {
        await this.executeTask(task.id, { consumeSchedule: true });
      }
    } finally {
      this.runningTick = false;
    }
  }

  async runTaskNow(taskId) {
    return this.executeTask(taskId, { consumeSchedule: false });
  }

  async executeTask(taskId, { consumeSchedule }) {
    const task = await getTaskById(taskId, { storePath: this.storePath });
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const nowMs = Date.now();
    const ranAt = new Date(nowMs).toISOString();

    try {
      const result = await this.onExecuteTask(task);
      const summarized = summarizeValue(result);

      if (consumeSchedule) {
        const nextRunAt = computeNextRunAfterExecution(task, nowMs);

        if (nextRunAt) {
          await updateTask(
            task.id,
            {
              lastRunAt: ranAt,
              lastResult: summarized,
              lastError: null,
              runCount: task.runCount + 1,
              nextRunAt
            },
            { storePath: this.storePath }
          );
        } else {
          await updateTask(
            task.id,
            {
              lastRunAt: ranAt,
              lastResult: summarized,
              lastError: null,
              runCount: task.runCount + 1,
              enabled: false
            },
            { storePath: this.storePath }
          );
        }
      } else {
        await updateTask(
          task.id,
          {
            lastRunAt: ranAt,
            lastResult: summarized,
            lastError: null,
            runCount: task.runCount + 1
          },
          { storePath: this.storePath }
        );
      }

      if (this.logger?.info) {
        this.logger.info("Scheduled task executed", {
          taskId: task.id,
          name: task.name,
          consumeSchedule
        });
      }

      return {
        ok: true,
        taskId: task.id,
        result: summarized
      };
    } catch (error) {
      const summarizedError = summarizeValue(error.message || error);

      if (consumeSchedule) {
        const nextRunAt = computeNextRunAfterExecution(task, nowMs);

        if (nextRunAt) {
          await updateTask(
            task.id,
            {
              lastRunAt: ranAt,
              lastError: summarizedError,
              runCount: task.runCount + 1,
              nextRunAt
            },
            { storePath: this.storePath }
          );
        } else {
          await updateTask(
            task.id,
            {
              lastRunAt: ranAt,
              lastError: summarizedError,
              runCount: task.runCount + 1,
              enabled: false
            },
            { storePath: this.storePath }
          );
        }
      } else {
        await updateTask(
          task.id,
          {
            lastRunAt: ranAt,
            lastError: summarizedError,
            runCount: task.runCount + 1
          },
          { storePath: this.storePath }
        );
      }

      if (this.logger?.error) {
        this.logger.error("Scheduled task failed", {
          taskId: task.id,
          name: task.name,
          error: summarizedError
        });
      }

      throw error;
    }
  }
}
