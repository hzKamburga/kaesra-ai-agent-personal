import { exec, execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../core/config.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const WINDOWS_INVENTORY_CACHE_TTL_MS = 2 * 60 * 1000;

let windowsInventoryCache = {
  updatedAt: 0,
  apps: []
};
let windowsInventoryPromise = null;

function quoteWindows(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function parseBooleanInput(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function toPositiveInt(value, fallback, max = 5000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(parsed));
}

function normalizeQuery(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeMatchText(value) {
  const normalized = normalizeMatchText(value);
  if (!normalized) {
    return [];
  }

  return normalized.split(/\s+/).filter(Boolean);
}

function parseArrayJson(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  return [];
}

function normalizeBaseName(value) {
  return String(value || "desktop")
    .trim()
    .toLowerCase();
}

function resolveKnownBaseDirectory(baseName) {
  const home = os.homedir();
  const base = normalizeBaseName(baseName);

  if (base === "desktop") {
    return path.join(home, "Desktop");
  }

  if (base === "documents" || base === "document") {
    return path.join(home, "Documents");
  }

  if (base === "downloads" || base === "download") {
    return path.join(home, "Downloads");
  }

  if (base === "home") {
    return home;
  }

  if (base === "temp" || base === "tmp") {
    return os.tmpdir();
  }

  return path.join(home, "Desktop");
}

function expandHomeVariables(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const home = os.homedir();

  if (text.startsWith("~")) {
    return path.join(home, text.slice(1));
  }

  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE || home;
    return text.replace(/%USERPROFILE%/gi, userProfile);
  }

  return text;
}

function resolveDirectoryTarget(input = {}) {
  const rawPath = String(input.path || "").trim();
  const rawName = String(input.name || "").trim();
  const basePath = resolveKnownBaseDirectory(input.base);

  if (!rawPath && !rawName) {
    throw new Error("desktop mkdir action requires 'name' or 'path'");
  }

  if (rawPath) {
    const expandedPath = expandHomeVariables(rawPath);
    if (path.isAbsolute(expandedPath)) {
      return path.normalize(expandedPath);
    }

    const normalizedRaw = expandedPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (/^desktop(\/|$)/i.test(normalizedRaw)) {
      const suffix = normalizedRaw.replace(/^desktop(\/|$)/i, "");
      return path.resolve(resolveKnownBaseDirectory("desktop"), suffix || ".");
    }

    if (/^documents?(\/|$)/i.test(normalizedRaw)) {
      const suffix = normalizedRaw.replace(/^documents?(\/|$)/i, "");
      return path.resolve(resolveKnownBaseDirectory("documents"), suffix || ".");
    }

    if (/^downloads?(\/|$)/i.test(normalizedRaw)) {
      const suffix = normalizedRaw.replace(/^downloads?(\/|$)/i, "");
      return path.resolve(resolveKnownBaseDirectory("downloads"), suffix || ".");
    }

    return path.resolve(basePath, expandedPath);
  }

  return path.resolve(basePath, rawName);
}

function buildOpenCommand(target, args) {
  const cleanedArgs = parseArrayJson(args);

  if (process.platform === "win32") {
    const argString = cleanedArgs.map((item) => quoteWindows(item)).join(" ");
    return `start "" ${quoteWindows(target)}${argString ? ` ${argString}` : ""}`;
  }

  if (process.platform === "darwin") {
    const argString = cleanedArgs.map((item) => quotePosix(item)).join(" ");
    return `open ${quotePosix(target)}${argString ? ` --args ${argString}` : ""}`;
  }

  const argString = cleanedArgs.map((item) => quotePosix(item)).join(" ");
  return `xdg-open ${quotePosix(target)}${argString ? ` ${argString}` : ""}`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const item = String(value || "").trim();
    if (!item) {
      continue;
    }

    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function parseCommandPath(rawValue) {
  let value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }

  const commaIndex = value.lastIndexOf(",");
  if (commaIndex > -1) {
    const suffix = value.slice(commaIndex + 1).trim();
    if (/^-?\d+$/.test(suffix)) {
      value = value.slice(0, commaIndex);
    }
  }

  let candidate = value.trim();

  if (candidate.startsWith('"')) {
    const closingQuote = candidate.indexOf('"', 1);
    if (closingQuote > 0) {
      candidate = candidate.slice(1, closingQuote);
    }
  }

  candidate = candidate.trim().replace(/^"+|"+$/g, "");
  if (!candidate) {
    return "";
  }

  const executableMatch = candidate.match(/^(?:[a-z]:\\|\\\\).*?\.(exe|cmd|bat|com|msc|lnk)/i);
  if (executableMatch) {
    return executableMatch[0];
  }

  if (/^[a-z]:\\/i.test(candidate) || candidate.startsWith("\\\\")) {
    return candidate;
  }

  return "";
}

function parseDisplayIconPath(displayIcon) {
  const parsed = parseCommandPath(displayIcon);
  if (!parsed) {
    return "";
  }

  if (!parsed.toLowerCase().includes(".exe")) {
    return "";
  }

  return parsed;
}

function listCommonApps() {
  if (process.platform === "win32") {
    return [
      {
        id: "common:chrome",
        name: "Chrome",
        source: "common",
        aliases: ["Google Chrome", "chrome.exe", "chrome"],
        launch: { mode: "target", value: "chrome.exe" }
      },
      {
        id: "common:vscode",
        name: "VS Code",
        source: "common",
        aliases: ["Visual Studio Code", "code", "code.exe"],
        launch: { mode: "target", value: "code" }
      },
      {
        id: "common:powershell",
        name: "PowerShell",
        source: "common",
        aliases: ["pwsh", "powershell.exe"],
        launch: { mode: "target", value: "powershell.exe" }
      },
      {
        id: "common:notepad",
        name: "Notepad",
        source: "common",
        aliases: ["notepad.exe"],
        launch: { mode: "target", value: "notepad.exe" }
      },
      {
        id: "common:explorer",
        name: "Explorer",
        source: "common",
        aliases: ["explorer.exe"],
        launch: { mode: "target", value: "explorer.exe" }
      },
      {
        id: "common:terminal",
        name: "Terminal",
        source: "common",
        aliases: ["windows terminal", "wt.exe", "wt"],
        launch: { mode: "target", value: "wt.exe" }
      }
    ];
  }

  if (process.platform === "darwin") {
    return [
      {
        id: "common:chrome",
        name: "Chrome",
        source: "common",
        aliases: ["Google Chrome"],
        launch: { mode: "target", value: "Google Chrome" }
      },
      {
        id: "common:vscode",
        name: "VS Code",
        source: "common",
        aliases: ["Visual Studio Code"],
        launch: { mode: "target", value: "Visual Studio Code" }
      },
      {
        id: "common:terminal",
        name: "Terminal",
        source: "common",
        launch: { mode: "target", value: "Terminal" }
      }
    ];
  }

  return [
    {
      id: "common:chrome",
      name: "Chrome",
      source: "common",
      aliases: ["google-chrome"],
      launch: { mode: "target", value: "google-chrome" }
    },
    {
      id: "common:vscode",
      name: "VS Code",
      source: "common",
      aliases: ["code"],
      launch: { mode: "target", value: "code" }
    },
    {
      id: "common:terminal",
      name: "Terminal",
      source: "common",
      aliases: ["gnome-terminal"],
      launch: { mode: "target", value: "gnome-terminal" }
    }
  ];
}

async function runPowerShellJson(script, timeoutMs = 120000) {
  const wrappedScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
${script}
`;

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrappedScript],
    {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 25 * 1024 * 1024
    }
  );

  const text = String(stdout || "").trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function listWindowsStartApps() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$apps = Get-StartApps | Sort-Object Name | Select-Object Name, AppID
$apps | ConvertTo-Json -Depth 4
`;

  const rows = await runPowerShellJson(script, 120000);

  return rows
    .map((row) => {
      const name = String(row.Name || "").trim();
      const appId = String(row.AppID || "").trim();

      if (!name || !appId) {
        return null;
      }

      return {
        id: `startapp:${slug(appId)}`,
        name,
        source: "startapps",
        appId,
        aliases: uniqueStrings([name, appId]),
        launch: {
          mode: "startAppId",
          value: appId
        }
      };
    })
    .filter(Boolean);
}

async function listWindowsRegistryApps() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)

$items = foreach ($root in $roots) {
  if (Test-Path $root) {
    Get-ChildItem $root | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($p.DisplayName) {
        [PSCustomObject]@{
          DisplayName = [string]$p.DisplayName
          DisplayVersion = [string]$p.DisplayVersion
          Publisher = [string]$p.Publisher
          InstallLocation = [string]$p.InstallLocation
          DisplayIcon = [string]$p.DisplayIcon
          UninstallString = [string]$p.UninstallString
        }
      }
    }
  }
}

