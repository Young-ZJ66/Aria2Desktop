# 代码签名（Code signing）

本文说明 Aria2Desktop 的代码签名方案、维护者需要完成的 SignPath 申请步骤，以及如何验证签名。目标是用**不付费**的方案解决 Windows 安装包的“未知发布者”提示。

## 结论先看

| 平台 | 免费且公开可信的方案 | 当前状态 |
|---|---|---|
| Windows | **SignPath Foundation**（免费 OSS 代码签名） | 仓库已集成流水线；完成 SignPath 申请并配置 secrets 后自动生效 |
| macOS | **没有** | 公开构建仍未签名/未公证；消除 Gatekeeper 提示需要 Apple Developer Program（$99/年） |

> SignPath Foundation 的证书签发给 **SignPath Foundation**，不是签发给个人或 Aria2Desktop 项目。用户看到的发布者会是 “SignPath Foundation”，这表示 SignPath 已验证该二进制来自本仓库的 GitHub Actions 构建。它不能替代项目自己的商业证书。

## Windows：SignPath Foundation

### 为什么选它

- 对符合条件的开源项目免费，证书由 SignPath Foundation 提供，私钥保存在 SignPath 的 HSM 中，不需要购买 USB Token。
- SignPath 会校验二进制确实来自 GitHub Actions 从公开仓库源码构建的 workflow artifact；每个 Release 需要人工审批。
- 发布者显示为 “SignPath Foundation”，不会出现“未知发布者”。

### 申请条件（SignPath 官方要求）

- OSI 认可的开源许可证，且没有商业双许可；项目中不能包含专有代码。
- 项目处于活跃维护状态，有公开仓库、下载页和功能说明。
- 所有团队成员启用 SignPath 与源码仓库（GitHub）的多因素认证（MFA）。
- 项目自行组织 Authors / Reviewers / Approvers 角色，并在项目主页发布 **Code signing policy**。
- 每个 release 的签名请求需要 Approver 人工审批。
- 所有被签名的 PE 文件必须设置并强制 product-name、product-version 等元数据。

Aria2Desktop 使用 MIT 许可证，公开仓库为 <https://github.com/Young-ZJ66/Aria2Desktop>，符合申请条件。**申请必须由项目所有者本人完成**（需要填写本人姓名、邮箱并接受条款），自动化代理不能代为提交。

### 实际申请页面

<https://signpath.org/apply> 目前是一个 **HubSpot 申请表**，不是 GitHub 登录页，也没有“选择许可证”“填写代码签名政策 URL”字段。页面收集项目信息、维护者信息和联系方式，提交后由 SignPath 人工审核；审核通过后才会用填写的邮箱创建 SignPath 账号，再进入项目/签名策略配置。

申请表的字段和建议填写值如下（带 `*` 的为必填）：

| 表单字段 | 建议填写 |
|---|---|
| Project Name * | `Aria2Desktop` |
| Repository URL * | `https://github.com/Young-ZJ66/Aria2Desktop` |
| Homepage URL * | `https://github.com/Young-ZJ66/Aria2Desktop` |
| Download URL | `https://github.com/Young-ZJ66/Aria2Desktop/releases`（该页面必须写明项目使用 SignPath Foundation 签名；v1.3.2 更新日志已写明） |
| Privacy Policy URL | `https://github.com/Young-ZJ66/Aria2Desktop/blob/main/docs/privacy.md` |
| Wikipedia URL | 留空 |
| Tagline * | `A modern, cross-platform aria2 download manager with a polished desktop UI.` |
| Category * | `Developer Tools` |
| Description * | 见下方“申请信息模板” |
| Reputation * | 见下方“申请信息模板” |
| Maintainer Type | `Individual maintainer(s)` |
| Build System * | `GitHub Actions` |
| First Name * / Last Name * | 你的真实姓名（将用于创建 SignPath 账号） |
| Email * | 你的常用邮箱（接收审核结果和账号邀请） |
| Company Name | 留空即可 |
| Primary Discovery Channel * | 按实际情况选择；如果是通过 AI 助手了解到 SignPath，可选 `AI / LLM tools` |
| Please specify the exact source | 可填 `ChatGPT`、`DeepSeek`、`GitHub` 等实际来源 |
| Code of Conduct 复选框 * | 勾选，确认证书以 SignPath Foundation 名义签发 |
| 数据存储/隐私复选框 * | 勾选，同意 SignPath 处理申请数据 |

