import { runProjectTask } from "../tools/projectTool.js";

export async function runProjectCommand(options, context = {}) {
  return runProjectTask(options, context);
}
