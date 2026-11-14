# Headless 服务化部署

Aria2Desktop 可以以"无头"方式常驻运行：不弹主窗口，把下载引擎和远程接口留在后台，
适合下载机、NAS、长期在线的服务器，或者只想用手机/浏览器管理的场景。

## --headless 启动参数

```
Aria2Desktop --headless
```

启动后实际行为（以当前版本为准）：

| 项目 | --headless 下的行为 |
|---|---|
| 主窗口 | 仍然创建（隐藏状态），但不显示，也不会自动弹出 |
| 托盘图标 | 不创建（无托盘菜单，避免误以为有可见入口） |
| 下载引擎（aria2） | 照常启动；启动失败时直接退出进程（不弹"继续/退出"对话框） |
| Web 控制台 | 按设置决定："启用 Web 控制台"打开时照常监听（默认端口 6802，设置 → 高级 → 远程 Web 控制台） |
| MCP / 浏览器扩展接口 | 照常启动（默认端口 6801，需要先设置 RPC 密钥） |
| RSS 订阅、监听文件夹 | 照常启动 |
| 限速计划、下载调度、UPnP | 照常启动 |
| 退出方式 | 关闭进程或发 SIGTERM/SIGINT，会走优雅关闭（保存会话、停服务） |

几点需要提前知道：

- **窗口仍在创建。** `--headless` 只跳过"显示窗口"和"创建托盘"，Electron 仍会建
  一个隐藏窗口。因此在**完全没有图形环境的 Linux 服务器**上直接运行会因缺少
  X server 而失败，需要虚拟显示（见下面的 `xvfb-run`）或带桌面会话的机器。
- **单实例限制。** 同一用户下只能跑一个实例：桌面版正在运行时再启动
  `--headless` 会立刻退出，并把已运行实例的窗口唤醒显示出来。服务化部署时请确保
  没有同用户的桌面实例在跑。
- **Web 控制台默认是关的。** 无头模式下没有界面可点，必须先在有界面的机器上打开
  "启用 Web 控制台"并设置端口、访问令牌与允许的 IP，配置才会随 settings 生效。
  推荐流程：在桌面机器上配好，用 设置 → 通用 的"导出设置"导出 JSON，
  在目标机器上再导入（敏感字段在导出时可选择是否包含）。
- **MCP / 扩展接口需要 RPC 密钥。** 设置 → RPC 与安全 里未设置密钥时，6801 接口
  整体不开放。
- **数据目录**：统一在 Electron 的 userData 目录（Linux 一般是
  `~/.config/Aria2Desktop`，Windows 是 `%APPDATA%\Aria2Desktop`），
  日志在其中的 `logs/main.log`。

## 服务化部署

### Linux：systemd user service

把 AppImage 放到固定路径（示例用 `~/Applications`），然后写一个**用户级**服务
单元 `~/.config/systemd/user/aria2desktop.service`：

```ini
[Unit]
Description=Aria2Desktop 无头下载服务
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# 按实际路径/版本号修改；%h 是当前用户的家目录
ExecStart=%h/Applications/Aria2Desktop-1.3.7-x86_64.AppImage --headless
# 非 0 退出（崩溃、引擎启动失败）时自动重启；正常 stop 不重启
Restart=on-failure
RestartSec=5
# systemctl stop 发 SIGTERM，应用会优雅关闭引擎与 Web 控制台
KillSignal=SIGTERM
TimeoutStopSec=20
# AppImage 在只读挂载场景下需要先解包再运行，避免 FUSE 权限问题
Environment=APPIMAGE_EXTRACT_AND_RUN=1

[Install]
WantedBy=default.target
```

启用并启动：

```
systemctl --user daemon-reload
systemctl --user enable --now aria2desktop.service
# 让服务在用户未登录/未开终端时也继续运行（重启后自动拉起）
loginctl enable-linger "$USER"
systemctl --user status aria2desktop.service
journalctl --user -u aria2desktop.service -f
```

服务器上没有图形会话时，给 `ExecStart` 套一层虚拟显示：

```ini
ExecStart=/usr/bin/xvfb-run -a %h/Applications/Aria2Desktop-1.3.7-x86_64.AppImage --headless
```

> 提示：`Restart=on-failure` 只会在异常退出时重启。如果引擎启动失败（例如 aria2
> 可执行文件缺失），进程会以非 0 退出并反复重启——这时看
> `journalctl --user -u aria2desktop.service` 与 `logs/main.log` 定位原因。

### Windows：计划任务或开机启动

不需要写脚本，两种常见做法：

1. **任务计划程序**：创建任务 → 触发器选"登录时"（或"计算机启动时"，
   需要勾选"不管用户是否登录都要运行"并指定账号）→ 操作选"启动程序"，
   程序填 `Aria2Desktop.exe`，参数填 `--headless`；在"设置"里勾选
   "如果任务失败，按以下频率重新启动"。
