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
    node scripts/aria2-desktop-cli.mjs add "https://example.com/file.iso" --dir "D:/Downloads"
    node scripts/aria2-desktop-cli.mjs pause <gid>
    node scripts/aria2-desktop-cli.mjs call change_task_position '{"gid":"<gid>","how":"POS_TOP"}'

接口地址可用 --url 或 ARIA2_DESKTOP_URL 覆盖（例如指向另一台机器上的无头实例）。

## Webhook 完成规则

在设置 → 工作流 → 完成规则中新增一条规则，动作选择 webhook：

- POST（默认）：发送 JSON 体；
- GET：不带 body，适合简单的通知地址；
- 超时 10 秒，失败只记录日志，不会阻塞下载队列。

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

规则可以同时按分类、扩展名、任务状态匹配；同一条下载可依次执行移动、重命名、解压、
打开、通知和 Webhook 多个动作。
