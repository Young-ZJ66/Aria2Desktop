# v1.0.3 更新日志

## 🔒 安全加固
 - 内容安全策略（CSP）改由主进程通过响应头强制注入，生产环境不再依赖渲染层 meta 兜底
 - IPC 调用增加页面来源（origin）白名单校验：被导航到恶意页面后发起的 IPC 请求会被拒绝
 - 自动更新 SHA-256 校验强化：校验文件格式异常时直接拒绝安装（封死格式异常绕过路径）
 - 删除文件接口（delete-files）的 taskDir 限定为下载目录子树，防止通过构造路径删除任意目录文件
 - RPC secret 改用系统级 safeStorage 加密存储：磁盘上不保存明文，旧明文数据自动兼容并在下次保存时加密
 - 设置导出时 secret 脱敏；导入设置增加原型污染防护，且不覆盖本地真实密钥
 - HTTP 协议 + 非 localhost 地址使用 RPC secret 时给出明文传输安全告警
 - 新建任务 URL 协议白名单校验：仅允许 http/https/ftp/sftp/magnet，拦截 javascript:/file: 等非法输入
 - 种子/metalink 上传前校验文件大小不超过 aria2 RPC 上限（1MiB），避免大文件上传静默失败
 - 删除文件改用校验阶段的 realpath 目标，减小符号链接 TOCTOU 竞态窗口

## 🛠️ 可靠性与修复
 - 修复启动崩溃：CSP 注入延迟到 app ready 后执行（此前在 ready 前访问 session 直接抛异常）
 - 修复 aria2 配置管理器在磁盘写入持续失败时无限递归导致的栈溢出
 - 修复 Aria2 进程启动失败时子进程泄漏（僵尸进程）
 - 本地存储（localStorage）损坏自愈：JSON 解析失败自动清理残留数据，不再永久不可用
 - 任务持久化加载失败可重试（此前首次失败后永久跳过）
 - 任务持久化读写改用异步 IO，避免大文件（上限 10MB）阻塞主进程事件循环
 - 修复任务选中状态在 Vue 3.5 下响应式失效（reactive Map 改 ref Map）
 - 修复流量监控定时器无法重启、自动刷新间隔未初始化时以 0ms 占满 CPU
 - 主题 auto 模式实时跟随系统深浅色切换（matchMedia 监听）
 - 修复确认弹窗在异步操作未完成时提前关闭、主题切换导致 DOM 泄漏
 - 修复 Windows 路径文件名提取错误（`C:\Downloads\file.zip` 显示完整路径）、时间格式化负数/NaN 输出乱码
 - 优雅关闭去重：before-quit 事件中 shutdown 只执行一次，二次 quit 直接放行
 - 旧版数据迁移增加完成标记文件，避免每次启动重复扫描
 - Aria2 进程优雅关闭增加竞态兜底：等待期间进程已退出时不再发信号
 - 窗口内容就绪重试定时器去重：窗口重建/重复 show 时不再叠加多个 setTimeout 链
 - 更新下载失败时自动清理未完成的临时安装包，避免磁盘残留
 - 窗口主题设置幂等化：与当前值一致时直接返回，避免重复调用与重复日志

## ⚡ 性能
 - Naive UI 改为按需引入：naive-ui chunk 由约 1.42MB 降至 800KB（约 -44%）
 - 任务列表虚拟滚动：1000+ 任务时 DOM 节点从 N 行降至视口约 20 行
 - 分片信息改 canvas 绘制：1000 个块零 DOM 节点，保留悬停提示与主题跟随
 - 任务列表指纹对比改用滚动哈希，大列表每秒轮询的内存与 CPU 开销显著下降
 - 全局统计字段数值化：UI 层免去重复 parseInt，类型更安全
 - Aria2 配置按 mtime 增量重载：IPC 调用时不再每次读盘
 - 窗口不可见（托盘驻留/切后台）时暂停 RPC 轮询，回到前台立即补刷一次

## 🎨 UI/UX 与可访问性
 - 设计 token 体系补全（间距/字号/动效/圆角），关键文字对比度满足 WCAG AA
 - 9 个组件可访问性补强：aria-label、focus-visible、键盘可达、删除二次确认（popconfirm）、剪贴板降级
 - 设置页补充表单校验（端口范围 1024-65535 / URL 格式 / 数值范围）
 - 任务分片 hover 交互优化、空状态文案场景化
 - 连接状态图标切换过渡动画（连接/断开/连接中淡入缩放）
 - 侧边栏底部按钮悬浮微动（上浮 + 图标放大）、文件拖放区悬浮缩放
 - 主题切换全局颜色过渡动画（首次启动不播放，避免首帧闪烁）
 - 任务列表行点击忽略按钮/链接等交互元素，避免误触发选中
 - 任务名单行省略显示（配合虚拟滚动固定行高，全名通过悬浮提示展示）

## 🧹 代码质量与可维护性
 - 设置页 schema 驱动重构：7 页的 aria2 选项双向转换抽为统一框架（净减 312 行），特殊字段保留自定义转换
 - App.vue 拆分 3 个 composable（useThemeManager / useAutoRefresh / useAppLifecycle），script 由 244 行减至 29 行
 - TypeScript 严格化：开启 noUncheckedIndexedAccess；三份 tsconfig 抽取公共 base 统一配置
 - 长方法拆分（removeTask / loadTaskDetail / saveConfig 等），行为完全等价
 - parseInt 统一补充 radix；ESLint 引入 max-warnings 门禁
 - AppSettings 统一单一事实来源（src/shared/appSettings.ts），主进程与渲染层共用，消除双接口漂移
 - IPC 边界共享类型（src/shared/electronBridge.ts），preload 与 electron.d.ts 签名统一
 - Naive UI 主题 token 统一来源（themeTokens.ts），useThemeManager 与 feedback.ts 不再各维护一份
 - 设置保存改用深合并，局部嵌套更新不再覆盖同级字段
 - 任务搜索逻辑收拢至 taskUtils.searchTasks，消除 TaskList 中的重复实现

## 📦 构建与 CI
 - 补全 unplugin-vue-components 依赖声明，修复 CI 环境因缺失依赖导致的构建失败
 - Vite 构建配置优化：chunk 体积控制与 naive-ui 按需引入集成
