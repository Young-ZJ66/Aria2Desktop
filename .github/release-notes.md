# v1.3.1 更新日志

v1.3.1 是 v1.3.0 的跨平台补丁版：修复 macOS 打包产物日志路径导致的发布冒烟误判，补齐 v1.3.0 缺失的 macOS 安装包，并让发布流水线在每次发版前真正启动一次打包产物。v1.3.0 的完整功能清单见 [v1.3.0](https://github.com/Young-ZJ66/Aria2Desktop/releases/tag/v1.3.0)。

## 🍎 macOS 构建与发布

- **补齐 macOS 安装包**：提供 Intel（x64）与 Apple Silicon（arm64）的 dmg 与 zip，和 Windows、Linux、浏览器扩展一起构成完整跨平台发布。
- **日志路径跨平台统一**：修复 macOS 上 electron-log 默认写入 `~/Library/Logs/Aria2Desktop`、而打包冒烟与应用内“打开日志目录”读取 `<userData>/logs/main.log` 导致日志为空的问题；现在 Windows / macOS / Linux 统一写入 `<userData>/logs/main.log`，`ARIA2_E2E_USER_DATA` 隔离目录同样生效。
- **发布前启动冒烟**：macOS 与 Linux x64 在打包后实际启动一次应用，验证内置 aria2 进程、扩展本地接口与窗口渲染；失败时会保存 `test-results/` 现场 artifact，避免把“能打包但起不来”的产物发出去。
- **签名环境变量修复**：Windows / macOS 构建仅在对应 secrets 存在时注入 `CSC_LINK` / `CSC_KEY_PASSWORD` 与 Apple 公证凭据；未配置证书时不再因为空 `CSC_LINK` 被 electron-builder 解析成项目根目录而构建失败。

## 🛠️ 其他修复

- 发布工作流补强 macOS / Linux 启动冒烟与失败现场留存。
- 浏览器扩展 manifest 版本同步为 1.3.1。

## ⚠️ 已知限制

- Windows / macOS 代码签名需要配置 CI secrets（`CSC_LINK`、`CSC_KEY_PASSWORD`，macOS 还需 Apple 公证凭据）；未配置证书的公开构建仍会提示未知发布者。
- macOS 内置 aria2 仍为 1.36.0（上游暂无免依赖 1.37 预编译）。
- 插件市场审核目前通过 GitHub Issue 举报入口完成，尚无独立审核后台。
