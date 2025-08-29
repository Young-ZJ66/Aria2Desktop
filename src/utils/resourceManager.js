"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceManager = void 0;
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
/**
 * 资源管理器 - 处理内置 Aria2 资源文件
 */
class ResourceManager {
    constructor() {
        // 获取资源路径 - 简化结构，Aria2 文件直接放在应用目录
        if (electron_1.app.isPackaged) {
            // 生产环境：从应用安装目录
            this.resourcesPath = (0, path_1.join)(process.execPath, '..');
        }
        else {
            // 开发环境：从项目根目录的 resources 目录
            this.resourcesPath = (0, path_1.join)(electron_1.app.getAppPath(), 'resources');
        }
        // 用户数据目录 - 使用安装目录的 data 文件夹
        const appDirectory = electron_1.app.isPackaged
            ? (0, path_1.join)(process.execPath, '..')
            : process.cwd();
        this.userDataPath = (0, path_1.join)(appDirectory, 'data', 'aria2');
        console.log('ResourceManager initialized:', {
            resourcesPath: this.resourcesPath,
            userDataPath: this.userDataPath,
            appDirectory,
            isPackaged: electron_1.app.isPackaged
        });
    }
    static getInstance() {
        if (!ResourceManager.instance) {
            ResourceManager.instance = new ResourceManager();
        }
        return ResourceManager.instance;
    }
    /**
     * 确保用户数据目录存在
     */
    ensureUserDataDir() {
        if (!(0, fs_1.existsSync)(this.userDataPath)) {
            (0, fs_1.mkdirSync)(this.userDataPath, { recursive: true });
            console.log('Created user data directory:', this.userDataPath);
        }
    }
    /**
     * 获取 Aria2 可执行文件路径
     */
    getAria2ExecutablePath() {
        const executableName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
        // 直接从应用安装目录查找 aria2c.exe
        const bundledExecutable = (0, path_1.join)(this.resourcesPath, executableName);
        if ((0, fs_1.existsSync)(bundledExecutable)) {
            console.log('Found bundled Aria2 executable:', bundledExecutable);
            return bundledExecutable;
        }
        // 如果内置资源不存在，尝试用户数据目录
        this.ensureUserDataDir();
        const userExecutable = (0, path_1.join)(this.userDataPath, executableName);
        if ((0, fs_1.existsSync)(userExecutable)) {
            console.log('Found user Aria2 executable:', userExecutable);
            return userExecutable;
        }
        // 都不存在，返回用户数据目录路径（供后续下载使用）
        console.log('No Aria2 executable found, will use:', userExecutable);
        return userExecutable;
    }
    /**
     * 检查 Aria2 是否可用
     */
    isAria2Available() {
        const executablePath = this.getAria2ExecutablePath();
        const available = (0, fs_1.existsSync)(executablePath);
        console.log('Aria2 availability check:', { executablePath, available });
        return available;
    }
    /**
     * 获取配置文件路径
     */
    getConfigFilePath() {
        this.ensureUserDataDir();
        return (0, path_1.join)(this.userDataPath, 'aria2.conf');
    }
    /**
     * 获取会话文件路径
     */
    getSessionFilePath() {
        this.ensureUserDataDir();
        return (0, path_1.join)(this.userDataPath, 'aria2.session');
    }
    /**
     * 复制默认配置文件（如果存在）
     */
    copyDefaultConfigIfNeeded() {
        const sourceConfig = (0, path_1.join)(this.resourcesPath, 'aria2.conf');
        const targetConfig = this.getConfigFilePath();
        // 如果目标配置文件已存在，不覆盖
        if ((0, fs_1.existsSync)(targetConfig)) {
            console.log('Config file already exists:', targetConfig);
            return true;
        }
        // 如果源配置文件存在，复制它
        if ((0, fs_1.existsSync)(sourceConfig)) {
            try {
                (0, fs_1.copyFileSync)(sourceConfig, targetConfig);
                console.log('Copied default config file:', sourceConfig, '→', targetConfig);
                return true;
            }
            catch (error) {
                console.error('Failed to copy default config file:', error);
                return false;
            }
        }
        console.log('No default config file to copy');
        return false;
    }
    /**
     * 复制默认会话文件（如果存在）
     */
    copyDefaultSessionIfNeeded() {
        const sourceSession = (0, path_1.join)(this.resourcesPath, 'aria2.session');
        const targetSession = this.getSessionFilePath();
        // 如果目标会话文件已存在，不覆盖
        if ((0, fs_1.existsSync)(targetSession)) {
            console.log('Session file already exists:', targetSession);
            return true;
        }
        // 如果源会话文件存在，复制它
        if ((0, fs_1.existsSync)(sourceSession)) {
            try {
                (0, fs_1.copyFileSync)(sourceSession, targetSession);
                console.log('Copied default session file:', sourceSession, '→', targetSession);
                return true;
            }
            catch (error) {
                console.error('Failed to copy default session file:', error);
                return false;
            }
        }
        console.log('No default session file to copy');
        return false;
    }
    /**
     * 初始化资源文件
     */
    initializeResources() {
        console.log('Initializing Aria2 resources...');
        // 确保用户数据目录存在
        this.ensureUserDataDir();
        // 复制默认文件
        this.copyDefaultConfigIfNeeded();
        this.copyDefaultSessionIfNeeded();
        const result = {
            executablePath: this.getAria2ExecutablePath(),
            configPath: this.getConfigFilePath(),
            sessionPath: this.getSessionFilePath(),
            isAria2Available: this.isAria2Available()
        };
        console.log('Resource initialization result:', result);
        return result;
    }
    /**
     * 获取资源信息
     */
    getResourceInfo() {
        return {
            resourcesPath: this.resourcesPath,
            userDataPath: this.userDataPath,
            platformResourcePath: this.getPlatformResourcePath(),
            isPackaged: electron_1.app.isPackaged
        };
    }
}
exports.ResourceManager = ResourceManager;
ResourceManager.instance = null;
