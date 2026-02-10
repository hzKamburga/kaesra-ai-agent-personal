import OpenAI from "openai";
import { BaseProvider } from "./baseProvider.js";

function normalizeOpenAIContent(content) {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
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
      .join("\n");
  }

  return String(content);
}

export class OpenAIProvider extends BaseProvider {
  constructor({ apiKey, model }) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");
    }

    super(model);
    this.client = new OpenAI({ apiKey });
  }

  async complete({ systemPrompt, messages, temperature = 0.2, maxTokens = 1500 }) {
    const payload = [];

    if (systemPrompt) {
      payload.push({ role: "system", content: systemPrompt });
    }

    for (const message of messages || []) {
      payload.push({ role: message.role, content: message.content });
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: payload,
      temperature,
      max_tokens: maxTokens
    });

    return normalizeOpenAIContent(response.choices?.[0]?.message?.content);
  }
}
