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
// 获取应用所在目录
const getAppDirectory = () => {
    if (electron_1.app.isPackaged) {
        // 生产环境：使用可执行文件所在目录
        return path.dirname(process.execPath);
    }
    else {
        // 开发环境：使用项目根目录
        return process.cwd();
    }
};
// 获取配置文件目录
const getConfigDirectory = () => {
    const appDir = getAppDirectory();
    const configDir = path.join(appDir, 'config');
    // 确保配置目录存在
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    return configDir;
};
// 初始化配置存储，设置存储路径为应用所在目录的 config 文件夹
const appDir = getAppDirectory();
const configDir = getConfigDirectory();
const store = new electron_store_1.default({
    cwd: configDir,
    name: 'aria2-desktop-settings' // 这将创建 aria2-desktop-settings.json 文件
});
console.log('App directory:', appDir);
console.log('Config directory:', configDir);
console.log('Config file path:', store.path);
let mainWindow = null;
let tray = null;
let hasShownTrayNotification = false;
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
        if (!electron_1.app.isQuiting) {
            // 检查是否启用了最小化到托盘功能
            const settings = store.get('settings', {});
            const minimizeToTray = settings.minimizeToTray !== false; // 默认启用
            console.log('Window close event:', {
                settings,
                minimizeToTray,
                hasTray: !!tray,
                isQuiting: electron_1.app.isQuiting,
                nodeEnv: process.env.NODE_ENV
            });
            if (minimizeToTray) {
                // 最小化到托盘（即使托盘还未创建，也先隐藏窗口）
                event.preventDefault();
                mainWindow?.hide();
                // 如果托盘还未创建，现在创建它
                if (!tray) {
                    createTray();
                }
                // 显示系统通知（首次最小化到托盘时）
                if (!hasShownTrayNotification && process.platform !== 'darwin') {
                    const { Notification } = require('electron');
                    if (Notification.isSupported()) {
                        new Notification({
                            title: 'Aria2 Desktop',
                            body: '应用已最小化到系统托盘，双击托盘图标可重新打开',
                            silent: true
                        }).show();
                        hasShownTrayNotification = true;
                    }
                }
            }
            else {
                // 直接退出
                electron_1.app.quit();
            }
        }
    });
}
function createTray() {
    // 使用 ico 文件作为托盘图标
    const iconPath = (0, path_1.join)(__dirname, '../../build/Aria2.ico');
    tray = new electron_1.Tray(iconPath);
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            }
        },
        {
            label: '隐藏窗口',
            click: () => {
                mainWindow?.hide();
            }
        },
        { type: 'separator' },
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
    // 双击托盘图标显示/隐藏窗口
    tray.on('double-click', () => {
        if (mainWindow?.isVisible()) {
            mainWindow.hide();
        }
        else {
            mainWindow?.show();
            mainWindow?.focus();
        }
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
    // 根据设置决定是否创建托盘
    const settings = store.get('settings', {});
    const minimizeToTray = settings.minimizeToTray !== false; // 默认启用
    if (minimizeToTray) {
        createTray();
    }
    electron_1.app.on('activate', function () {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
// 所有窗口关闭时的处理
electron_1.app.on('window-all-closed', () => {
    // 检查是否启用了托盘功能
    const settings = store.get('settings', {});
    const minimizeToTray = settings.minimizeToTray !== false; // 默认启用
    console.log('All windows closed:', { minimizeToTray, hasTray: !!tray, platform: process.platform });
    // 如果启用了托盘功能，不退出应用（让应用在后台运行）
    // 如果是 macOS 或者启用了托盘，不退出应用
    if (process.platform === 'darwin' || minimizeToTray) {
        // 不退出应用，让它在后台运行
        return;
    }
    // 其他情况下退出应用
    electron_1.app.quit();
});
// IPC通信处理
electron_1.ipcMain.handle('get-app-version', () => {
    return electron_1.app.getVersion();
});
// 托盘控制
electron_1.ipcMain.handle('set-tray-enabled', (_, enabled) => {
    if (enabled && !tray) {
        createTray();
    }
    else if (!enabled && tray) {
        tray.destroy();
        tray = null;
    }
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
