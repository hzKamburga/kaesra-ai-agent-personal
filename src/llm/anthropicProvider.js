import Anthropic from "@anthropic-ai/sdk";
import { BaseProvider } from "./baseProvider.js";

function extractTextBlocks(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export class AnthropicProvider extends BaseProvider {
  constructor({ apiKey, model }) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic");
    }

    super(model);
    this.client = new Anthropic({ apiKey });
  }

  async complete({ systemPrompt, messages, temperature = 0.2, maxTokens = 1500 }) {
    const anthropicMessages = (messages || []).map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content)
    }));

    const response = await this.client.messages.create({
      model: this.model,
      system: systemPrompt || "",
      messages: anthropicMessages,
      temperature,
      max_tokens: maxTokens
    });

    return extractTextBlocks(response.content);
  }
}
