# v1.3.2 更新日志

v1.3.2 聚焦设置页体验与 Windows 签名基础设施：重新整理设置导航、统一页面布局与按钮位置，并接入 SignPath Foundation 免费开源代码签名流程。

## 🎨 设置页焕新

- **导航分组**：把原来的 13 个设置页签整合为 8 个一级入口，「网络与协议」「工具与插件」「安全与维护」使用二级 Tab 切换；在 1200×800 等常见窗口下左侧导航不再需要上下滚动。
- **布局与留白**：设置窗口加宽，内容区占满可用宽度，表单控件不再固定 80% 宽；移除页面标题与左侧页签的重复显示，右侧不再出现大片无意义空白。
- **按钮位置**：卡片内除标题行外的操作按钮（保存、重载、恢复默认、保存可信发布者、刷新市场等）统一改为靠左排列；对话框底部按钮保持常规右侧布局。
- **插件市场独立 Tab**：插件页拆分为「已安装 / 插件市场」两个 Tab，无需向下滚动即可查看市场配置、刷新与安装。
- **搜索适配**：设置搜索支持新的二级分组结构，搜索结果会同时切换到正确的一级分组与二级子页并滚动高亮。

## 🔐 Windows 免费代码签名

- **SignPath Foundation 流程接入**：发布工作流新增读取版本号、上传待签名安装包、提交 SignPath 签名请求、下载并校验签名后替换安装包的完整步骤；仅在 SignPath secrets 配置齐全时启用，未配置时保持原有未签名发布流程。
- **签名配置**：新增 `.signpath/artifact-configuration.xml`，限定只签名 Windows NSIS 安装包并校验 ProductName、ProductVersion、FileVersion、CompanyName 等 PE 元数据。
- **代码签名政策**：新增「Code signing policy」与隐私政策，说明免费签名来源、签名范围、团队角色、每个 Release 的人工审批流程和验证方法。
- **维护者文档**：新增代码签名申请、GitHub secrets 配置、`Get-AuthenticodeSignature` / `signtool` 验证步骤与常见问题说明。

> 当前 SignPath Foundation 申请仍在审核中；在申请通过并配置 secrets 之前，本版 Windows 安装包仍为未签名，SmartScreen 可能提示「未知发布者」。便携版 zip 不在签名范围内。

## 🛠️ 其他改进

- 修复文档目录被 `.gitignore` 整体忽略、导致 README 中的插件开发与自动化文档链接失效的问题。
- 插件安全提示更新为 utilityProcess 隔离模型，明确插件能读取下载任务与设置，仍需只安装可信插件。
- 浏览器扩展 manifest 版本同步为 1.3.2。

## ⚠️ 已知限制

- Windows 安装包签名依赖 SignPath Foundation 审核与仓库 secrets；审核通过前仍会提示未知发布者。
- macOS 公开构建未签名、未公证，首次打开需右键 →「打开」；消除 Gatekeeper 提示需要 Apple Developer Program。
- 插件市场审核目前通过 GitHub Issue 举报入口完成，尚无独立审核后台。
