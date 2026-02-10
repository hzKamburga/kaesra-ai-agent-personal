import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../core/config.js";

const DEFAULT_STORE_PATH = path.resolve(process.cwd(), "data", "tasks.json");

function sanitizeText(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }

  return text;
}

function parseOptionalDate(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid date string`);
  }

  return date.toISOString();
}

function parseOptionalIntervalMs(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const intervalMs = Math.floor(Number(value));
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    throw new Error("intervalMs must be a number >= 1000");
  }

  return intervalMs;
}

function parseOptionalBool(value, fallback) {
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

export function getTaskStorePath(overridePath) {
  const configured = overridePath || config.scheduler.storePath;
  if (!configured) {
    return DEFAULT_STORE_PATH;
  }

  return path.resolve(process.cwd(), configured);
}

async function ensureStoreExists(storePath) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify({ tasks: [] }, null, 2), "utf8");
  }
}

async function readStore(storePath) {
  await ensureStoreExists(storePath);

  const raw = await fs.readFile(storePath, "utf8");

  try {
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    return {
      tasks
    };
  } catch {
    return {
      tasks: []
    };
  }
}

async function writeStore(storePath, data) {
  await ensureStoreExists(storePath);
  await fs.writeFile(storePath, JSON.stringify(data, null, 2), "utf8");
}

async function mutateStore(mutator, options = {}) {
  const storePath = getTaskStorePath(options.storePath);
  const store = await readStore(storePath);
  const result = await mutator(store.tasks);
  await writeStore(storePath, store);
  return result;
}

function normalizeTask(task) {
  return {
    ...task,
    intervalMs: task.intervalMs === null || task.intervalMs === undefined ? null : Number(task.intervalMs),
    enabled: Boolean(task.enabled),
    runCount: Number(task.runCount || 0)
  };
}

function nextRunFromSettings(runAt, intervalMs, enabled) {
  if (!enabled) {
    return null;
  }

  if (runAt) {
    return runAt;
  }

  if (intervalMs) {
    return new Date(Date.now() + intervalMs).toISOString();
  }

  return null;
}

export function computeNextRunAfterExecution(task, nowMs = Date.now()) {
  const intervalMs = Number(task.intervalMs || 0);

  if (!intervalMs || intervalMs < 1000) {
    return null;
  }

  const nextFrom = Date.parse(task.nextRunAt || "") || nowMs;
  let nextMs = nextFrom;

  while (nextMs <= nowMs) {
    nextMs += intervalMs;
  }

  return new Date(nextMs).toISOString();
}

export async function listTasks(options = {}) {
  const storePath = getTaskStorePath(options.storePath);
  const store = await readStore(storePath);

  return store.tasks
    .map((task) => normalizeTask(task))
    .sort((a, b) => {
      if (!a.nextRunAt && !b.nextRunAt) {
        return a.createdAt.localeCompare(b.createdAt);
      }

      if (!a.nextRunAt) {
        return 1;
      }

      if (!b.nextRunAt) {
        return -1;
      }

      return a.nextRunAt.localeCompare(b.nextRunAt);
    });
}

export async function getTaskById(id, options = {}) {
  const tasks = await listTasks(options);
  return tasks.find((task) => task.id === id) || null;
}

export async function createTask(input = {}, options = {}) {
  const now = new Date().toISOString();
  const name = sanitizeText(input.name, "name");
  const prompt = sanitizeText(input.prompt, "prompt");
  const runAt = parseOptionalDate(input.runAt, "runAt");
  const intervalMs = parseOptionalIntervalMs(input.intervalMs);
  const enabled = parseOptionalBool(input.enabled, true);
  const nextRunAt = nextRunFromSettings(runAt, intervalMs, enabled);

  return mutateStore(async (tasks) => {
    const task = {
      id: crypto.randomUUID(),
      name,
      prompt,
      runAt,
      intervalMs,
      enabled,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      runCount: 0,
      lastResult: null,
      lastError: null
    };

    tasks.push(task);
    return normalizeTask(task);
  }, options);
}

export async function updateTask(id, patch = {}, options = {}) {
  return mutateStore(async (tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) {
      throw new Error(`Task not found: ${id}`);
    }

    const current = tasks[index];
    const next = { ...current };

    if (patch.name !== undefined) {
      next.name = sanitizeText(patch.name, "name");
    }

    if (patch.prompt !== undefined) {
      next.prompt = sanitizeText(patch.prompt, "prompt");
    }

    if (patch.runAt !== undefined) {
      next.runAt = parseOptionalDate(patch.runAt, "runAt");
    }

    if (patch.intervalMs !== undefined) {
      next.intervalMs = parseOptionalIntervalMs(patch.intervalMs);
    }

    if (patch.enabled !== undefined) {
      next.enabled = parseOptionalBool(patch.enabled, next.enabled);
    }

    if (patch.lastResult !== undefined) {
      next.lastResult = patch.lastResult;
    }

    if (patch.lastError !== undefined) {
      next.lastError = patch.lastError;
    }

    if (patch.lastRunAt !== undefined) {
      next.lastRunAt = parseOptionalDate(patch.lastRunAt, "lastRunAt");
    }

    if (patch.nextRunAt !== undefined) {
      next.nextRunAt = parseOptionalDate(patch.nextRunAt, "nextRunAt");
    }

    if (patch.runCount !== undefined) {
      const runCount = Number(patch.runCount);
      if (Number.isFinite(runCount) && runCount >= 0) {
        next.runCount = Math.floor(runCount);
      }
    }

    const shouldRecomputeNext =
      patch.runAt !== undefined || patch.intervalMs !== undefined || patch.enabled !== undefined;

    if (shouldRecomputeNext) {
      next.nextRunAt = nextRunFromSettings(next.runAt, next.intervalMs, next.enabled);
    }

    next.updatedAt = new Date().toISOString();

    tasks[index] = next;
    return normalizeTask(next);
  }, options);
}

export async function deleteTask(id, options = {}) {
  return mutateStore(async (tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) {
      return false;
    }

    tasks.splice(index, 1);
    return true;
  }, options);
}

export async function listDueTasks(nowMs = Date.now(), options = {}) {
  const tasks = await listTasks(options);

  return tasks.filter((task) => {
    if (!task.enabled || !task.nextRunAt) {
      return false;
    }

    const dueMs = Date.parse(task.nextRunAt);
    if (!Number.isFinite(dueMs)) {
      return false;
    }

    return dueMs <= nowMs;
  });
}
