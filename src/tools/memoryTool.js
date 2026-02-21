import fs from "node:fs/promises";
import path from "node:path";

const MEMORY_FILE = path.resolve(process.cwd(), "data", "agent-memory.json");

async function loadMemory() {
    try {
        const raw = await fs.readFile(MEMORY_FILE, "utf8");
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

async function saveMemory(data) {
    await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
    await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

function now() {
    return new Date().toISOString();
}

export async function runMemoryTask(input = {}) {
    const action = String(input.action || "recall").toLowerCase();

    if (action === "remember" || action === "save" || action === "set") {
        const key = String(input.key || "").trim();
        const value = input.value !== undefined ? input.value : input.content;
        const category = String(input.category || "general").toLowerCase();
        const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];

        if (!key) throw new Error("memory remember requires 'key'");
        if (value === undefined || value === null) throw new Error("memory remember requires 'value'");

        const mem = await loadMemory();
        if (!mem[category]) mem[category] = {};

        mem[category][key] = {
            value,
            tags,
            createdAt: mem[category][key]?.createdAt || now(),
            updatedAt: now()
        };

        await saveMemory(mem);
        return {
            action: "remember",
            category,
            key,
            stored: true,
            updatedAt: mem[category][key].updatedAt
        };
    }

    if (action === "recall" || action === "get" || action === "read") {
        const key = String(input.key || "").trim();
        const category = String(input.category || "").toLowerCase();

        const mem = await loadMemory();

        if (key) {
            // Search specific key across categories or in a specific one
            const cats = category ? [category] : Object.keys(mem);
            for (const cat of cats) {
                if (mem[cat]?.[key]) {
                    return {
                        action: "recall",
                        category: cat,
                        key,
                        found: true,
                        ...mem[cat][key]
                    };
                }
            }
            return { action: "recall", key, found: false };
        }

        // Return all from category or all
        if (category && mem[category]) {
            return {
                action: "recall",
                category,
                entries: Object.entries(mem[category]).map(([k, v]) => ({ key: k, ...v }))
            };
        }

        // Return full summary
        const summary = {};
        for (const [cat, entries] of Object.entries(mem)) {
            summary[cat] = Object.keys(entries);
        }
        return { action: "recall", allCategories: summary };
    }

    if (action === "list") {
        const category = String(input.category || "").toLowerCase();
        const mem = await loadMemory();

        if (category && mem[category]) {
            return {
                action: "list",
                category,
                keys: Object.keys(mem[category]),
                count: Object.keys(mem[category]).length
            };
        }

        const all = {};
        for (const [cat, entries] of Object.entries(mem)) {
            all[cat] = Object.keys(entries);
        }
        return { action: "list", categories: all };
    }

    if (action === "search" || action === "find") {
        const query = String(input.query || input.key || "").toLowerCase();
        if (!query) throw new Error("memory search requires 'query'");

        const mem = await loadMemory();
        const results = [];

        for (const [cat, entries] of Object.entries(mem)) {
            for (const [key, entry] of Object.entries(entries)) {
                const keyMatch = key.toLowerCase().includes(query);
                const valueMatch = String(entry.value || "").toLowerCase().includes(query);
                const tagMatch = (entry.tags || []).some(t => t.toLowerCase().includes(query));

                if (keyMatch || valueMatch || tagMatch) {
                    results.push({
                        category: cat,
                        key,
                        relevance: keyMatch ? "key" : tagMatch ? "tag" : "value",
                        preview: String(entry.value || "").slice(0, 200),
                        updatedAt: entry.updatedAt
                    });
                }
            }
        }

        return { action: "search", query, results, count: results.length };
    }

    if (action === "forget" || action === "delete" || action === "remove") {
        const key = String(input.key || "").trim();
        const category = String(input.category || "").toLowerCase();

        if (!key) throw new Error("memory forget requires 'key'");

        const mem = await loadMemory();
        const cats = category ? [category] : Object.keys(mem);
        let deleted = false;

        for (const cat of cats) {
            if (mem[cat]?.[key]) {
                delete mem[cat][key];
                deleted = true;
                // Clean empty categories
                if (Object.keys(mem[cat]).length === 0) {
                    delete mem[cat];
                }
            }
        }

        if (deleted) await saveMemory(mem);
        return { action: "forget", key, deleted };
    }

    if (action === "clear") {
        const category = String(input.category || "").toLowerCase();
        const mem = await loadMemory();

        if (category) {
            delete mem[category];
            await saveMemory(mem);
            return { action: "clear", category, cleared: true };
        }

        await saveMemory({});
        return { action: "clear", all: true };
    }

    throw new Error(`Unsupported memory action: ${action}`);
}

export const memoryTool = {
    name: "memory",
    description:
        "Oturumlar arasi kalici hafiza. Kullanicinin tercihleri, proje bilgileri, kod parcalari, notlar saklanabilir. Actions: remember(key,value,category?,tags?) | recall(key?,category?) | search(query) | list(category?) | forget(key,category?) | clear(category?). Ornek: { action:'remember', key:'user-name', value:'Berkay', category:'user' }. Sonraki oturumlarda { action:'recall', key:'user-name' } ile erisebilirsin.",
    async run(input) {
        return runMemoryTask(input);
    }
};
