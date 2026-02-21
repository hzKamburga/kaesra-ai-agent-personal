/* ═══════════════════════════════════════════════════════
   KAESRA AI AGENT — Electron Main Process
   Premium Terminal-Style Desktop Application
   ═══════════════════════════════════════════════════════ */

import { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuiServer } from "../gui/server.js";
import { config } from "../core/config.js";
import { createProvider } from "../llm/providerFactory.js";
import { logger } from "../core/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;
let tray = null;
let guiServer = null;

// ── Provider Factory (shared with GUI server) ───────────
let cachedProvider = null;

function getProvider(required = false) {
    if (cachedProvider) return cachedProvider;
    try {
        cachedProvider = createProvider(config);
        return cachedProvider;
    } catch (err) {
        if (required) throw err;
        return null;
    }
}

// ── Window Configuration ────────────────────────────────
function createWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    const winWidth = Math.min(Math.round(screenWidth * 0.85), 1440);
    const winHeight = Math.min(Math.round(screenHeight * 0.85), 900);

    mainWindow = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        minWidth: 800,
        minHeight: 540,
        x: Math.round((screenWidth - winWidth) / 2),
        y: Math.round((screenHeight - winHeight) / 2),
        frame: false,
        transparent: false,
        backgroundColor: "#0a0e17",
        titleBarStyle: "hidden",
        titleBarOverlay: false,
        show: false,
        icon: path.join(__dirname, "..", "gui", "public", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webviewTag: false,
            spellcheck: false
        }
    });

    // ── Load GUI from embedded server ─────────────────────
    const guiUrl = "http://127.0.0.1:3939";
    mainWindow.loadURL(guiUrl);

    // ── Smooth appearance ────────────────────────────────
    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // ── Window Events ────────────────────────────────────
    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    mainWindow.on("maximize", () => {
        mainWindow.webContents.send("window-state", "maximized");
    });

    mainWindow.on("unmaximize", () => {
        mainWindow.webContents.send("window-state", "normal");
    });

    mainWindow.on("focus", () => {
        mainWindow.webContents.send("window-focus", true);
    });

    mainWindow.on("blur", () => {
        mainWindow.webContents.send("window-focus", false);
    });

    // ── DevTools in dev ──────────────────────────────────
    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: "detach" });
    }
}

// ── IPC Handlers ────────────────────────────────────────
function setupIPC() {
    ipcMain.handle("window:minimize", () => {
        mainWindow?.minimize();
    });

    ipcMain.handle("window:maximize", () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });

    ipcMain.handle("window:close", () => {
        mainWindow?.close();
    });

    ipcMain.handle("window:isMaximized", () => {
        return mainWindow?.isMaximized() ?? false;
    });

    ipcMain.handle("app:getVersion", () => {
        return app.getVersion();
    });

    ipcMain.handle("app:getPlatform", () => {
        return process.platform;
    });
}

// ── App Menu ────────────────────────────────────────────
function setupMenu() {
    const template = [
        {
            label: "Kaesra",
            submenu: [
                {
                    label: "Hakkında",
                    click: () => {
                        const { dialog } = require("electron");
                        dialog.showMessageBox(mainWindow, {
                            type: "info",
                            title: "Kaesra AI Agent",
                            message: "Kaesra AI Agent v1.0.0",
                            detail: "Node.js AI Agent — Research, Automation, Orchestration\n© 2026 Kaesra"
                        });
                    }
                },
                { type: "separator" },
                { label: "Ayarlar", accelerator: "CmdOrCtrl+,", enabled: false },
                { type: "separator" },
                { role: "quit", label: "Çıkış" }
            ]
        },
        {
            label: "Düzen",
            submenu: [
                { role: "undo", label: "Geri Al" },
                { role: "redo", label: "Yinele" },
                { type: "separator" },
                { role: "cut", label: "Kes" },
                { role: "copy", label: "Kopyala" },
                { role: "paste", label: "Yapıştır" },
                { role: "selectAll", label: "Tümünü Seç" }
            ]
        },
        {
            label: "Görünüm",
            submenu: [
                { role: "reload", label: "Yenile" },
                { role: "forceReload", label: "Zorla Yenile" },
                { role: "toggleDevTools", label: "Geliştirici Araçları" },
                { type: "separator" },
                { role: "resetZoom", label: "Orijinal Boyut" },
                { role: "zoomIn", label: "Yakınlaştır" },
                { role: "zoomOut", label: "Uzaklaştır" },
                { type: "separator" },
                { role: "togglefullscreen", label: "Tam Ekran" }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App Lifecycle ───────────────────────────────────────
app.whenReady().then(() => {
    // Start GUI backend server (API endpoints for chat/ask/research etc.)
    guiServer = startGuiServer({ host: "127.0.0.1", port: 3939, getProvider, config, logger });

    setupIPC();
    setupMenu();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

// ── Single Instance Lock ────────────────────────────────
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}
