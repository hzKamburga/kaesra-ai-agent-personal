function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeHeaders(rawHeaders) {
  if (!rawHeaders) {
    return {};
  }

  if (typeof rawHeaders === "string") {
    return safeJsonParse(rawHeaders) || {};
  }

  return rawHeaders;
}

function normalizeBody(rawBody) {
  if (rawBody === undefined || rawBody === null || rawBody === "") {
    return undefined;
  }

  if (typeof rawBody === "string") {
    const parsed = safeJsonParse(rawBody);
    return parsed;
  }

  return rawBody;
}

export async function runApiTask(input = {}) {
  const method = String(input.method || "GET").toUpperCase();
  const url = input.url;
  const timeoutMs = Math.max(1000, Math.min(120000, Number(input.timeoutMs) || 30000));

  if (!url) {
    throw new Error("api tool requires 'url'");
  }

  const headers = normalizeHeaders(input.headers);
  const body = normalizeBody(input.body);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestInit = {
      method,
      headers,
      signal: controller.signal
    };

    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      if (typeof body === "object") {
        if (!requestInit.headers["Content-Type"] && !requestInit.headers["content-type"]) {
          requestInit.headers["Content-Type"] = "application/json";
        }
        requestInit.body = JSON.stringify(body);
      } else {
        requestInit.body = String(body);
      }
    }

    const response = await fetch(url, requestInit);
    const responseText = await response.text();
    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }

    return {
      url,
      method,
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      data
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const apiTool = {
  name: "api",
  description:
    "Herhangi bir HTTP API endpointine istek atar. Input: { method, url, headers?, body?, timeoutMs? }",
  async run(input) {
    return runApiTask(input);
  }
};
