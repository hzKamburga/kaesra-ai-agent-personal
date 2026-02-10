const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const levelName = (process.env.LOG_LEVEL || "info").toLowerCase();
const minimumLevel = LEVELS[levelName] || LEVELS.info;

function shouldLog(level) {
  return LEVELS[level] >= minimumLevel;
}

function formatData(data) {
  if (data === undefined) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function log(level, message, data) {
  if (!shouldLog(level)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const payload = formatData(data);
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (payload) {
    console.log(`${line}\n${payload}`);
    return;
  }

  console.log(line);
}

export const logger = {
  debug(message, data) {
    log("debug", message, data);
  },
  info(message, data) {
    log("info", message, data);
  },
  warn(message, data) {
    log("warn", message, data);
  },
  error(message, data) {
    log("error", message, data);
  }
};
