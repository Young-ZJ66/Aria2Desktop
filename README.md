# Aria2 Desktop

<div align="center">

![Aria2 Desktop](https://img.shields.io/badge/Aria2%20Desktop-v1.0.0-blue?style=for-the-badge)
![Electron](https://img.shields.io/badge/Electron-27.x-47848F?style=for-the-badge&logo=electron)
![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=for-the-badge&logo=vue.js)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**让小白也能一键使用强大的Aria2下载器！**

[快速开始](#-快速开始) • [功能特性](#-功能特性) • [开发指南](#-开发指南) • [贡献代码](#-贡献)

</div>

## 📖 项目简介

**Aria2 Desktop** 是基于 **Aria2** 下载引擎和 **AriaNg** Web界面进行的二次开发项目。我们的目标是开发一款集成Aria2服务和配置、下载可视化管理的现代化桌面客户端，**让小白用户也能一键配置和使用强大的Aria2下载器！**

### 🎯 项目愿景

- **🚀 开箱即用**: 无需复杂配置，一键启动即可使用
- **👥 用户友好**: 专为普通用户设计，告别命令行恐惧
- **⚡ 功能强大**: 保留Aria2的所有强大功能
- **🎨 界面现代**: 基于Vue.js + Element Plus的美观界面

## ✨ 功能特性

### 🔥 核心亮点
- ✅ **一键启动**: 内置Aria2引擎，无需单独安装配置
- ✅ **可视化管理**: 直观的下载任务管理界面
- ✅ **智能配置**: 自动优化下载参数，小白也能获得最佳体验
- ✅ **多协议支持**: HTTP/HTTPS、FTP、BitTorrent、磁力链接全支持

### 📥 下载功能
- 🚄 **多线程下载**: 最大化利用网络带宽
- 🔄 **断点续传**: 下载中断后自动恢复
- 📊 **实时监控**: 下载速度、进度、连接数实时显示
- 🎛️ **速度控制**: 全局和单任务速度限制

### 🎨 界面体验
- 🌙 **深色/浅色主题**: 支持主题切换，保护眼睛
- 📱 **响应式设计**: 适配不同窗口大小
- 🌐 **多语言支持**: 中文、英文界面
- 🔔 **系统通知**: 下载完成桌面提醒

### 🔧 系统集成
- 🔗 **浏览器集成**: 一键捕获浏览器下载链接
- 📁 **文件管理**: 下载完成快速打开文件/文件夹
- 🚀 **开机启动**: 支持系统启动时自动运行
- 💾 **配置备份**: 设置和任务数据自动保存

## 🛠️ 技术架构

| 技术栈 | 版本 | 用途 |
|--------|------|------|
| **Electron** | 27.x | 跨平台桌面应用框架 |
| **Vue.js** | 3.x | 响应式前端界面 |
| **Element Plus** | 2.x | UI组件库 |
| **TypeScript** | 5.x | 类型安全开发 |
| **Aria2** | 1.36+ | 下载引擎核心 |
| **AriaNg** | Latest | Web管理界面基础 |

## 🚀 快速开始

### 💾 下载安装包
前往 [Releases](../../releases) 页面下载最新版本

### 🎮 使用步骤
1. **安装运行**: 双击安装包，按提示完成安装
2. **启动应用**: 桌面双击图标启动
3. **添加下载**: 
   - 点击 "+" 按钮添加下载链接
   - 或直接拖拽链接到窗口
   - 支持批量添加多个链接
4. **管理任务**: 右键任务进行暂停、删除、优先级调整等操作

## 🔧 开发指南

### 环境要求
- **Node.js** 16.x 或更高版本
- **npm** 或 **yarn** 包管理器
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
├── src/                    # 源代码目录
│   ├── components/         # Vue组件
│   ├── views/             # 页面视图
│   ├── stores/            # Pinia状态管理
│   ├── services/          # API服务
│   └── utils/             # 工具函数
├── electron/              # Electron主进程代码
├── resources/             # 资源文件(Aria2引擎等)
├── build/                 # 构建配置
└── dist/                  # 构建输出目录
```

## 🤝 贡献

我们欢迎所有形式的贡献！无论是报告Bug、提出功能建议，还是提交代码改进。

### 贡献方式
1. 🐛 **报告问题**: 在 [Issues](../../issues) 中提交Bug报告
2. 💡 **功能建议**: 提出新功能想法和改进建议
3. 🔧 **代码贡献**: Fork项目并提交Pull Request
4. 📖 **文档完善**: 帮助改进项目文档

### 开发流程
1. Fork 本仓库到你的GitHub账号
2. 创建功能分支: `git checkout -b feature/amazing-feature`
3. 提交你的更改: `git commit -m 'Add amazing feature'`
4. 推送到分支: `git push origin feature/amazing-feature`
5. 创建 Pull Request

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 🙏 致谢

感谢以下开源项目为本项目提供的支持：

- [Aria2](https://aria2.github.io/) - 强大的命令行下载工具
- [AriaNg](https://github.com/mayswind/AriaNg) - 现代化的Aria2 Web前端
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用开发框架
- [Vue.js](https://vuejs.org/) - 渐进式JavaScript框架
- [Element Plus](https://element-plus.org/) - 基于Vue.js的组件库

## 📞 联系我们

- 📧 **邮箱**: 1600386893@qq.com
- 🐛 **问题反馈**: [GitHub Issues](../../issues)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给个Star支持一下！**

**让更多小白用户享受Aria2的强大功能！**

</div>