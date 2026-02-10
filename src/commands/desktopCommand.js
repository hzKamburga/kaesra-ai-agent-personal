import { runDesktopTask } from "../tools/desktopTool.js";

export async function runDesktopCommand(input = {}) {
  return runDesktopTask(input);
}
