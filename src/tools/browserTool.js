import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "../core/config.js";
import { runResearchTask } from "./researchTool.js";

function toBool(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

async function executeWithPage(browserOptions, profileDir, handler) {
  let browser;
  let context;

  if (profileDir) {
    context = await chromium.launchPersistentContext(profileDir, browserOptions);
  } else {
    browser = await chromium.launch(browserOptions);
    context = await browser.newContext();
  }

  try {
    const page = context.pages()[0] || (await context.newPage());
    return await handler(page);
  } finally {
    await context.close();
    if (browser) {
      await browser.close();
    }
  }
}

function parseSearchResults(items, limit) {
  const filtered = [];

  for (const item of items || []) {
    if (!item?.url || !item?.title) {
      continue;
    }

    if (
      item.url.startsWith("https://webcache.googleusercontent.com") ||
      item.url.includes("google.com/search") ||
      item.url.includes("/settings/") ||
      item.url.includes("/preferences")
    ) {
      continue;
    }

    filtered.push({
      title: item.title,
      url: item.url,
      snippet: item.snippet || ""
    });

    if (filtered.length >= limit) {
      break;
    }
  }

  return filtered;
}

async function acceptGoogleConsent(page) {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Reject all")',
    'button:has-text("Kabul et")',
    'button:has-text("Tumunu kabul et")'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
      await locator.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(700);
      return;
    }
  }
}

async function scrapeGoogleResults(page, query, limit) {
  const rawItems = await page.evaluate(() => {
    const visited = new Set();
    const rows = [];
    const anchors = Array.from(document.querySelectorAll("a"));

    for (const anchor of anchors) {
      const titleNode = anchor.querySelector("h3");
      const title = titleNode?.textContent?.trim() || "";
      const href = anchor.href || "";

      if (!title || !href || visited.has(href)) {
        continue;
      }

      visited.add(href);

      if (!href.startsWith("http")) {
        continue;
      }

      const container = anchor.closest("div");
      const snippet =
        container?.querySelector("div.VwiC3b")?.textContent?.trim() ||
        container?.querySelector("span.aCOpRe")?.textContent?.trim() ||
        container?.querySelector("div[data-sncf]")?.textContent?.trim() ||
        "";

      rows.push({
        title,
        url: href,
        snippet
      });
    }

    return rows;
  });

  const parsed = parseSearchResults(rawItems, limit);
  if (parsed.length > 0) {
    return parsed;
  }

  await page.goto(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  const fallbackItems = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a.result__a"));
    return links.map((link) => ({
      title: link.textContent?.trim() || "",
      url: link.href || "",
      snippet: link.closest(".result")?.querySelector(".result__snippet")?.textContent?.trim() || ""
    }));
  });

  return parseSearchResults(fallbackItems, limit);
}

export async function runBrowserTask(input = {}) {
  const action = input.action || "search";
  const headless = toBool(input.headless, config.browser.headless);
  const profileDir = input.profileDir || config.browser.userDataDir;

  const browserOptions = {
    headless
  };

  if (config.browser.executablePath) {
    browserOptions.executablePath = config.browser.executablePath;
  } else {
    browserOptions.channel = "chrome";
  }

  const taskHandler = async (page) => {
      if (action === "search") {
        const query = input.query;
        const limit = Math.max(1, Math.min(10, Number(input.limit) || 5));

        if (!query) {
          throw new Error("browser search action requires 'query'");
        }

        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
          waitUntil: "domcontentloaded",
          timeout: 45000
        });

        await page.waitForTimeout(1200);
        await acceptGoogleConsent(page);
        let results = await scrapeGoogleResults(page, query, limit);
        let fallbackUsed = false;

        if (results.length === 0) {
          const fallback = await runResearchTask({ query, maxResults: limit }).catch(() => null);
          if (fallback?.results?.length) {
            results = fallback.results;
            fallbackUsed = true;
          }
        }

        return {
          action,
          query,
          timestamp: new Date().toISOString(),
          results,
          fallbackUsed
        };
      }

      if (action === "extract") {
        const url = input.url;
        const maxChars = Math.max(500, Math.min(15000, Number(input.maxChars) || 4000));

        if (!url) {
          throw new Error("browser extract action requires 'url'");
        }

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(500);

        const pageData = await page.evaluate((limit) => {
          const title = document.title || "";
          const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();

          return {
            title,
            text: bodyText.slice(0, limit)
          };
        }, maxChars);

        return {
          action,
          url,
          timestamp: new Date().toISOString(),
          ...pageData
        };
      }

      if (action === "screenshot") {
        const url = input.url;

        if (!url) {
          throw new Error("browser screenshot action requires 'url'");
        }

        const outputPath = input.outputPath || `artifacts/screenshot-${Date.now()}.png`;
        const absoluteOutputPath = path.resolve(process.cwd(), outputPath);

        await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
        await page.screenshot({ path: absoluteOutputPath, fullPage: true });

        return {
          action,
          url,
          timestamp: new Date().toISOString(),
          outputPath: absoluteOutputPath
        };
      }

      throw new Error(`Unsupported browser action: ${action}`);
    };

  try {
    return await executeWithPage(browserOptions, profileDir, taskHandler);
  } catch (error) {
    const errorText = String(error.message || "");

    if (!config.browser.executablePath && errorText.includes("chrome")) {
      return executeWithPage({ headless }, profileDir, taskHandler);
    }

    if (String(error.message || "").includes("SingletonLock") || String(error.message || "").includes("profile")) {
      throw new Error(
        "Chrome profile lock hatasi. Chrome aciksa kapatip tekrar dene veya farkli profileDir ver."
      );
    }

    throw error;
  }
}

export const browserTool = {
  name: "browser",
  description:
    "Playwright tabanli browser otomasyonu yapar (ayri browser context). Input: { action: search|extract|screenshot, query?, url?, profileDir?, headless? }. Gercek kullanici Chrome sekmesi icin chrome_live aracini kullan.",
  async run(input) {
    return runBrowserTask(input);
  }
};