$items | Sort-Object DisplayName, DisplayVersion -Unique | ConvertTo-Json -Depth 5
`;

  const rows = await runPowerShellJson(script, 120000);

  return rows
    .map((row, index) => {
      const name = String(row.DisplayName || "").trim();
      if (!name) {
        return null;
      }

      const displayVersion = String(row.DisplayVersion || "").trim();
      const publisher = String(row.Publisher || "").trim();
      const installLocation = String(row.InstallLocation || "").trim();
      const displayIcon = String(row.DisplayIcon || "").trim();
      const uninstallString = String(row.UninstallString || "").trim();
      const launchPath = parseDisplayIconPath(displayIcon);
      const executableName = launchPath ? path.basename(launchPath) : "";

      return {
        id: `registry:${slug(name)}:${index}`,
        name,
        source: "registry",
        version: displayVersion || undefined,
        publisher: publisher || undefined,
        installLocation: installLocation || undefined,
        uninstallString: uninstallString || undefined,
        executableName: executableName || undefined,
        aliases: uniqueStrings([name, executableName, executableName.replace(/\.exe$/i, "")]),
        launch:
          launchPath
            ? {
                mode: "path",
                value: launchPath
              }
            : undefined
      };
    })
    .filter(Boolean);
}

async function listWindowsAppPathApps() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
)

$items = foreach ($root in $roots) {
  if (Test-Path $root) {
    Get-ChildItem $root | ForEach-Object {
      $key = Get-Item $_.PSPath -ErrorAction SilentlyContinue
      if (-not $key) {
        return
      }

      $defaultValue = [string]$key.GetValue('')
      $pathValue = [string]$key.GetValue('Path')

      if ($defaultValue -or $pathValue) {
        [PSCustomObject]@{
          Name = [string]$_.PSChildName
          ExecutablePath = $defaultValue
          WorkingPath = $pathValue
        }
      }
    }
  }
}

$items | Sort-Object Name, ExecutablePath -Unique | ConvertTo-Json -Depth 5
`;

  const rows = await runPowerShellJson(script, 120000);

  return rows
    .map((row, index) => {
      const registryName = String(row.Name || "").trim();
      if (!registryName) {
        return null;
      }

      const executablePath = parseCommandPath(row.ExecutablePath);
      const launchValue = executablePath || registryName;
      const displayName = registryName.replace(/\.(exe|cmd|bat|com)$/i, "");
      const executableName = executablePath ? path.basename(executablePath) : registryName;

      return {
        id: `app-path:${slug(registryName)}:${index}`,
        name: displayName || registryName,
        source: "app_paths",
        workingPath: String(row.WorkingPath || "").trim() || undefined,
        executableName: executableName || undefined,
        aliases: uniqueStrings([registryName, displayName, executableName]),
        launch: executablePath
          ? {
              mode: "path",
              value: launchValue
            }
          : {
              mode: "target",
              value: launchValue
            }
      };
    })
    .filter(Boolean);
}

