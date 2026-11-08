# 插件开发指南

Aria2Desktop 插件运行在独立的 Electron `utilityProcess` 中。插件崩溃或死循环只会
结束自己的进程，不会冻结下载器主进程；插件与主进程之间只能通过白名单 API 通信。

> 安全模型：`vm` 仍然用于限制插件能直接访问的全局对象，但它不是安全边界。
> 请把插件视为“与本机用户等权的代码”，只安装可信来源，并在启用前检查权限。

## 内置示例：Auto Retry

安装包自带 `plugins/auto-retry`。它实现的是**原生界面没有提供**的能力：下载失败后
自动重试。应用本身只有手动的「重试」按钮；该插件监听 `onDownloadError`，读取失败任务
的原始 URI 并重新加入队列，最多重试 3 次，每次重试前通过系统通知告知用户。

```js
// plugins/auto-retry/index.js（节选）
onDownloadError(task) {
  return aria2.getStoppedTasks().then((stopped) => {
    const current = stopped.find(item => item.gid === task.gid)
    const uris = current.files.flatMap(file => file.uris.map(item => item.uri))
    return aria2.addUri(uris, { dir: current.dir })
  })
}
```

内置插件首次启动时默认停用，用户需要在设置 → 插件页确认权限后手动启用。

## 目录结构

```
<userData>/plugins/<plugin-id>/
├── manifest.json      # 必需
└── index.js           # 默认入口，可由 manifest.main 指定
```

Windows 上 `<userData>` 默认为 `%APPDATA%\aria2-desktop`；macOS 为
`~/Library/Application Support/aria2-desktop`；Linux 为 `~/.config/aria2-desktop`。
设置 → 插件页可直接打开插件目录。

## manifest.json

```json
{
  "id": "com.example.hello",
  "name": "Hello Aria2",
  "version": "1.0.0",
  "description": "示例插件",
  "author": "Example",
  "main": "index.js",
  "permissions": ["aria2:read", "notify"]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识，建议反向域名；市场安装要求 `^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$` |
| `name` / `version` | 显示名称与语义化版本，必填 |
| `main` | 入口文件名，默认 `index.js`；禁止路径穿越 |
| `permissions` | 见下表，缺省视为无权限 |

## 权限

| 权限 | 允许的 API |
|---|---|
| `aria2:read` | `aria2.getGlobalStat/getActiveTasks/getWaitingTasks/getStoppedTasks` |
| `aria2:write` | `aria2.addUri/pause/unpause/remove` |
| `settings:read` | `settings.get(key)`；返回前已剔除所有密钥字段 |
| `notify` | `notify.send(title, body)` |

## 插件入口

入口文件在加载时同步执行一次，必须导出生命周期函数：

```js
module.exports = {
  async onActivate() {
    console.log('plugin activated')
  },
  async onDeactivate() {
    // 清理定时器、连接等资源
  },
  async onDownloadStart(task) {
    // task = { gid, name }
  },
  async onDownloadComplete(task) {
    const stat = await aria2.getGlobalStat()
    notify.send('下载完成', `${task.name} · 当前速度 ${stat.downloadSpeed}`)
  },
  async onDownloadError(task) {
    // task = { gid, name }，可用于失败告警或自动重试
  }
}
```

可用的全局对象：标准 JS 内建、`console`（log/warn/error）、`setTimeout`、`setInterval`、
`aria2`、`settings`、`notify`。不支持 `require`、`process`、文件系统或任意网络请求——
需要新能力时应在主进程扩展白名单 API，而不是让插件直接触达系统。

## 本地调试

1. 把插件目录放到插件目录下；
2. 在设置 → 插件页启用（首次启用会显示权限确认）；
3. 日志写入应用日志文件，设置页可直接打开日志目录；
4. 修改代码后禁用再启用插件即可重新加载；多次崩溃会自动重启（最多 3 次），
   超过后状态显示为 `error`，设置页会展示最后一次错误。

## 发布到插件市场

市场注册表是一个 HTTPS JSON 文件，支持顶层数组或 `{ "plugins": [...] }`：

```json
{
  "plugins": [
    {
      "id": "com.example.hello",
      "name": "Hello Aria2",
      "version": "1.0.0",
      "description": "示例插件",
      "author": "Example",
      "homepage": "https://example.com/hello",
      "entryUrl": "https://example.com/hello/index.js",
      "sha256": "<入口文件的 64 位 SHA-256>",
      "signature": "<Base64(Ed25519 或 RSA-SHA256 签名)>",
      "publisher": "<PEM 公钥或可信发布者标识>",
      "permissions": ["aria2:read", "notify"],
      "main": "index.js"
    }
  ]
}
```

- `entryUrl` 必须是 HTTPS，入口文件大小上限 2 MB；
- `sha256` 必填，安装时强制比对；
- 在设置 → 插件页的“可信发布者”中填入公钥后，市场插件必须带有效签名才能安装：
  - Ed25519：`crypto.sign(null, data, privateKey)`
  - RSA：`crypto.sign('sha256', data, privateKey)`
- 安装后的元数据保存在插件目录的 `.market.json`，包含 publisher/signature/sha256/installedAt，
  便于审计与后续升级比对。

## 权限与信任建议

- 只声明真正需要的权限；`settings:read` 虽然已脱敏，仍可能暴露目录结构等信息；
- 不要在插件里硬编码令牌或密码；
- 市场安装默认要求 SHA-256 校验；配置可信发布者后同时要求签名，二者都通过才会解压写入。
