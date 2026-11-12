# v1.3.4 更新日志

v1.3.4 是一个兼容性修复版本：解决 Linux AppImage 在部分沙箱与容器环境中无法创建窗口、只剩托盘图标的问题，并补充英文 README。

## 🐧 Linux AppImage 启动修复

- **修复空白窗口**：移除主进程在 AppImage 运行时调用 `app.commandLine.appendSwitch('no-sandbox')` 的做法。该调用发生时 Chromium 沙箱已完成初始化，无法真正关闭沙箱，反而会在 AppImageHub、Firejail 等环境中触发共享内存分配失败，渲染进程报 `ERR_FAILED`，主窗口空白且只剩托盘图标。
- **交由 AppRun 处理**：electron-builder 生成的 AppRun 会在 exec 前探测用户命名空间；`unshare -Ur true` 不可用时自动追加 `--no-sandbox`，可用时保持 Chromium 沙箱开启。
- **实机验证**：已在 AppImageHub 同款 Firejail 测试环境中验证，应用可正常显示主窗口并完成页面加载。
- **不影响 deb/rpm**：deb/rpm 安装包由 electron-builder 在安装时设置 `chrome-sandbox` 权限位，Chromium 沙箱保持开启。

## 🌍 文档

- **新增英文 README**：新增 `README.en.md` 并在中文 README 顶部添加语言切换入口，方便非中文用户了解安装、功能与开发方式。

## 🛠️ 其他

- 应用、浏览器扩展与安装包版本号同步升级至 1.3.4。
- 发布工作流、更新检查与下载校验逻辑保持不变。

## ⚠️ 已知限制

- Windows 安装包未签名，SmartScreen 可能提示未知发布者；可用 Release 页的 `.sha256` 校验下载文件。
- macOS 公开构建未签名、未公证，首次打开需右键 →「打开」；消除 Gatekeeper 提示需要 Apple Developer Program。
- AppImage 暂未包含内置更新信息（update information / zsync），应用内自动更新仍以 Windows 安装包为主。