> 表单没有 License 字段。请在 Description 或 Reputation 中写明项目使用 **MIT License**，审核人员会同时查看仓库的 LICENSE 文件。

### 维护者操作步骤

1. **填写申请表单**
   - 打开 <https://signpath.org/apply>，按上表填写并提交；此步骤不需要 GitHub 登录。
   - 申请材料可直接使用下方“申请信息模板”。

2. **等待审核并激活账号**
   - SignPath 会人工审核项目资格，并通过你填写的邮箱联系。
   - 审核通过后，使用邮件中的邀请激活 SignPath 账号，并立即启用 MFA。

3. **创建 SignPath 项目**
   - 在 SignPath 控制台创建项目，项目 slug 建议 `aria2desktop`。
   - 在组织的 **Trusted Build Systems** 中添加 **GitHub.com**，并安装 [SignPath GitHub App](https://github.com/apps/signpath) 到本仓库。
   - 记录 **Organization ID**（组织设置页）和项目 slug。

4. **创建签名策略**
   - 新建 signing policy，slug 建议 `release-signing`。
   - 选择 **Open Source Code Signing**，开启人工审批（每个 release 都需 Approver 批准）。

5. **创建 artifact configuration**
   - 在项目中新建 artifact configuration，slug 填 `windows-installer`。
   - 把仓库内 [`.signpath/artifact-configuration.xml`](../.signpath/artifact-configuration.xml) 的完整内容粘贴进去并保存。
   - 该配置只签名 GitHub Actions 上传的 `Aria2Desktop-<version>-<arch>-Setup.exe`，并强制校验 ProductName、ProductVersion、FileVersion、CompanyName。

6. **生成 API token**
   - 在 SignPath 用户设置中创建 API token，给提交者（Submitter）权限，只授予本项目使用。
   - 不要把 token 写进仓库或日志。

7. **配置 GitHub Actions secrets**
   在仓库 **Settings → Secrets and variables → Actions** 添加：

   | Secret | 说明 |
   |---|---|
   | `SIGNPATH_API_TOKEN` | 上一步生成的 API token |
   | `SIGNPATH_ORGANIZATION_ID` | SignPath 组织 ID |
   | `SIGNPATH_PROJECT_SLUG` | 项目 slug，例如 `aria2desktop` |
   | `SIGNPATH_SIGNING_POLICY_SLUG` | 签名策略 slug，例如 `release-signing` |
   | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | artifact configuration slug，例如 `windows-installer` |

   > 如果以后购买了传统 Authenticode 证书，也可配置 `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD`。流水线会优先使用传统证书并跳过 SignPath，避免重复签名。

8. **发版并审批**
   - 推送 `v*` tag 触发 [release.yml](../.github/workflows/release.yml)。
   - 质量闸门、E2E、打包完成后，Windows job 会把 `Setup.exe` 作为 GitHub Actions artifact 上传给 SignPath。
   - 在 SignPath 控制台审批签名请求（工作流最长等待 30 分钟）。
   - 工作流下载已签名文件，替换 release 目录中的未签名安装包，用 `Get-AuthenticodeSignature` 校验 `Status=Valid` 后才上传 Release。

### 申请信息模板

以下内容按当前申请表的字段组织，可直接复制填写：

```text
Project Name: Aria2Desktop
Repository URL: https://github.com/Young-ZJ66/Aria2Desktop
Homepage URL: https://github.com/Young-ZJ66/Aria2Desktop
Download URL: https://github.com/Young-ZJ66/Aria2Desktop/releases
Privacy Policy URL: https://github.com/Young-ZJ66/Aria2Desktop/blob/main/docs/privacy.md
Wikipedia URL:
Tagline: A modern, cross-platform aria2 download manager with a polished desktop UI.
Category: Developer Tools
Description: Aria2Desktop is an open-source desktop download manager that integrates the aria2 engine with an Electron and Vue 3 interface. It supports HTTP, FTP, BitTorrent and Metalink downloads, download scheduling, speed limits, browser extension integration, a plugin system, and builds for Windows, macOS and Linux. The project is released under the MIT License.
Reputation: Public repository at https://github.com/Young-ZJ66/Aria2Desktop. Active since August 2025 with 20 public releases (v1.0.0 through v1.3.2), 592 downloads across GitHub Releases, and 10 GitHub stars. The project publishes release notes for every version, maintains automated CI for type checking, unit tests, E2E tests and packaging, and provides Windows, macOS and Linux builds.
Maintainer Type: Individual maintainer(s)
Build System: GitHub Actions
First Name: <你的名字>
Last Name: <你的姓氏>
Email: <你的邮箱>
Company Name:
Primary Discovery Channel: AI / LLM tools
Please specify the exact source: ChatGPT / DeepSeek
```

## 验证签名

在 Windows 上执行：

```powershell
Get-AuthenticodeSignature .\Aria2Desktop-<version>-x64-Setup.exe | Format-List Status, StatusMessage, SignerCertificate
```

期望：

- `Status` 为 `Valid`
- `SignerCertificate.Subject` 包含 `SignPath Foundation`
- 文件属性 → 数字签名中能看到签名时间戳

也可以使用 Windows SDK 的 `signtool`：

```powershell
signtool verify /pa /v .\Aria2Desktop-<version>-x64-Setup.exe
```

## 常见问题

**工作流没有执行 SignPath 步骤**
检查 5 个 `SIGNPATH_*` secrets 是否都非空；只要缺少一个，整段签名逻辑就会跳过，按未签名发布。另检查是否配置了 `WINDOWS_CSC_LINK`（传统证书优先）。

**签名请求一直等待**
SignPath 每个 release 都需要人工审批。让 Approver 登录 SignPath 控制台批准；超时后该步骤会失败，不会发布未签名包。

**报 metadata restriction / product-name mismatch**
安装包的 PE 元数据必须与 `.signpath/artifact-configuration.xml` 一致：ProductName=`Aria2Desktop`、ProductVersion/FileVersion=package.json 版本、CompanyName=`Young-ZJ66`。如果 electron-builder 升级后改了元数据，先更新 artifact configuration。

**签名后差量块表/哈希不对**
签名必须发生在生成 `.blocks.json` 和计算 `.sha256` 之前。release.yml 已按这个顺序排列；不要手工把签名步骤挪到后面。

**便携版 zip 是否签名**
当前只签名 NSIS 安装包 `Setup.exe`。便携版 zip 里的 `Aria2Desktop.exe` 仍是未签名文件；如果 SmartScreen 对便携版也拦截，建议优先使用 Setup 安装包，或后续为便携版单独增加签名流程。

## macOS：为什么没有免费方案

- Apple 的代码签名与公证依赖 **Apple Developer Program**（个人/组织 $99/年）。免费的 Personal Team 只能在本机调试，不能分发给其他用户，也不能做 notarization。
- 使用 `codesign -s -` 做 ad-hoc 签名或完全不签名，Gatekeeper 仍会提示“无法验证开发者”；用户需要右键 →「打开」，或手动移除 quarantine 属性。
- 不存在类似 SignPath Foundation 的免费、公开可信的 macOS 分发证书。Apple 的费用减免只面向非营利组织、认证教育机构和政府机构，普通开源项目不适用。
- 如果未来希望消除 macOS 提示，需要购买 Apple Developer Program，并配置 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD` 与 Apple 公证凭据（`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`）。

> 不建议通过 `spctl --master-disable` 等方式关闭 Gatekeeper；这会降低整台机器的安全性。当前 macOS 发布说明会明确写“未签名”，并引导用户右键打开。

## 其他 Windows 方案对比

| 方案 | 费用 | 发布者显示 | 适用性 |
|---|---|---|---|
| **SignPath Foundation** | 免费（需申请） | SignPath Foundation | 本项目的首选 |
| Microsoft Store MSIX | Store 账号费用/审核 | Microsoft Store | 需要改成 MSIX 并上架 |
| Azure Artifact Signing（原 Trusted Signing） | 约 $9.99/月 | 组织名称 | 需要 Azure 订阅与身份验证 |
| OV/EV 代码签名证书 | $150–300/年 | 公司/个人 | 商业项目常用 |
| 自签名证书 | 免费 | 未知/自定义 | 只适合内部测试；公众安装会被拦截 |

## 相关文件

- [`.signpath/artifact-configuration.xml`](../.signpath/artifact-configuration.xml)：SignPath artifact configuration 源文件
- [`.github/workflows/release.yml`](../.github/workflows/release.yml)：Windows 签名步骤
- [`docs/code-signing-policy.md`](code-signing-policy.md)：对外的 Code signing policy
- [README.md](../README.md#代码签名政策code-signing-policy)：项目主页的签名政策入口
