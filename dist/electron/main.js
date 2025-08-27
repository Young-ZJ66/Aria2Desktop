"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = require("path");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// import { electronApp, optimizer, is } from '@electron-toolkit/utils'
const electron_store_1 = __importDefault(require("electron-store"));
// 初始化配置存储
const store = new electron_store_1.default();
let mainWindow = null;
let tray = null;
function createWindow() {
    console.log('Creating main window...');
    // 创建主窗口
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        show: true,
        autoHideMenuBar: false,
        center: true,
        resizable: true,
        icon: (0, path_1.join)(__dirname, '../../build/Aria2.ico'),
        webPreferences: {
            preload: (0, path_1.join)(__dirname, 'preload.js'),
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.on('ready-to-show', () => {
        console.log('Window ready to show');
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.setAlwaysOnTop(true);
        setTimeout(() => {
            mainWindow?.setAlwaysOnTop(false);
        }, 1000);
        console.log('Window shown and focused');
    });
    mainWindow.webContents.setWindowOpenHandler((details) => {
        electron_1.shell.openExternal(details.url);
        return { action: 'deny' };
    });
    // 开发环境加载本地服务器，生产环境加载打包文件
    console.log('Loading URL...');
    if (process.env.NODE_ENV === 'development') {
        console.log('Loading development URL: http://localhost:5173');
        mainWindow.loadURL('http://localhost:5173');
    }
    else {
        console.log('Loading production file');
        mainWindow.loadFile((0, path_1.join)(__dirname, '../vue/index.html'));
    }
    // 窗口关闭时的处理
    mainWindow.on('close', (event) => {
        if (process.env.NODE_ENV === 'development') {
            // 开发模式下直接退出
            electron_1.app.quit();
        }
        else if (!electron_1.app.isQuiting) {
            // 生产模式下最小化到托盘
            event.preventDefault();
            mainWindow?.hide();
        }
    });
}
function createTray() {
    tray = new electron_1.Tray((0, path_1.join)(__dirname, '../../build/icon.png'));
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                mainWindow?.show();
            }
        },
        {
            label: '退出',
            click: () => {
                electron_1.app.isQuiting = true;
                electron_1.app.quit();
            }
        }
    ]);
    tray.setToolTip('Aria2 Desktop');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
        mainWindow?.show();
    });
}
// 应用准备就绪
electron_1.app.whenReady().then(() => {
    console.log('App ready, creating window...');
    // 设置应用用户模型ID (Windows)
    // electronApp.setAppUserModelId('com.aria2desktop.app')
    // 开发环境下的默认打开或关闭DevTools快捷键
    // app.on('browser-window-created', (_, window) => {
    //   optimizer.watchWindowShortcuts(window)
    // })
    createWindow();
    // createTray() // 暂时禁用托盘功能
    electron_1.app.on('activate', function () {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
// 所有窗口关闭时退出应用 (macOS除外)
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// IPC通信处理
electron_1.ipcMain.handle('get-app-version', () => {
    return electron_1.app.getVersion();
});
electron_1.ipcMain.handle('get-store-value', (_, key) => {
    return store.get(key);
});
electron_1.ipcMain.handle('set-store-value', (_, key, value) => {
    store.set(key, value);
});
electron_1.ipcMain.handle('show-save-dialog', async (_, options) => {
    const result = await electron_1.dialog.showSaveDialog(mainWindow, options);
    return result;
});
electron_1.ipcMain.handle('show-open-dialog', async (_, options) => {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, options);
    return result;
});
electron_1.ipcMain.handle('show-item-in-folder', async (_, filePath) => {
    try {
        console.log('Attempting to show item in folder:', filePath);
        // 规范化路径
        const normalizedPath = path.normalize(filePath);
        console.log('Normalized path:', normalizedPath);
        // 检查路径是否存在
        if (!fs.existsSync(normalizedPath)) {
            console.error('Path does not exist:', normalizedPath);
            return { success: false, error: '路径不存在' };
        }
        // 使用 shell.showItemInFolder
        electron_1.shell.showItemInFolder(normalizedPath);
        console.log('Successfully called shell.showItemInFolder');
        return { success: true };
    }
    catch (error) {
        console.error('Failed to show item in folder:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('open-path', async (_, filePath) => {
    try {
        console.log('Attempting to open path:', filePath);
        // 规范化路径
        const normalizedPath = path.normalize(filePath);
        console.log('Normalized path:', normalizedPath);
        // 检查路径是否存在
        if (!fs.existsSync(normalizedPath)) {
            console.error('Path does not exist:', normalizedPath);
            return { success: false, error: '路径不存在' };
        }
        // 检查是否为目录
        const stats = fs.statSync(normalizedPath);
        if (stats.isDirectory()) {
            // 对于目录，首先尝试 shell.openPath
            const result = await electron_1.shell.openPath(normalizedPath);
            if (result) {
                console.log('shell.openPath failed, trying alternative method:', result);
                // 如果失败，尝试使用 Windows explorer 命令
                if (process.platform === 'win32') {
                    const { spawn } = require('child_process');
                    try {
                        spawn('explorer', [normalizedPath], { detached: true });
                        console.log('Successfully opened with explorer command');
                        return { success: true, method: 'explorer' };
                    }
                    catch (explorerError) {
                        console.error('Explorer command failed:', explorerError);
                        // 最后尝试 showItemInFolder
                        electron_1.shell.showItemInFolder(normalizedPath);
                        return { success: true, method: 'showItemInFolder' };
                    }
                }
                else {
                    electron_1.shell.showItemInFolder(normalizedPath);
                    return { success: true, method: 'showItemInFolder' };
                }
            }
            return { success: true, method: 'openPath' };
        }
        else {
            // 对于文件，使用 shell.showItemInFolder
            electron_1.shell.showItemInFolder(normalizedPath);
            return { success: true, method: 'showItemInFolder' };
        }
    }
    catch (error) {
        console.error('Failed to open path:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// 专门用于 Windows 的资源管理器打开方法
electron_1.ipcMain.handle('open-in-explorer', async (_, filePath) => {
    try {
        console.log('Opening in Windows Explorer:', filePath);
        if (process.platform !== 'win32') {
            return { success: false, error: '此方法仅支持 Windows' };
        }
        const normalizedPath = path.normalize(filePath);
        console.log('Normalized path for explorer:', normalizedPath);
        if (!fs.existsSync(normalizedPath)) {
            return { success: false, error: '路径不存在' };
        }
        const { spawn } = require('child_process');
        const stats = fs.statSync(normalizedPath);
        if (stats.isDirectory()) {
            // 打开目录
            spawn('explorer', [normalizedPath], { detached: true, stdio: 'ignore' });
        }
        else {
            // 选中文件
            spawn('explorer', ['/select,', normalizedPath], { detached: true, stdio: 'ignore' });
        }
        console.log('Successfully launched Windows Explorer');
        return { success: true, method: 'windows-explorer' };
    }
    catch (error) {
        console.error('Failed to open in Windows Explorer:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// 删除文件或目录
electron_1.ipcMain.handle('delete-files', async (_, filePaths) => {
    try {
        console.log('Attempting to delete files:', filePaths);
        const results = [];
        for (const filePath of filePaths) {
            try {
                const normalizedPath = path.normalize(filePath);
                console.log('Deleting:', normalizedPath);
                if (fs.existsSync(normalizedPath)) {
                    const stats = fs.statSync(normalizedPath);
                    if (stats.isDirectory()) {
                        // 删除目录
                        fs.rmSync(normalizedPath, { recursive: true, force: true });
                    }
                    else {
                        // 删除文件
                        fs.unlinkSync(normalizedPath);
                    }
                    results.push({ path: filePath, success: true });
                    console.log('Successfully deleted:', normalizedPath);
                }
                else {
                    results.push({ path: filePath, success: false, error: '文件不存在' });
                    console.log('File does not exist:', normalizedPath);
                }
            }
            catch (error) {
                results.push({ path: filePath, success: false, error: error instanceof Error ? error.message : String(error) });
                console.error('Failed to delete file:', filePath, error);
            }
        }
        return { success: true, results };
    }
    catch (error) {
        console.error('Failed to delete files:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
