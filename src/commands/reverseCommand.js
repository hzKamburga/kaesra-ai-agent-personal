
import { load } from "cheerio";
import { runChromeLiveTask } from "../tools/chromeLiveTool.js";
import { logger } from "../core/logger.js";
import fs from "node:fs/promises";
import path from "node:path";

// Helper to fetch text content
async function fetchText(url) {
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } catch (e) {
        return null;
    }
}

export async function runReverseCommand({ url, provider, action = "analyze", chunkFilter = "main" }) {
    if (!url) {
        throw new Error("URL is required for reverse engineering.");
    }

    logger.info(`Starting reverse engineering on: ${url}`);

    // 1. Navigate visually (using bridge)
    try {
        await runChromeLiveTask({ action: "navigateActive", url });
        logger.info("Chrome navigated to target.");
    } catch (e) {
        logger.warn("Chrome bridge navigation failed, continuing with direct fetch...", e.message);
    }

    // 2. Fetch initial HTML
    const html = await fetchText(url);
    if (!html) {
        throw new Error("Failed to fetch page content.");
    }

    // 3. Parse and find scripts
    const $ = load(html);
    const scripts = [];
    $("script[src]").each((_, el) => {
        const src = $(el).attr("src");
        if (src) {
            // Resolve relative URLs
            try {
                const absolute = new URL(src, url).toString();
                scripts.push(absolute);
            } catch {
                scripts.push(src);
            }
        }
    });

    const matchingScripts = scripts.filter(s => s.includes(chunkFilter) || s.includes(".js"));

    logger.info(`Found ${scripts.length} scripts, ${matchingScripts.length} match filter '${chunkFilter}'`);

    if (action === "list") {
        return {
            url,
            total_scripts: scripts.length,
            scripts: matchingScripts
        };
    }

    // 4. Analyze script content
    // Limit to first 3 matches to save tokens/time
    const toAnalyze = matchingScripts.slice(0, 3);
    const analyses = [];

    for (const scriptUrl of toAnalyze) {
        logger.info(`Fetching chunk: ${scriptUrl}`);
        const content = await fetchText(scriptUrl);

        if (!content) {
            analyses.push({ url: scriptUrl, error: "Fetch failed" });
            continue;
        }

        if (provider) {
            logger.info(`Analyzing with AI...`);
            const prompt = `
        Analyze this JavaScript chunk from ${url}. 
        Identify key logic, API endpoints, or security flaws.
        Keep it concise.
        
        Chunk URL: ${scriptUrl}
        Content (truncated):
        ${content.slice(0, 5000)}
        ...
      `;

            const analysis = await provider.complete(prompt);
            analyses.push({ url: scriptUrl, analysis });
        } else {
            analyses.push({ url: scriptUrl, size: content.length, preview: content.slice(0, 200) });
        }
    }

    return {
        url,
        analyzed_chunks: analyses.length,
        results: analyses
    };
}
