import crypto from "node:crypto";

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export class ChromeCommandBus {
  constructor() {
    this.queue = [];
    this.pending = new Map();
    this.waiters = [];
    this.lastPollAt = null;
    this.lastResultAt = null;
  }

  request({ action, input }, timeoutMs = 30000) {
    const timeout = clamp(timeoutMs, 1000, 180000, 30000);

    if (!action || typeof action !== "string") {
      throw new Error("chrome command action is required");
    }

    const command = {
      id: crypto.randomUUID(),
      action: String(action).trim(),
      input: input && typeof input === "object" ? input : {},
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const pending = this.pending.get(command.id);
        if (!pending) {
          return;
        }

        this.pending.delete(command.id);
        this.queue = this.queue.filter((item) => item.id !== command.id);

        reject(
          new Error(
            `Chrome command timed out after ${timeout}ms. Check extension is loaded and bridge URL/token are correct.`
          )
        );
      }, timeout);

      this.pending.set(command.id, {
        resolve,
        reject,
        timeoutId,
        command,
        deliveredAt: null
      });

      this.queue.push(command);
      this.flushWaiter();
    });
  }

  async poll(waitMs = 25000) {
    const timeout = clamp(waitMs, 1000, 60000, 25000);

    if (this.queue.length > 0) {
      const command = this.queue.shift();
      this.markDelivered(command.id);
      return command;
    }

    return new Promise((resolve) => {
      const onCommand = (command) => {
        cleanup();
        resolve(command);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
        const index = this.waiters.indexOf(onCommand);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
      };

      this.waiters.push(onCommand);
    });
  }

  submitResult({ commandId, ok = true, result, error }) {
    if (!commandId || typeof commandId !== "string") {
      throw new Error("commandId is required");
    }

    const pending = this.pending.get(commandId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeoutId);
    this.pending.delete(commandId);

    this.lastResultAt = new Date().toISOString();

    if (ok) {
      pending.resolve(result);
      return true;
    }

    pending.reject(new Error(String(error || "Chrome command execution failed")));
    return true;
  }

  status() {
    const nowMs = Date.now();
    const lastPollMs = this.lastPollAt ? Date.parse(this.lastPollAt) : NaN;
    const extensionConnected = Number.isFinite(lastPollMs) && nowMs - lastPollMs < 45000;

    return {
      queuedCount: this.queue.length,
      pendingCount: this.pending.size,
      lastPollAt: this.lastPollAt,
      lastResultAt: this.lastResultAt,
      extensionConnected
    };
  }

  flushWaiter() {
    if (this.waiters.length === 0 || this.queue.length === 0) {
      return;
    }

    const waiter = this.waiters.shift();
    const command = this.queue.shift();
    this.markDelivered(command.id);
    waiter(command);
  }

  markDelivered(commandId) {
    const pending = this.pending.get(commandId);
    if (!pending) {
      return;
    }

    pending.deliveredAt = new Date().toISOString();
    this.lastPollAt = pending.deliveredAt;
  }
}