async function listWindowsShortcutApps() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:USERPROFILE\\Desktop",
  "$env:PUBLIC\\Desktop"
) | Where-Object { $_ -and (Test-Path $_) }

$shell = $null
$items = foreach ($root in $roots) {
  Get-ChildItem -Path $root -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $shortcut = $null
    try {
      if (-not $shell) {
        $shell = New-Object -ComObject WScript.Shell
      }
      $shortcut = $shell.CreateShortcut($_.FullName)
    } catch {}

    $targetPath = [string]$shortcut.TargetPath
    if (-not $targetPath) {
      return
    }

    [PSCustomObject]@{
      Name = [string]$_.BaseName
      TargetPath = $targetPath
      Arguments = [string]$shortcut.Arguments
      ShortcutPath = [string]$_.FullName
      Root = [string]$root
    }
  }
}

$items | Sort-Object Name, TargetPath -Unique | ConvertTo-Json -Depth 6
`;

  const rows = await runPowerShellJson(script, 120000);

  return rows
    .map((row, index) => {
      const name = String(row.Name || "").trim();
      const targetPath = parseCommandPath(row.TargetPath);
      const shortcutPath = String(row.ShortcutPath || "").trim();
      const argumentsText = String(row.Arguments || "").trim();

      if (!name || !targetPath) {
        return null;
      }

      const executableName = path.basename(targetPath);

      return {
        id: `shortcut:${slug(name)}:${index}`,
        name,
        source: "shortcuts",
        shortcutPath: shortcutPath || undefined,
        shortcutRoot: String(row.Root || "").trim() || undefined,
        launchArguments: argumentsText || undefined,
        executableName: executableName || undefined,
        aliases: uniqueStrings([name, executableName, executableName.replace(/\.(exe|cmd|bat|com)$/i, "")]),
        launch: {
          mode: "path",
          value: targetPath
        }
      };
    })
    .filter(Boolean);
}

async function listWindowsPathApps() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$items = Get-Command -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object Name, Source, Path -Unique
$items | ConvertTo-Json -Depth 4
`;

  const rows = await runPowerShellJson(script, 120000);

  return rows
    .map((row, index) => {
      const rawName = String(row.Name || "").trim();
      const pathValue = parseCommandPath(row.Path || row.Source);
      if (!rawName && !pathValue) {
        return null;
      }

      const commandName = rawName || (pathValue ? path.basename(pathValue) : "");
      if (!commandName) {
        return null;
      }

      const name = commandName.replace(/\.(exe|cmd|bat|com)$/i, "");

      return {
        id: `path:${slug(commandName)}:${index}`,
        name,
        source: "path",
        executableName: commandName,
        aliases: uniqueStrings([name, commandName]),
        launch: pathValue
          ? {
              mode: "path",
              value: pathValue
            }
          : {
              mode: "target",
              value: commandName
            }
      };
    })
    .filter(Boolean);
}

