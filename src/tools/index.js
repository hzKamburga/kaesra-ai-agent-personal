import { researchTool } from "./researchTool.js";
import { browserTool } from "./browserTool.js";
import { apiTool } from "./apiTool.js";
import { projectTool } from "./projectTool.js";
import { fileTool } from "./fileTool.js";
import { desktopTool } from "./desktopTool.js";
import { schedulerTool } from "./schedulerTool.js";
import { chromeLiveTool } from "./chromeLiveTool.js";
import { shellTool } from "./shellTool.js";
import { memoryTool } from "./memoryTool.js";

const TOOL_LIST = [researchTool, browserTool, chromeLiveTool, apiTool, projectTool, fileTool, shellTool, memoryTool, desktopTool, schedulerTool];

export function createToolRegistry(context = {}) {
  const map = new Map(TOOL_LIST.map((tool) => [tool.name, tool]));

  return {
    list() {
      return TOOL_LIST.map((tool) => ({
        name: tool.name,
        description: tool.description
      }));
    },
    async execute(name, input) {
      const tool = map.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }

      return tool.run(input || {}, context);
    }
  };
}

export const availableTools = TOOL_LIST;
