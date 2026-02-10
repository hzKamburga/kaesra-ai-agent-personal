import { runChromeLiveTask } from "../tools/chromeLiveTool.js";

export async function runChromeCommand(input = {}) {
  return runChromeLiveTask(input);
}