function escapePowerShellSingleQuote(value) {
  return String(value || "").replace(/'/g, "''");
}

async function listWindowsDeepSearchApps(query, limit = 200) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const safeQuery = escapePowerShellSingleQuote(normalizedQuery);
  const safeLimit = toPositiveInt(limit, 200, 1000);

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$query = '${safeQuery}'
if (-not $query) {
  @() | ConvertTo-Json -Depth 3
  return
}

$tokens = $query.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
$firstToken = if ($tokens.Count -gt 0) { $tokens[0] } else { $query }

$roots = @(
  "$env:LOCALAPPDATA\\Programs",
  "$env:ProgramFiles",
  "\${env:ProgramFiles(x86)}",
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
) | Where-Object { $_ -and (Test-Path $_) }

$shell = $null
$results = New-Object System.Collections.Generic.List[object]
$maxPerRoot = 250
$maxTotal = ${safeLimit}

foreach ($root in $roots) {
  if ($results.Count -ge $maxTotal) {
    break
  }

  $candidates = Get-ChildItem -Path $root -Recurse -File -Filter "*$firstToken*" -ErrorAction SilentlyContinue |
    Where-Object {
      $ext = $_.Extension.ToLowerInvariant()
      if ($ext -notin '.exe', '.cmd', '.bat', '.com', '.lnk') {
        return $false
      }

      $name = $_.BaseName.ToLowerInvariant()
      foreach ($token in $tokens) {
        if (-not $name.Contains($token)) {
          return $false
        }
      }

      return $true
    } | Select-Object -First $maxPerRoot

  foreach ($item in $candidates) {
    if ($results.Count -ge $maxTotal) {
      break
    }

    $launchPath = [string]$item.FullName
    $arguments = ''

    if ($item.Extension -ieq '.lnk') {
      try {
        if (-not $shell) {
          $shell = New-Object -ComObject WScript.Shell
        }
        $shortcut = $shell.CreateShortcut($item.FullName)
        if ($shortcut -and $shortcut.TargetPath) {
          $launchPath = [string]$shortcut.TargetPath
          $arguments = [string]$shortcut.Arguments
        }
      } catch {}
    }

    if (-not $launchPath) {
      continue
    }

    $results.Add([PSCustomObject]@{
      Name = [string]$item.BaseName
      LaunchPath = $launchPath
      MatchPath = [string]$item.FullName
      Extension = [string]$item.Extension
      Arguments = $arguments
      Root = [string]$root
    }) | Out-Null
  }
}

$results | Select-Object -First $maxTotal | ConvertTo-Json -Depth 6
`;

  const rows = await runPowerShellJson(script, 180000);

  return rows
    .map((row, index) => {
      const name = String(row.Name || "").trim();
      const launchPath = parseCommandPath(row.LaunchPath);
      if (!name || !launchPath) {
        return null;
      }

      const executableName = path.basename(launchPath);

      return {
        id: `deep-scan:${slug(`${name}-${launchPath}`)}:${index}`,
        name,
        source: "deep_scan",
        matchPath: String(row.MatchPath || "").trim() || undefined,
        extension: String(row.Extension || "").trim() || undefined,
        launchArguments: String(row.Arguments || "").trim() || undefined,
        searchRoot: String(row.Root || "").trim() || undefined,
        executableName: executableName || undefined,
        aliases: uniqueStrings([name, executableName, executableName.replace(/\.(exe|cmd|bat|com)$/i, "")]),
        launch: {
          mode: "path",
          value: launchPath
        }
      };
    })
    .filter(Boolean);
}

async function safeList(fn) {
  try {
    return await fn();
  } catch {
    return [];
  }
}

function dedupeApps(apps) {
  const seen = new Set();
  const results = [];

  for (const app of apps) {
    const launchKey = app.launch ? `${app.launch.mode}:${normalizeQuery(app.launch.value)}` : "";
    const key = `${normalizeMatchText(app.name)}|${launchKey}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(app);
  }

  return results;
}

