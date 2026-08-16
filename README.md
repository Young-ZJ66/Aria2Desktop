# Aria2 Desktop

<div align="center">

![Aria2 Desktop](https://img.shields.io/badge/Aria2%20Desktop-v1.0.0-blue?style=for-the-badge)
![Electron](https://img.shields.io/badge/Electron-43.x-47848F?style=for-the-badge&logo=electron)
![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=for-the-badge&logo=vue.js)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=for-the-badge&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?style=for-the-badge&logo=vite)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**集成 Aria2 引擎的现代化桌面下载管理器**

[快速开始](#快速开始) • [功能特性](#功能特性) • [开发指南](#开发指南) • [贡献代码](#贡献)

</div>

## 项目简介

**Aria2 Desktop** 是一款基于 **Electron + Vue 3** 构建的桌面端 Aria2 下载管理器。它将 Aria2 引擎与可视化管理界面集成于一体，提供从引擎启停、任务调度到参数配置的一站式下载管理体验。

### 项目愿景

- **引擎内置**: 内置 Aria2 可执行文件，无需额外安装和命令行操作
- **可视化管理**: 实时监控下载速度、进度、连接数，支持任务的暂停/恢复/删除等操作
- **全协议支持**: HTTP/HTTPS、FTP、BitTorrent、磁力链接、Metalink 全覆盖
- **现代界面**: 基于 Vue 3 + Naive UI 的响应式界面，支持深色/浅色主题切换
- **深度配置**: 涵盖 RPC、BT、HTTP、FTP/SFTP、Metalink、安全等全维度 Aria2 参数配置

## 功能特性

### 核心亮点
- **引擎内置**: 内置 Aria2 可执行文件，应用启动即可使用
- **可视化管理**: 直观的下载任务管理界面，支持列表/详情视图
- **实时监控**: 下载速度、进度、连接数、Peer 信息实时展示
- **多协议支持**: HTTP/HTTPS、FTP、BitTorrent、磁力链接、Metalink 全支持

### 下载功能
- **多线程下载**: 最大化利用网络带宽
- **断点续传**: 下载中断后自动恢复
- **实时监控**: 下载速度、进度、连接数实时显示
- **速度控制**: 全局和单任务速度限制

### 界面体验
- **深色/浅色主题**: 支持主题切换，保护眼睛
- **响应式设计**: 适配不同窗口大小
- **多语言支持**: 中文、英文界面
- **系统通知**: 下载完成桌面提醒

### 系统集成
- **开机启动**: 支持系统启动时自动运行
- **配置持久化**: 基于 electron-store 的设置和任务数据自动保存
- **系统托盘**: 最小化到托盘，后台保持下载任务运行
- **断点续传**: 下载中断后自动恢复，支持会话保存

## 技术架构

| 技术栈 | 版本 | 用途 |
|--------|------|------|
| **Electron** | 43.x | 跨平台桌面应用框架 |
| **Vue.js** | 3.x | 响应式前端界面 |
| **Naive UI** | 2.x | UI 组件库 |
| **TypeScript** | 6.x | 类型安全开发 |
| **Vite** | 8.x | 前端构建工具 |
| **ECharts** | 6.x | 数据可视化图表 |
| **Pinia** | 3.x | 状态管理 |
| **vue-i18n** | 11.x | 国际化支持 |
| **Aria2** | 1.37.0 | 下载引擎核心 |

## 快速开始

### 下载安装包
前往 [Releases](../../releases) 页面下载最新版本

### 使用步骤
1. **安装运行**: 双击安装包，按提示完成安装
2. **启动应用**: 桌面双击图标启动
3. **添加下载**: 
   - 点击 "+" 按钮添加下载链接
   - 或直接拖拽链接到窗口
   - 支持批量添加多个链接
4. **管理任务**: 右键任务进行暂停、删除、优先级调整等操作

## 开发指南

### 环境要求
- **Node.js** 18.x 或更高版本
- **npm** 包管理器
- **Git** 版本控制工具

### 本地开发

```bash
# 克隆项目
git clone https://github.com/Young-ZJ66/Aria2Desktop.git
cd aria2-desktop

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 打包应用程序
npm run dist
```

### 项目结构
```
aria2-desktop/
├── src/                    # 渲染进程源代码
│   ├── components/         # Vue 组件
│   ├── views/             # 页面视图
│   ├── stores/            # Pinia 状态管理
│   ├── services/          # API 服务
│   ├── i18n/              # 国际化
│   ├── locales/           # 语言文件
│   └── utils/             # 工具函数
├── electron/              # Electron 主进程代码
│   ├── controllers/       # 控制器（窗口/托盘/Aria2/IPC/生命周期）
│   ├── managers/          # 进程管理
│   ├── types/             # 类型定义
│   └── utils/             # 工具函数
├── resources/             # 资源文件(Aria2 引擎等)
├── build/                 # 构建配置
└── dist/                  # 构建输出目录
```

## 贡献

我们欢迎所有形式的贡献！无论是报告 Bug、提出功能建议，还是提交代码改进。

### 贡献方式
1. **报告问题**: 在 [Issues](../../issues) 中提交 Bug 报告
2. **功能建议**: 提出新功能想法和改进建议
3. **代码贡献**: Fork 项目并提交 Pull Request
4. **文档完善**: 帮助改进项目文档

### 开发流程
1. Fork 本仓库到你的 GitHub 账号
2. 创建功能分支: `git checkout -b feature/amazing-feature`
3. 提交你的更改: `git commit -m 'Add amazing feature'`
4. 推送到分支: `git push origin feature/amazing-feature`
5. 创建 Pull Request

## 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 致谢

感谢以下开源项目为本项目提供的支持：

- [AriaNg](https://github.com/mayswind/AriaNg) - 现代化的 Aria2 Web 前端
- [Aria2](https://github.com/aria2/aria2) - 强大的命令行下载工具
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用开发框架
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Naive UI](https://www.naiveui.com/) - 基于 Vue.js 的组件库
- [ECharts](https://echarts.apache.org/) - 数据可视化图表库
- [Vite](https://vite.dev/) - 下一代前端构建工具

## 联系我们

- **邮箱**: 1600386893@qq.com
- **问题反馈**: [GitHub Issues](../../issues)

---

<div align="center">

**如果这个项目对你有帮助，请给个 Star 支持一下！**

</div>