2. **启动文件夹**：给 `Aria2Desktop.exe` 建一个快捷方式，目标加上
   `--headless`，放进 `shell:startup`。简单，但只在该用户登录后运行。

无论哪种方式都要注意单实例限制：不要让桌面版同时自动启动，否则谁先拿到锁谁活。

## 远程访问安全

两个端口的定位不同：

| 端口 | 用途 | 鉴权 |
|---|---|---|
| 6801 | MCP / 浏览器扩展接口（`/api/mcp`） | RPC 密钥（Bearer） |
| 6802 | Web 控制台（手机/浏览器页面、`/api/*`） | 访问令牌（Bearer），令牌分 scopes |

### 推荐：SSH 端口转发

默认情况下 Web 控制台只监听 `127.0.0.1`。最省事也最安全的用法是**不开放任何
端口**，用 SSH 隧道把本机端口映射过去：

```
# Web 控制台：本机 6802 -> 服务器 127.0.0.1:6802
ssh -N -L 6802:127.0.0.1:6802 user@host

# MCP / CLI 接口：本机 6801 -> 服务器 127.0.0.1:6801
ssh -N -L 6801:127.0.0.1:6801 user@host

# 两个一起转发
ssh -N -L 6802:127.0.0.1:6802 -L 6801:127.0.0.1:6801 user@host
```

隧道建立后，本机浏览器打开 `http://127.0.0.1:6802`，CLI 用
`--url http://127.0.0.1:6801`，和在本机运行完全一样，公网看不到任何端口。
Windows 上可以用 `ssh -L ...` 同样命令（Windows 10/11 自带 OpenSSH 客户端）。

### 必须直连时

如果确实要让局域网内的手机直接访问（不经过 SSH），至少做到：

- **填 allowedIps**：设置 → 高级 → 远程 Web 控制台 的"允许的 IP"填具体网段，
  例如 `192.168.1.0/24`。留空时只监听 `127.0.0.1`；一旦填写，服务会监听所有网卡
  （`0.0.0.0`），所以列表要写窄，不要写 `0.0.0.0/0`。
- **用强令牌**：主令牌等价于管理员权限，长度至少 16 个字符，别用可猜的短串；
  需要给不同客户端分权时，在"API 令牌"里按 scopes（`tasks:read`、`tasks:write`、
  `tasks:control`、`audit:read`、`admin`）分别签发，手机只给读和必要写权限。
- **防火墙收口**：只放行内网来源到 6802（以及需要时的 6801），例如
  `sudo ufw allow from 192.168.1.0/24 to any port 6802 proto tcp`；
  公网 IP 一律不要直接暴露这两个端口。
- **更稳妥的做法**：前面加一层反向代理（Nginx/Caddy）做 TLS 与访问控制，
  只反代 `127.0.0.1:6802`，用 HTTPS + 基本认证兜一层。

## 与 MCP / CLI 组合

MCP、CLI、Webhook 三个入口的对照表、鉴权方式与 Webhook 签名/重试策略见
[automation-cli-webhook.md](automation-cli-webhook.md)。CLI 的接口地址可用
`--url` 或环境变量 `ARIA2_DESKTOP_URL` 覆盖，这正是连接远端无头实例的方式：

```
export ARIA2_DESKTOP_SECRET="<服务器上设置 → RPC 与安全 里的 RPC 密钥>"
export ARIA2_DESKTOP_URL="http://127.0.0.1:6801"   # SSH 隧道场景
```

**例子 1：查询下载队列**（走隧道，或把 `ARIA2_DESKTOP_URL` 指向服务器内网地址）

```
# 正在下载的任务
node scripts/aria2-desktop-cli.mjs list active

# 等待中的任务，以及全局速度/数量统计
node scripts/aria2-desktop-cli.mjs list waiting
node scripts/aria2-desktop-cli.mjs stats

# 直接指定远端地址，不依赖环境变量
node scripts/aria2-desktop-cli.mjs --url http://127.0.0.1:6801 list all
```

**例子 2：往远端实例添加任务**

```
# 简写形式：多个 URL 逐个下发，--fileName 可选
node scripts/aria2-desktop-cli.mjs add "https://example.com/file.iso" --fileName "file.iso"

# 磁力链接
node scripts/aria2-desktop-cli.mjs add "magnet:?xt=urn:btih:<hash>"

# 等价的原生工具调用形式
node scripts/aria2-desktop-cli.mjs call add_download \
  '{"url":"https://example.com/file.iso","fileName":"file.iso"}'
```

> 目标目录不由 CLI 指定：分类目录与重名处理都由应用按用户设置决定（设置 → 下载 → 分类目录），
> 这也是 `add` 不接受 `--dir` 的原因。

同样的调用也可以直接走 JSON-RPC（等价于 MCP 客户端的行为）：

```
curl -s http://127.0.0.1:6801/api/mcp \
  -H "Authorization: Bearer $ARIA2_DESKTOP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{"status":"active"}}}'
```
