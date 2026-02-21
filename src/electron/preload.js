/* ═══════════════════════════════════════════════════════
   KAESRA AI AGENT — Electron Preload Script
   Exposes safe APIs to the renderer process
   ═══════════════════════════════════════════════════════ */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // Window controls
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),

    // App info
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPlatform: () => ipcRenderer.invoke("app:getPlatform"),

    // Window state events
    onWindowState: (callback) => {
        ipcRenderer.on("window-state", (_event, state) => callback(state));
    },

    onWindowFocus: (callback) => {
        ipcRenderer.on("window-focus", (_event, focused) => callback(focused));
    }
});