function sourceBoost(source) {
  const boosts = {
    common: 18,
    startapps: 16,
    app_paths: 14,
    shortcuts: 12,
    registry: 10,
    path: 8,
    deep_scan: 6
  };

  return boosts[source] || 0;
}

function buildAppSearchText(app) {
  return normalizeMatchText(
    [
      app.name,
      app.id,
      app.source,
      app.publisher,
      app.version,
      app.appId,
      app.executableName,
      ...(Array.isArray(app.aliases) ? app.aliases : [])
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function scoreAppMatch(app, query) {
  const normalizedQuery = normalizeMatchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const queryTokens = tokenizeMatchText(normalizedQuery);
  const name = normalizeMatchText(app.name);
  const executableName = normalizeMatchText(app.executableName);
  const aliases = (Array.isArray(app.aliases) ? app.aliases : []).map((item) => normalizeMatchText(item));
  const searchText = buildAppSearchText(app);

  if (!searchText) {
    return 0;
  }

  let score = 0;
  let matched = false;

  if (name === normalizedQuery) {
    score += 220;
    matched = true;
  } else if (executableName === normalizedQuery || aliases.includes(normalizedQuery)) {
    score += 210;
    matched = true;
  } else if (name.startsWith(normalizedQuery)) {
    score += 180;
    matched = true;
  } else if (searchText.includes(normalizedQuery)) {
    score += 130;
    matched = true;
  }

  let tokenHits = 0;
  for (const token of queryTokens) {
    if (token && searchText.includes(token)) {
      tokenHits += 1;
    }
  }

  if (tokenHits > 0) {
    score += tokenHits * 15;
    matched = true;
    if (queryTokens.length > 0 && tokenHits === queryTokens.length) {
      score += 35;
    }
  }

  if (!matched) {
    return 0;
  }

  score += sourceBoost(app.source);

  return score;
}

function rankApps(apps, query) {
  const ranked = apps
    .map((app) => ({
      app,
      score: scoreAppMatch(app, query)
    }))
    .filter((item) => item.score > 0);

  ranked.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    return left.app.name.localeCompare(right.app.name);
  });

  return ranked;
}

function filterApps(apps, query, limit) {
  const normalizedQuery = normalizeMatchText(query);

  if (!normalizedQuery) {
    return apps.slice(0, limit);
  }

  const ranked = rankApps(apps, normalizedQuery);
  return ranked.slice(0, limit).map((item) => ({
    ...item.app,
    matchScore: item.score
  }));
}

function simplifyCandidates(ranked, max = 10) {
  return ranked.slice(0, max).map((item) => ({
    id: item.app.id,
    name: item.app.name,
    source: item.app.source,
    matchScore: item.score,
    appId: item.app.appId || undefined
  }));
}

async function listWindowsInventory({ refresh = false } = {}) {
  const shouldRefresh = parseBooleanInput(refresh, false);
  const now = Date.now();

  if (
    !shouldRefresh &&
    windowsInventoryCache.apps.length > 0 &&
    now - windowsInventoryCache.updatedAt < WINDOWS_INVENTORY_CACHE_TTL_MS
  ) {
    return windowsInventoryCache.apps;
  }

  if (windowsInventoryPromise) {
    return windowsInventoryPromise;
  }

  windowsInventoryPromise = (async () => {
    const [startApps, registryApps, appPathApps, shortcutApps, pathApps] = await Promise.all([
      safeList(listWindowsStartApps),
      safeList(listWindowsRegistryApps),
      safeList(listWindowsAppPathApps),
      safeList(listWindowsShortcutApps),
      safeList(listWindowsPathApps)
    ]);

    const merged = dedupeApps([...startApps, ...shortcutApps, ...appPathApps, ...registryApps, ...pathApps, ...listCommonApps()]);
    merged.sort((a, b) => a.name.localeCompare(b.name));

    windowsInventoryCache = {
      updatedAt: Date.now(),
      apps: merged
    };

    return merged;
  })();

  try {
    return await windowsInventoryPromise;
  } finally {
    windowsInventoryPromise = null;
  }
}

async function listInstalledApps(input = {}) {
  const limit = toPositiveInt(input.limit, 200, 10000);
  const query = input.query;
  const refresh = parseBooleanInput(input.refresh, false);
  const deepScan = parseBooleanInput(input.deepScan, true);

  let apps = [...listCommonApps()];

  if (process.platform === "win32") {
    apps = await listWindowsInventory({ refresh });
  } else {
    apps = dedupeApps(apps);
    apps.sort((a, b) => a.name.localeCompare(b.name));
  }

  let filtered = filterApps(apps, query, limit);
  let deepScanUsed = false;

  if (process.platform === "win32" && deepScan && normalizeMatchText(query) && filtered.length === 0) {
    deepScanUsed = true;
    const deepLimit = Math.max(limit * 3, 120);
    const deepApps = await safeList(() => listWindowsDeepSearchApps(query, deepLimit));

    if (deepApps.length > 0) {
      apps = dedupeApps([...apps, ...deepApps]);
      apps.sort((a, b) => a.name.localeCompare(b.name));
      filtered = filterApps(apps, query, limit);
    }
  }

  return {
    action: "installed",
    platform: process.platform,
    total: apps.length,
    returned: filtered.length,
    query: query || undefined,
    refreshed: refresh || undefined,
    deepScanUsed: deepScanUsed || undefined,
    apps: filtered
  };
}

async function openDesktopTarget(target, args) {
  if (!target) {
    throw new Error("desktop open action requires 'target'");
  }

  const command = buildOpenCommand(target, args);
  const child = spawn(command, {
    detached: true,
    stdio: "ignore",
    shell: true
  });

  child.unref();

  return {
    ok: true,
    action: "open",
    target,
    args: parseArrayJson(args)
  };
}

function openStartAppId(appId) {
  return new Promise((resolve, reject) => {
    const sanitized = String(appId).replace(/"/g, "`");
    const script = `Start-Process "shell:AppsFolder\\${sanitized}"`;

    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    child.on("error", reject);
    child.unref();

    resolve({
      ok: true,
      action: "open-installed",
      mode: "startAppId",
      appId
    });
  });
}

function resolveAppMatch(apps, { id, appId, appName }) {
  const normalizedId = normalizeQuery(id);
  const normalizedAppId = normalizeQuery(appId);
  const normalizedName = normalizeMatchText(appName);

  if (normalizedId) {
    const byId = apps.find((app) => normalizeQuery(app.id) === normalizedId);
    if (byId) {
      return { matched: byId };
    }
  }

  if (normalizedAppId) {
    const byAppId = apps.find((app) => normalizeQuery(app.appId) === normalizedAppId);
    if (byAppId) {
      return { matched: byAppId };
    }
  }

  if (normalizedName) {
    const exact = apps.filter((app) => normalizeMatchText(app.name) === normalizedName);
    if (exact.length === 1) {
      return { matched: exact[0] };
    }

    const ranked = rankApps(apps, normalizedName);
    if (!ranked.length) {
      return {
        matched: null,
        candidates: []
      };
    }

    const [best, second] = ranked;

    if (best.score >= 200) {
      return { matched: best.app };
    }

    if (!second && best.score >= 120) {
      return { matched: best.app };
    }

    if (best.score >= 150 && best.score - second.score >= 18) {
      return { matched: best.app };
    }

    return {
      matched: null,
      candidates: simplifyCandidates(ranked, 10)
    };
  }

  return {
    matched: null,
    candidates: []
  };
}

async function openInstalledApp(input = {}) {
  if (process.platform !== "win32") {
    throw new Error("open-installed currently supports Windows only");
  }

  const refresh = parseBooleanInput(input.refresh, false);
  const deepScan = parseBooleanInput(input.deepScan, true);

  const fullList = await listInstalledApps({
    limit: 10000,
    refresh,
    deepScan: false
  });

  let resolution = resolveAppMatch(fullList.apps, {
    id: input.id,
    appId: input.appId,
    appName: input.appName
  });

  if (!resolution.matched && input.appName && deepScan) {
    const queryList = await listInstalledApps({
      query: input.appName,
      limit: 250,
      refresh: true,
      deepScan: true
    });

    resolution = resolveAppMatch(queryList.apps, {
      id: input.id,
      appId: input.appId,
      appName: input.appName
    });
  }

  const matched = resolution.matched;
  if (!matched) {
    const candidates = resolution.candidates || [];
    const candidateText = candidates.length ? ` Candidates: ${JSON.stringify(candidates)}` : "";
    throw new Error(
      `No installed app matched the provided id/appId/appName.${candidateText}`
    );
  }

  let openResult;

  if (matched.launch?.mode === "startAppId" && matched.appId) {
    openResult = await openStartAppId(matched.appId);
  } else if (matched.launch?.value) {
    openResult = await openDesktopTarget(matched.launch.value, input.args);
  } else {
    openResult = await openDesktopTarget(matched.name, input.args);
  }

  return {
    ...openResult,
    matchedApp: {
      id: matched.id,
      name: matched.name,
      source: matched.source,
      appId: matched.appId || undefined,
      launch: matched.launch || undefined
    }
  };
}

async function runShellCommand(command, timeoutMs) {
  if (!config.desktop.allowShell) {
    throw new Error(
      "Shell command execution is disabled. Set DESKTOP_ALLOW_SHELL=true in .env to allow full desktop shell control. For local folder creation use desktop action=mkdir."
    );
  }

  if (!command || typeof command !== "string") {
    throw new Error("desktop shell action requires 'command'");
  }

  const timeout = Math.max(1000, Math.min(180000, Number(timeoutMs) || 30000));

  const result = await execAsync(command, {
    timeout,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });

  return {
    ok: true,
    action: "shell",
    command,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

async function createDirectory(input = {}) {
  const targetPath = resolveDirectoryTarget(input);
  const recursive = parseBooleanInput(input.recursive, true);

  let existedBefore = true;
  try {
    const stat = await fs.stat(targetPath);
    existedBefore = stat.isDirectory();
  } catch {
    existedBefore = false;
  }

  await fs.mkdir(targetPath, { recursive });

  return {
    ok: true,
    action: "mkdir",
    path: targetPath,
    existedBefore,
    created: !existedBefore,
    base: normalizeBaseName(input.base)
  };
}

export async function runDesktopTask(input = {}) {
  const action = input.action || "apps";

  if (action === "apps") {
    return {
      action,
      apps: listCommonApps()
    };
  }

  if (action === "installed" || action === "find") {
    return listInstalledApps({
      query: input.query,
      limit: input.limit,
      refresh: input.refresh,
      deepScan: input.deepScan
    });
  }

  if (action === "open-installed") {
    return openInstalledApp({
      id: input.id,
      appId: input.appId,
      appName: input.appName,
      args: input.args,
      refresh: input.refresh,
      deepScan: input.deepScan
    });
  }

  if (action === "open") {
    if (input.id || input.appId || input.appName) {
      try {
        return await openInstalledApp({
          id: input.id,
          appId: input.appId,
          appName: input.appName,
          args: input.args,
          refresh: input.refresh,
          deepScan: input.deepScan
        });
      } catch (error) {
        const fallbackTarget = String(input.target || input.appName || "").trim();
        if (!input.id && !input.appId && fallbackTarget) {
          const fallbackResult = await openDesktopTarget(fallbackTarget, input.args);
          return {
            ...fallbackResult,
            fallback: {
              mode: "direct-target",
              reason: error.message || "No installed match found",
              target: fallbackTarget
            }
          };
        }

        throw error;
      }
    }

    return openDesktopTarget(input.target, input.args);
  }

  if (action === "shell") {
    return runShellCommand(input.command || input.target, input.timeoutMs);
  }

  if (action === "mkdir" || action === "create-dir") {
    return createDirectory(input);
  }

  throw new Error(`Unsupported desktop action: ${action}`);
}

export const desktopTool = {
  name: "desktop",
  description:
    "Bilgisayardaki programlari listeler, arar ve acabilir; ayrica shell olmadan klasor olusturabilir. Input: { action: apps|installed|find|open|open-installed|mkdir|shell, query?, id?, appName?, appId?, target?, path?, name?, base?, refresh?, deepScan? }",
  async run(input) {
    return runDesktopTask(input);
  }
};
