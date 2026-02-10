import { runResearchTask } from "../tools/researchTool.js";

export async function runResearchCommand({ query, maxResults, summarize, provider }) {
  const research = await runResearchTask({ query, maxResults });

  if (!summarize || !provider) {
    return { research };
  }

  const summary = await provider.complete({
    systemPrompt: "Summarize research results in short actionable bullets.",
    messages: [
      {
        role: "user",
        content: JSON.stringify(research)
      }
    ],
    temperature: 0.2,
    maxTokens: 900
  });

  return {
    research,
    summary
  };
}
