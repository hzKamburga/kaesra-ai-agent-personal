import { BaseProvider } from "./baseProvider.js";

function getDefaultHeaders(apiKey) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function parseGenericResponse(payload) {
  if (!payload || typeof payload !== "object") {
    return String(payload || "");
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const message = payload.choices?.[0]?.message;
  if (message && typeof message === "object") {
    const content = message.content;
    if (content !== undefined && content !== null) {
      if (typeof content === "string" && content.trim()) {
        return content;
      }

      if (Array.isArray(content)) {
        const merged = content
          .map((part) => part?.text || "")
          .filter(Boolean)
          .join("\n");

        if (merged.trim()) {
          return merged;
        }
      }
    }

    // Some gateways place assistant output (or tool JSON) into a "reasoning" field.
    if (typeof message.reasoning === "string" && message.reasoning.trim()) {
      return message.reasoning;
    }
  }

  if (payload.content?.[0]?.text) {
    return payload.content[0].text;
  }

  return JSON.stringify(payload);
}

function extractContent(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          if (typeof part.text === "string") {
            return part.text;
          }
          if (part.type === "text" && typeof part.text === "string") {
            return part.text;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractChunkText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const choice = payload.choices?.[0];
  if (choice?.delta?.content !== undefined) {
    return extractContent(choice.delta.content);
  }

  if (typeof choice?.delta?.reasoning === "string" && choice.delta.reasoning.trim()) {
    return choice.delta.reasoning;
  }

  if (choice?.message?.content !== undefined) {
    return extractContent(choice.message.content);
  }

  if (typeof choice?.message?.reasoning === "string" && choice.message.reasoning.trim()) {
    return choice.message.reasoning;
  }

  if (payload.content?.[0]?.text) {
    return String(payload.content[0].text);
  }

  return "";
}

function parseSseResponse(rawText) {
  const lines = String(rawText || "").split(/\r?\n/);
  const chunks = [];
  let lastPayload = null;

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    try {
      const payload = JSON.parse(data);
      lastPayload = payload;
      const text = extractChunkText(payload);
      if (text) {
        chunks.push(text);
      }
    } catch {
      // ignore malformed stream line
    }
  }

  if (chunks.length > 0) {
    return chunks.join("");
  }

  if (lastPayload) {
    return parseGenericResponse(lastPayload);
  }

  return "";
}

function tryParseAsJson(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class GenericProvider extends BaseProvider {
  constructor({ endpoint, apiKey, model, headers }) {
    if (!endpoint) {
      throw new Error("GENERIC_AI_ENDPOINT is required when AI_PROVIDER=generic");
    }

    super(model || "gpt-4.1-mini");
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.headers = headers || {};
  }

  async complete({ systemPrompt, messages, temperature = 0.2, maxTokens = 1500 }) {
    const payload = {
      model: this.model,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      messages: []
    };

    if (systemPrompt) {
      payload.messages.push({ role: "system", content: systemPrompt });
    }

    for (const message of messages || []) {
      payload.messages.push({ role: message.role, content: message.content });
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        ...getDefaultHeaders(this.apiKey),
        ...this.headers
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Generic provider request failed (${response.status}): ${text}`);
    }

    const rawText = await response.text();
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const trimmed = rawText.trimStart();

    if (contentType.includes("text/event-stream") || trimmed.startsWith("data:")) {
      const parsedStream = parseSseResponse(rawText);
      if (parsedStream) {
        return parsedStream;
      }
    }

    const data = tryParseAsJson(rawText);
    if (data) {
      return parseGenericResponse(data);
    }

    throw new Error("Generic provider returned an unsupported response format");
  }
}
