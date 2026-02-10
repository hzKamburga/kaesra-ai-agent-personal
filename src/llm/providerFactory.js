import { OpenAIProvider } from "./openaiProvider.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { GenericProvider } from "./genericProvider.js";

export function createProvider(config) {
  if (config.provider === "openai") {
    return new OpenAIProvider({
      apiKey: config.openaiApiKey,
      model: config.model
    });
  }

  if (config.provider === "anthropic") {
    return new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.model
    });
  }

  if (config.provider === "generic") {
    return new GenericProvider({
      endpoint: config.generic.endpoint,
      apiKey: config.generic.apiKey,
      model: config.generic.model || config.model,
      headers: config.generic.headers
    });
  }

  throw new Error(`Unsupported provider: ${config.provider}`);
}
