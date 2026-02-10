import { config } from "../core/config.js";
import * as cheerio from "cheerio";

function truncate(text, maxLength = 300) {
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function flattenDuckTopics(topics, collector = []) {
  for (const topic of topics || []) {
    if (topic?.Topics) {
      flattenDuckTopics(topic.Topics, collector);
      continue;
    }

    if (topic?.Text || topic?.FirstURL) {
      collector.push(topic);
    }
  }

  return collector;
}

function decodeDuckLink(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    if (redirected) {
      return decodeURIComponent(redirected);
    }
    return parsed.href;
  } catch {
    return rawUrl;
  }
}

async function searchWithTavily(query, maxResults) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: config.search.tavilyApiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily search failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const results = (data.results || []).map((item) => ({
    title: item.title || item.url,
    url: item.url,
    snippet: truncate(item.content || item.snippet || ""),
    source: "tavily"
  }));

  return {
    provider: "tavily",
    results
  };
}

async function searchWithSerpApi(query, maxResults) {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: config.search.serpApiKey,
    num: String(maxResults)
  });

  const url = `https://serpapi.com/search.json?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SerpAPI search failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const results = (data.organic_results || []).map((item) => ({
    title: item.title || item.link,
    url: item.link,
    snippet: truncate(item.snippet || ""),
    source: "serpapi"
  }));

  return {
    provider: "serpapi",
    results
  };
}

async function searchWithDuckDuckGoHtml(query, maxResults) {
  const params = new URLSearchParams({
    q: query,
    ia: "web"
  });

  const response = await fetch(`https://duckduckgo.com/html/?${params.toString()}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KaesraAgent/1.0)"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DuckDuckGo HTML search failed (${response.status}): ${text}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const visited = new Set();
  const results = [];

  $(".result").each((_index, element) => {
    if (results.length >= maxResults) {
      return;
    }

    const linkElement = $(element).find("a.result__a").first();
    const title = linkElement.text().trim();
    const href = decodeDuckLink(linkElement.attr("href") || "");
    const snippet = $(element).find(".result__snippet").first().text().trim();

    if (!title || !href || visited.has(href)) {
      return;
    }

    visited.add(href);
    results.push({
      title,
      url: href,
      snippet: truncate(snippet || title),
      source: "duckduckgo"
    });
  });

  if (results.length === 0) {
    throw new Error("DuckDuckGo HTML parser could not extract results");
  }

  return {
    provider: "duckduckgo",
    results
  };
}

async function searchWithDuckInstant(query, maxResults) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_redirect: "1",
    no_html: "1",
    skip_disambig: "1"
  });

  const response = await fetch(`https://api.duckduckgo.com/?${params.toString()}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DuckDuckGo search failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const flattenedTopics = flattenDuckTopics(data.RelatedTopics || []);

  const results = [];

  if (data.AbstractText) {
    results.push({
      title: data.Heading || "DuckDuckGo Instant Answer",
      url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      snippet: truncate(data.AbstractText),
      source: data.AbstractSource || "duckduckgo"
    });
  }

  for (const topic of flattenedTopics) {
    results.push({
      title: topic.Text || topic.FirstURL || "Result",
      url: topic.FirstURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      snippet: truncate(topic.Text || ""),
      source: "duckduckgo"
    });

    if (results.length >= maxResults) {
      break;
    }
  }

  if (results.length === 0) {
    results.push({
      title: "No indexed instant answer found",
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      snippet: "Try browser tool for full live page research.",
      source: "duckduckgo"
    });
  }

  return {
    provider: "duckduckgo",
    results: results.slice(0, maxResults)
  };
}

async function searchWithDuckDuckGo(query, maxResults) {
  try {
    return await searchWithDuckDuckGoHtml(query, maxResults);
  } catch {
    return searchWithDuckInstant(query, maxResults);
  }
}

export async function runResearchTask({ query, maxResults = 5 } = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("research tool requires a non-empty 'query' string");
  }

  const limit = Math.max(1, Math.min(10, Number(maxResults) || 5));

  if (config.search.tavilyApiKey) {
    return {
      query,
      timestamp: new Date().toISOString(),
      ...(await searchWithTavily(query, limit))
    };
  }

  if (config.search.serpApiKey) {
    return {
      query,
      timestamp: new Date().toISOString(),
      ...(await searchWithSerpApi(query, limit))
    };
  }

  return {
    query,
    timestamp: new Date().toISOString(),
    ...(await searchWithDuckDuckGo(query, limit))
  };
}

export const researchTool = {
  name: "research",
  description:
    "Web aramasi yapar. Input: { query: string, maxResults?: number }. Tavily/SerpAPI varsa kullanir, yoksa DuckDuckGo fallback ile sonuc getirir.",
  async run(input) {
    return runResearchTask(input);
  }
};
