# 自动化：MCP、CLI 与 Webhook

Aria2Desktop 提供三种自动化入口，彼此独立、可以组合使用：

| 入口 | 适用场景 | 鉴权 |
|---|---|---|
| MCP /api/mcp | Claude Desktop、Cursor 等 MCP 客户端 | RPC 密钥（Bearer） |
| CLI scripts/aria2-desktop-cli.mjs | Shell 脚本、CI、一次性调用 | RPC 密钥（参数或环境变量） |
| Webhook 完成规则 | 下载完成后通知自建服务或自动化平台 | URL 自带令牌（可选） |

## MCP

1. 在设置 → RPC 与安全中确认已启用 HTTP 接口（默认端口 6801）并设置 RPC 密钥；
2. 在 MCP 客户端中添加服务器，URL 为 http://127.0.0.1:6801/api/mcp ，
   Authorization 头为 Bearer <RPC 密钥>；
3. 支持 22 个工具，覆盖任务添加/查询/暂停/恢复/删除、队列位置、全局限速、
   最大并发、全局选项、Peer/服务器/文件列表、会话保存等；同时提供
   aria2://status/global 等 4 个 resources 与 download_summary、diagnose_downloads 两个 prompts。

curl 示例：

    curl -s http://127.0.0.1:6801/api/mcp \
      -H "Authorization: Bearer $ARIA2_DESKTOP_SECRET" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{"status":"active"}}}'

## CLI

    export ARIA2_DESKTOP_SECRET="<RPC 密钥>"
    node scripts/aria2-desktop-cli.mjs tools
    node scripts/aria2-desktop-cli.mjs stats
    node scripts/aria2-desktop-cli.mjs list waiting
    node scripts/aria2-desktop-cli.mjs add "https://example.com/file.iso" --fileName "custom.iso"
    node scripts/aria2-desktop-cli.mjs pause <gid>
    node scripts/aria2-desktop-cli.mjs call change_task_position '{"gid":"<gid>","how":"POS_TOP"}'

接口地址可用 --url 或 ARIA2_DESKTOP_URL 覆盖（例如指向另一台机器上的无头实例）。

## Webhook 完成规则

在设置 → 工作流 → 完成规则中新增一条规则，动作选择 webhook：

- POST（默认）：发送 JSON 体；
- GET：不带 body，适合简单的通知地址；
- 超时 10 秒。请求失败（连不上、非 2xx、超时）不会阻塞下载队列，而是进入重试队列，
  按下面的退避策略自动重投。

JSON 体示例：

    {
      "event": "download.complete",
      "gid": "2089b05ecca3d829",
      "status": "complete",
      "name": "example.iso",
      "files": ["D:/Downloads/example.iso"],
      "dir": "D:/Downloads",
      "timestamp": "2026-11-08T00:00:00.000Z"
    }

### HMAC 签名校验

动作配置里填了 secret 后，每个请求都会带两个头：

| 头 | 值 |
|---|---|
| X-Aria2-Timestamp | 发送时刻的 epoch 毫秒（十进制字符串） |
| X-Aria2-Signature | sha256=<hex> |

hex 为 HMAC-SHA256(secret, timestamp + "." + body) 的小写十六进制；其中 timestamp 是
X-Aria2-Timestamp 头里的**原样字符串**（不要重新格式化），body 是请求体原文；GET 请求
没有 body，用空字符串代替（即对 "`<timestamp>.`" 签名）。

接收端校验三件事：签名一致、时间戳在可接受窗口内（建议正负 5 分钟，防重放）、
比较时用恒定时间算法（避免按字节比较泄露前缀）。Node.js 示例：

    import crypto from 'node:crypto'

    const WINDOW_MS = 5 * 60 * 1000

    // rawBody 必须是未经 JSON.parse 再序列化的原始字节（Express 用 express.raw({type:'*/*'})）
    function verify(req, rawBody, secret) {
      const timestamp = String(req.headers['x-aria2-timestamp'] || '')
      const signature = String(req.headers['x-aria2-signature'] || '')
      if (!timestamp || !signature) return false
      if (Math.abs(Date.now() - Number(timestamp)) > WINDOW_MS) return false

      const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(timestamp + '.' + rawBody.toString('utf-8'), 'utf-8')
        .digest('hex')

      const a = Buffer.from(expected)
      const b = Buffer.from(signature)
      return a.length === b.length && crypto.timingSafeEqual(a, b)
    }

