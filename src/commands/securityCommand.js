
import fs from "node:fs";
import path from "node:path";
import { logger } from "../core/logger.js";

function getFiles(dir, files = []) {
    const fileList = fs.readdirSync(dir);
    for (const file of fileList) {
        if (file === "node_modules" || file === ".git" || file === "dist" || file === "build") continue;
        const name = `${dir}/${file}`;
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files);
        } else {
            if (file.endsWith(".js") || file.endsWith(".json") || file.endsWith(".html") || file.endsWith(".env")) {
                files.push(name);
            }
        }
    }
    return files;
}

export async function runSecurityCommand({ targetDir = ".", provider, maxFiles = 20 }) {
    logger.info(`Starting security scan in ${targetDir}...`);

    if (!provider) {
        throw new Error("AI Provider is required for security scan.");
    }

    const absPath = path.resolve(targetDir);
    const allFiles = getFiles(absPath);

    // Limiting files to avoid token limits
    const filesToScan = allFiles.slice(0, maxFiles);

    const fileContents = filesToScan.map(f => {
        const content = fs.readFileSync(f, "utf-8");
        return `--- FILE: ${path.relative(absPath, f)} ---\n${content}\n`;
    }).join("\n");

    const prompt = `
    You are a Senior Security Engineer. Analyze the following project files for security vulnerabilities, bad practices, and potential bugs.
    
    Files:
    ${fileContents}
    
    Return a valid JSON object with the following structure:
    {
      "files_scanned": number,
      "vulnerabilities": [
        {
          "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
          "file": "filename",
          "line": number (approximate),
          "description": "Short description of the issue",
          "recommendation": "How to fix it"
        }
      ],
      "summary": "Overall security summary of the project"
    }
    
    Do not include markdown formatting like \`\`\`json. Just return the JSON string.
  `;

    const response = await provider.complete(prompt);

    try {
        // Attempt to extract JSON if wrapped in markdown
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : response;
        return JSON.parse(jsonStr);
    } catch (e) {
        logger.error("Failed to parse security report JSON", e);
        return {
            error: "Failed to parse AI response",
            raw_response: response
        };
    }
}
