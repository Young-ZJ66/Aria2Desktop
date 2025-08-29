"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// 暴露给渲染进程的API
const electronAPI = {
    // 应用信息
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    // 数据存储
    getStoreValue: (key) => electron_1.ipcRenderer.invoke('get-store-value', key),
    setStoreValue: (key, value) => electron_1.ipcRenderer.invoke('set-store-value', key, value),
    // 文件对话框
    showSaveDialog: (options) => electron_1.ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => electron_1.ipcRenderer.invoke('show-open-dialog', options),
    // 文件系统操作
    showItemInFolder: (path) => electron_1.ipcRenderer.invoke('show-item-in-folder', path),
    openPath: (path) => electron_1.ipcRenderer.invoke('open-path', path),
    openInExplorer: (path) => electron_1.ipcRenderer.invoke('open-in-explorer', path),
    deleteFiles: (paths) => electron_1.ipcRenderer.invoke('delete-files', paths),
    // 托盘控制
    setTrayEnabled: (enabled) => electron_1.ipcRenderer.invoke('set-tray-enabled', enabled),
    // Aria2 进程管理
    aria2: {
        start: () => electron_1.ipcRenderer.invoke('aria2-start'),
        stop: () => electron_1.ipcRenderer.invoke('aria2-stop'),
        restart: () => electron_1.ipcRenderer.invoke('aria2-restart'),
        getStatus: () => electron_1.ipcRenderer.invoke('aria2-status'),
        updateConfig: (config) => electron_1.ipcRenderer.invoke('aria2-update-config', config)
    },
    // 平台信息
    platform: process.platform,
    // 窗口控制
    minimize: () => electron_1.ipcRenderer.send('window-minimize'),
    maximize: () => electron_1.ipcRenderer.send('window-maximize'),
    close: () => electron_1.ipcRenderer.send('window-close')
};
// 将API暴露给渲染进程
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