Python 示例（Flask）：

    import hmac, hashlib, time

    WINDOW_MS = 5 * 60 * 1000

    def verify(request, secret: str) -> bool:
        timestamp = request.headers.get("X-Aria2-Timestamp", "")
        signature = request.headers.get("X-Aria2-Signature", "")
        if not timestamp or not signature:
            return False
        if abs(time.time() * 1000 - int(timestamp)) > WINDOW_MS:
            return False

        body = request.get_data(as_text=True)  # GET 时为空字符串
        message = f"{timestamp}.{body}"
        expected = "sha256=" + hmac.new(
            secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256
        ).hexdigest()

        # compare_digest 是恒定时间比较
        return hmac.compare_digest(expected, signature)

注意：**必须用原始请求体**参与计算。很多框架（Express 的 express.json、Flask 的
request.get_json）会把 body 解析成对象，再序列化回去时键顺序/空白/Unicode 转义都会变，
签名就对不上。

### 重试与失败队列

| 配置项 | 默认值 | 可配范围 |
|---|---|---|
| 重试次数（不含首次投递） | 4 | 0-10 |
| 退避基准 | 60 秒 | 5-3600 秒 |
| 单次退避上限 | 6 小时 | 固定 |

- 第 n 次失败后等待 基准 × 2^(n-1) 秒再投（指数退避），单次等待封顶 6 小时；
  例如基准 60 秒时依次为 60 秒、2 分、4 分、8 分……
- 超过重试上限后条目转入**失败队列**，不再自动重投，等人工处理。
- 队列在 设置 → 工作流 → Webhook 投递队列 中查看（含目标地址、已尝试次数、最近错误），
  可以手动重试单条或一键清空。
- 队列持久化在应用数据目录的 store 里（顶层键 webhookQueue，上限 200 条，超限时优先丢最旧的
  失败条目）。应用重启后仍在队列里的条目会继续投递；进程异常退出时卡在"投递中"的条目
  会在下次启动时按待投递处理。
- 失败不会影响下载本身：任务状态、文件落盘都不受投递结果影响。

规则可以同时按分类、扩展名、任务状态匹配；同一条下载可依次执行移动、重命名、解压、
打开、通知和 Webhook 多个动作。

## Web 控制台 API

设置 → 高级 → Web 控制台 开启后，浏览器或手机访问 `http://<host>:6802/` 即可管理任务。
控制台自带 **PWA** 支持：手机浏览器菜单里「添加到主屏幕」后以独立窗口运行，离线时展示缓存的界面壳。

### 鉴权与权限范围

除主令牌外可以创建多个具名令牌，每个令牌带一组 scope：

| scope | 允许的操作 |
|---|---|
| `tasks:read` | 读取状态、任务列表、统计 |
| `tasks:write` | 新增下载任务 |
| `tasks:control` | 暂停 / 继续 / 删除任务 |
| `audit:read` | 读取操作审计日志 |
| `admin` | 以上全部（主令牌等价于 admin） |

请求带 `Authorization: Bearer <令牌>`。鉴权失败返回 401；令牌有效但 scope 不足返回
403 且响应体为 `{ "error": "insufficient_scope", "required": "<所需 scope>" }`。
两类失败都会写入审计日志。设置页会显示每个令牌的创建时间与最近使用时间（最近使用时间
最多每分钟落盘一次，避免频繁写盘）。

### OpenAPI 文档

`GET /openapi.json` 返回 OpenAPI 3.0.3 契约，包含所有端点、bearer 鉴权方案与各 scope 的语义说明，
可直接导入 Postman / Insomnia 或用于生成客户端。

    curl -s http://127.0.0.1:6802/openapi.json | head

### 端点一览

| 方法 | 路径 | 所需 scope |
|---|---|---|
| GET | /api/status | tasks:read |
| GET | /api/audit | audit:read |
| POST | /api/tasks | tasks:write |
| POST | /api/tasks/:gid/pause | tasks:control |
| POST | /api/tasks/:gid/resume | tasks:control |
| POST | /api/tasks/:gid/remove | tasks:control |
| GET | /openapi.json | 公开 |

`/`、`/index.html`、`/manifest.webmanifest`、`/sw.js`、`/openapi.json` 与四个图标为公开资源（不含任何任务数据），
其余路径都需要令牌。
