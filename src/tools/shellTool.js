import { spawn } from "node:child_process";
import path from "node:path";
import { pathExists } from "../core/fsUtils.js";

const MAX_OUTPUT_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = 60000;

// Güvenli komutlar: bu prefix'lerle başlayan komutlar otomatik izin alır
const SAFE_COMMAND_PREFIXES = [
    "node ",
    "node --",
    "npm ",
    "npx ",
    "python ",
    "python3 ",
    "pip ",
    "pip3 ",
    "git ",
    "ls ",
    "dir ",
    "cat ",
    "echo ",
    "pwd",
    "which ",
    "where ",
    "type ",
    "tsc ",
    "eslint ",
    "prettier "
];

// Hiçbir zaman çalıştırılamayacak tehlikeli komutlar
const BLOCKED_PATTERNS = [
    /rm\s+-rf\s+\//,
    /format\s+[a-z]:/i,
    /del\s+\/[fsq]/i,
    /shutdown/i,
    /reboot/i,
    /mkfs/i,
    /dd\s+if=/
];

function isSafeCommand(command) {
    const lower = command.trim().toLowerCase();
    return SAFE_COMMAND_PREFIXES.some(prefix => lower.startsWith(prefix.toLowerCase()));
}

function isBlockedCommand(command) {
    return BLOCKED_PATTERNS.some(pattern => pattern.test(command));
}

function clipOutput(text, limit = MAX_OUTPUT_CHARS) {
    if (!text) return "";
    const str = String(text);
    if (str.length <= limit) return str;
    return str.slice(0, limit) + `\n...[output truncated at ${limit} chars]`;
}

async function runShellCommand({ command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, stdin = "" }) {
    return new Promise((resolve) => {
        const shell = process.platform === "win32" ? "cmd.exe" : "sh";
        const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];

        const child = spawn(shell, shellArgs, {
            cwd: cwd || process.cwd(),
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env }
        });

        const stdoutChunks = [];
        const stderrChunks = [];
        let settled = false;

        const settle = (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            const stdout = clipOutput(Buffer.concat(stdoutChunks).toString("utf8").trim());
            const stderr = clipOutput(Buffer.concat(stderrChunks).toString("utf8").trim());
            const ok = code === 0;

            resolve({ ok, command, cwd: cwd || process.cwd(), code: code ?? -1, signal, stdout, stderr });
        };

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill("SIGTERM");
                resolve({
                    ok: false,
                    command,
                    cwd: cwd || process.cwd(),
                    code: -1,
                    error: `Command timed out after ${timeoutMs}ms`,
                    stdout: clipOutput(Buffer.concat(stdoutChunks).toString("utf8").trim()),
                    stderr: clipOutput(Buffer.concat(stderrChunks).toString("utf8").trim())
                });
            }
        }, timeoutMs);

        child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
        child.on("error", (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve({ ok: false, command, cwd: cwd || process.cwd(), code: -1, error: err.message, stdout: "", stderr: "" });
            }
        });
        child.on("close", (code, signal) => settle(code, signal));

        if (stdin) {
            child.stdin.write(String(stdin));
        }
        child.stdin.end();
    });
}

export async function runShellTask(input = {}) {
    const command = String(input.command || "").trim();
    if (!command) {
        throw new Error("shell tool requires 'command'");
    }

    // Block dangerous commands unconditionally
    if (isBlockedCommand(command)) {
        throw new Error(`Blocked dangerous command: ${command}`);
    }

    // Resolve working directory
    let cwd = process.cwd();
    if (input.cwd) {
        const resolved = path.resolve(String(input.cwd));
        if (await pathExists(resolved)) {
            cwd = resolved;
        } else {
            throw new Error(`Working directory not found: ${input.cwd}`);
        }
    }

    const timeoutMs = Math.max(1000, Math.min(300000, Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS));

    return runShellCommand({
        command,
        cwd,
        timeoutMs,
        stdin: String(input.stdin || "")
    });
}

export const shellTool = {
    name: "shell",
    description:
        "Terminal komutu caliştirır. Input: { command, cwd?, timeoutMs?, stdin? }. Proje klasoründe npm install, node script.js, python main.py, git status vb. komutlarini calistirmak icin kullan. Sonuc: { ok, stdout, stderr, code }. Tehlikeli komutlar otomatik engellenir.",
    async run(input) {
        return runShellTask(input);
    }
};
