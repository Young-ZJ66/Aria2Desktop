# 发版检查清单

> 适用于 v1.1.0 及之后的版本。任何一步失败都不要继续发布——Release 发出后无法撤回重发。

## 1. 版本与物料

- [ ] `package.json` 的 `version` 与本次 tag 一致（CI 会校验更新日志首行版本号）
- [ ] `.github/release-notes.md` 首行为 `# vX.Y.Z 更新日志`，内容与实际改动一致
- [ ] 扩展若有改动：`extension/manifest.json` 版本已递增，商店文案/截图已更新
- [ ] README 中与版本相关的描述（安装包命名、支持平台）没有过期

## 2. 质量门禁（全绿才能继续）

```bash
npm run typecheck
npm run test:run
npm run lint
npm run build                # 含 verify-resources
npm run check:extension
npm run verify:extension-api
npm run test:e2e             # 真实 Electron UI + 插件运行时 + 自动解压
```

- [ ] 扩展 E2E 需要 Chrome for Testing：`E2E_CHROME_PATH=<chrome路径> npm run test:e2e`
      （未提供时该项 SKIP，不算通过；发版前必须至少在本机跑过一次）
- [ ] 截图与日志留存于 `test-results/e2e/<时间戳>/`，失败项必须修复后重跑

## 3. 安装包验证

- [ ] Windows x64：`npm run dist:win64` 后 `npm run verify:dist -- win x64`
- [ ] Windows x86：`npm run dist:win32` 后 `npm run verify:dist -- win ia32`
- [ ] macOS / Linux：手动触发 `.github/workflows/build-unix.yml`，两个 job 均绿
      （工作流内置 `verify-dist` 产物断言）
- [ ] 安装包冒烟：Windows 安装后能启动并连上引擎；macOS/Linux 若本机可用需人工安装一次

### 本地打包的已知环境问题

- `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`（生成 uninstaller 时执行临时安装器失败）：
  多为 SmartScreen / 安全软件拦截未签名 exe。以 CI 产物为准，本机可先把 `release/` 加入排除目录或临时关闭 SmartScreen。
- `Timeout awaiting 'request'`：electron-builder 需要下载打包工具（winCodeSign / 7zip 等），网络受限时会卡住；
  CI 的 windows-latest 预置了缓存，不受影响。

## 4. 发布

- [ ] 推送 tag：`git tag vX.Y.Z && git push origin vX.Y.Z`
- [ ] `release.yml` 全绿（类型检查、单测、扩展校验、接口端到端、产物断言）
- [ ] Release 资产齐全：
      - Windows x64/x86：`Setup.exe`、`portable.zip`、`Setup.exe.blocks.json`、`.sha256`
      - 扩展：`Aria2Desktop-Extension-*.zip`、`.crx`（配置了签名密钥时）
- [ ] 更新日志没有指向错误的版本（检查首行版本号）

## 5. 发布后验证（必须）

- [ ] 用**上一版**已安装的应用检查更新：出现提示 → 下载 → SHA-256 校验通过 → 安装成功
- [ ] 差量更新：日志确认块表下载与合并；若回退全量，记录原因
- [ ] 断点续传：下载中关闭应用再打开，确认从断点继续
- [ ] 扩展商店版本与 Release 内扩展包版本一致（ID 不同不可互相升级）
- [ ] macOS / Linux 各下载安装一次（若手头有对应设备/虚拟机）
- [ ] 探索性：真实 BT 任务（有种子网络）确认健康度标签、0 做种提示与重试按钮
- [ ] 探索性：真实站点视频捕获（授权站点权限后列表正确、可直接发送）

## 6. 回滚预案

- [ ] 不删除、不移动已发布的 tag 与 Release（已下载的安装包仍依赖其 `.sha256`）
- [ ] 出现阻断问题时发布补丁版本（patch），并在更新日志中说明
- [ ] 若安装包本身有问题，可将 Release 标记为 pre-release 并从 `releases/latest` 排除
      （应用端只认 `releases/latest`，可立即阻止继续扩散）
