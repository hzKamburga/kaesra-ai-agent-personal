import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AssistantAgent } from "../agent/assistantAgent.js";

export async function runChatCommand({ provider, toolRegistry }) {
  if (!provider) {
    throw new Error("Chat mode needs a configured AI provider");
  }

  const printLiveEvent = (event) => {
    if (!event || typeof event !== "object") {
      return;
    }

    if (typeof event.log === "string" && event.log.trim()) {
      console.log(event.log);
    }
  };

  const agent = new AssistantAgent({
    provider,
    toolRegistry,
    maxSteps: 20,
    onEvent: printLiveEvent
  });

  const rl = readline.createInterface({ input, output });

  console.log("Kaesra Agent chat aktif. Cikmak icin 'exit' yaz.");

  while (true) {
    const userInput = (await rl.question("Sen > ")).trim();

    if (!userInput) {
      continue;
    }

    if (["exit", "quit", "q"].includes(userInput.toLowerCase())) {
      break;
    }

    try {
      const result = await agent.ask(userInput);
      console.log(`Agent > ${result.message}`);
    } catch (error) {
      console.error(`Agent hata: ${error.message}`);
    }
  }

  rl.close();
}
