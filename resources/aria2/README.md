# 内置 aria2 引擎

本目录存放随安装包分发的 aria2 可执行文件，按 **平台 / 架构** 分目录：

```
resources/aria2/
├── win32/
│   ├── x64/aria2c.exe      # 已提供
│   └── ia32/aria2c.exe     # 已提供（32 位）
├── darwin/
│   ├── x64/aria2c          # 已提供
│   └── arm64/aria2c        # 已提供
└── linux/
    └── x64/aria2c          # 已提供
```

当前未提供 `linux/arm64`、`linux/armv7l`——打包配置与 CI 只产出 Linux x64。
需要时按下方「静态编译」自行补上即可（目录名须与 `getEngineArchDir` 一致）。

## 现有文件的来源与校验

| 文件 | 版本 | 来源 | SHA-256 |
|---|---|---|---|
| `win32/x64/aria2c.exe` | 1.37.0 | aria2 官方 Release（Windows x64） | `—` |
| `win32/ia32/aria2c.exe` | 1.37.0 | aria2 官方 Release（Windows x86） | `—` |
| `linux/x64/aria2c` | 1.36.0 | Motrix v1.8.19 `extra/linux/x64/engine/aria2c` | `6f50816471fbd5e91c04df6cf6f995c6279d295b70187f313e6d3b04f65769fc` |
| `darwin/x64/aria2c` | 1.36.0 | Motrix v1.8.19 `extra/darwin/x64/engine/aria2c` | `be98b2260162b4b75c6a271a496c3fc96080e37561719381d9d883fbf7d25455` |
| `darwin/arm64/aria2c` | 1.36.0 | Motrix v1.8.19 `extra/darwin/arm64/engine/aria2c` | `1527c4d071c16c1266880e93750e385cdd4e9d2a950d7f56cb5a21125e3bd311` |

说明：

- **版本不一致**：Windows 为 1.37.0（上游最新官方二进制），macOS/Linux 为 1.36.0
  （上游不提供这两类预编译包，取自 Motrix 仓库）。两者行为差异极小，但如需完全一致，
  可在 Mac/Linux 上按下方步骤自行编译 1.37.0 替换；
- **完整性**：可以使用 `git hash-object` 核对——上述 Motrix 文件的 git blob SHA-1 为
  `b1ae0b44…`（linux x64）、`f4a27406…`（darwin arm64），与 Motrix 仓库报告的一致，
  即字节级未改动；
- **macOS 签名**：两个 darwin 二进制的 Mach-O 均带 `LC_CODE_SIGNATURE`（至少为 ad-hoc 签名），
  能减少 Gatekeeper 直接拒绝的概率；若自行编译替换，务必重新 `codesign --force --sign -`。

## 为什么要提交二进制（而不是运行时下载）

- 用户机器上**没有** aria2；运行时下载会让首启依赖网络、失败率高，还要处理代理/校验/权限；
- 引擎是下载器的核心组件，其版本必须与代码一起评审、一起发版，出问题时可追溯；
- 与 Motrix 的策略一致：预编译产物进仓库，打包时由 electron-builder 直接映射到 `resources/` 根目录。

代价：仓库体积增加（现有文件合计约 30 MB），且升级引擎需要重新提交文件。

## 目录名的一致性约束

同一个映射关系出现在三处，**改一处必须同步其余两处**：

| 位置 | 作用 |
|---|---|
| `package.json` → `build.win/mac/linux.extraResources` | 打包时用 `${arch}` 宏取对应目录 |
| `scripts/verify-engine.mjs` | 打包前断言二进制存在 |
| `electron/utils/platform.ts` | 开发环境运行时定位（`getEngineArchDir`） |

Windows arm64 复用 `x64` 目录（Windows on ARM 可运行 x64 程序）；Linux 的 `arm` 对应 `armv7l`。

## Windows

官方 Releases 提供的构建可直接使用（当前仓库内的版本为 aria2 1.37.0）：

<https://github.com/aria2/aria2/releases>

## macOS / Linux：静态编译

静态链接（`ARIA2_STATIC=yes`）是唯一稳妥的分发方式——动态链接产物会依赖构建机的
glibc / OpenSSL 版本，换一台机器就可能缺库。

### macOS

```bash
# 依赖（Homebrew）
brew install autoconf automake libtool pkg-config openssl c-ares libssh2 libxml2 zlib

curl -LO https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0.tar.gz
tar xf aria2-1.37.0.tar.gz && cd aria2-1.37.0

# 静态链接需要显式指定静态库路径（Homebrew 默认只提供动态库）
./configure ARIA2_STATIC=yes \
  --with-openssl=/opt/homebrew/opt/openssl \
  --with-ca-bundle=/etc/ssl/cert.pem \
  --without-libnettle \
  CFLAGS="-I/opt/homebrew/include" LDFLAGS="-L/opt/homebrew/lib"

make -j$(sysctl -n hw.ncpu)
```

产物：`src/aria2c`。复制到 `resources/aria2/darwin/{x64,arm64}/aria2c`
（Apple Silicon 上编译得到 arm64；Intel 机器或 `-arch x86_64` 交叉编译得到 x64）。

**从源码构建的二进制必须自行签名**，否则 Gatekeeper 会拒绝启动（即使 App 本身不签名）：

```bash
codesign --force --sign - resources/aria2/darwin/arm64/aria2c
```

### Linux

推荐在**较旧的发行版容器**里构建（提升 glibc 兼容范围）：

```bash
docker run --rm -v "$PWD":/src -w /src ubuntu:20.04 bash -c '
  apt-get update && apt-get install -y build-essential pkg-config libssl-dev \
    libxml2-dev libssh2-1-dev libc-ares-dev zlib1g-dev libsqlite3-dev
  curl -LO https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0.tar.gz
  tar xf aria2-1.37.0.tar.gz && cd aria2-1.37.0
  ./configure ARIA2_STATIC=yes --without-libnettle
  make -j$(nproc)
  cp src/aria2c /src/resources/aria2/linux/x64/aria2c
'
```

### 可执行位（容易漏）

POSIX 平台的可执行权限记录在 git 索引里。复制进仓库后**必须**：

```bash
chmod +x resources/aria2/darwin/*/aria2c resources/aria2/linux/*/aria2c
git update-index --chmod=+x resources/aria2/darwin/arm64/aria2c   # 每个文件执行一次
```

否则打包后启动引擎会报 `EACCES`，而开发环境（文件系统权限宽松）一切正常。

## 校验

```bash
node scripts/verify-engine.mjs                 # 按当前平台/架构
node scripts/verify-engine.mjs darwin arm64    # 指定目标
```

## 许可证

aria2 采用 **GPLv2**，本仓库采用 MIT。二者不冲突，但分发包含 GPL 二进制的安装包时，
必须同时提供该二进制的对应源码获取方式（GPLv2 §3）。

- 上游源码：<https://github.com/aria2/aria2>
- 修改说明：本项目未修改 aria2 源码；如你自行打了补丁，必须在同一位置公开补丁源码。
