# 插件注册表签名工具（plugin-registry）

v1.5.0 起，插件市场默认只接受**已签名**的注册表与插件包（D-02）。本目录提供
维护者侧的签名/校验脚本，以及客户端必须与之保持一致的规范化规范。

## 为什么注册表本身也要签名

客户端默认从固定 tag 拉取 `plugin-registry.json`（见
`src/shared/appSettings.ts` 的 `PLUGIN_REGISTRY_PINNED_TAG`），但"从哪个 URL 拉"
只能防换地址，防不了内容被替换：仓库被接管、CDN 被劫持、镜像同步出错，都会让
客户端拿到一份地址合法、内容被换过的注册表，进而把攻击者的 `entryUrl` 当成
官方插件装进用户机器。因此注册表带 Ed25519 签名，验签失败时**拒绝整个列表**
（不是逐条跳过——列表本身已不可信）。

## 规范（客户端与服务端必须完全一致）

- 载荷 = 注册表去掉 `signature` 字段后的**规范化 JSON**；
- 规范化：对象键按字典序排序、数组保持原顺序、丢弃 `undefined`、无多余空白、UTF-8；
- 算法：Ed25519（`crypto.sign(null, payload, privateKey)`）；
- 签名以 base64 存入顶层 `signature` 字段。

两侧实现：
- 维护者侧 `scripts/plugin-registry/sign-registry.mjs`（本目录）；
- 客户端 `electron/services/pluginManager.ts` 的 `canonicalizeRegistry` /
  `registrySignaturePayload` / `verifyRegistrySignature` / `verifyRegistryTrust`。

任何一侧改动都会让所有已有签名失效，故两侧各有测试固定该规范
（`sign-registry.test.mjs` 与 `pluginManager.install.test.ts` 的"注册表签名校验"组）。

## 用法

```bash
# 签发（私钥只在维护者本机，绝不能进仓库）
node scripts/plugin-registry/sign-registry.mjs sign plugin-registry.json \
  --key private-key.pem --out plugin-registry.signed.json

# 校验（用内置公钥，确认签名能被客户端接受）
node scripts/plugin-registry/sign-registry.mjs verify plugin-registry.json \
  --pubkey public-key.pem
```

`validateRegistry()` 同时做结构校验：`version` 必须为 `1`；每条插件条目必须有
合法 `id`（`/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/`）、非空 `version`、https 的
`entryUrl`、64 位十六进制 `sha256`。

## 发布前校验：`npm run verify:registry`

签名只靠上面的人工流程，CI 里原本没有任何一步验证「tag 下那份注册表确实签对了」——
签错 / 忘签 / 签完又改内容，都要等用户装上才发现市场是空的。`scripts/plugin-registry/verify-published-registry.mjs`
补上这道闸门，已接入 `ci.yml` 与 `release.yml` 的质量闸门：

```bash
npm run verify:registry              # 离线校验（CI 用）：结构 + 签名口径 + 固定 tag 与版本对齐
npm run verify:registry -- --online  # 额外拉取已发布注册表，比对签名载荷逐字节一致（发版前用）
```

判定口径与客户端完全一致：空清单免签（无条目就无代码可装）；非空清单必须能被
`DEFAULT_TRUSTED_PLUGIN_PUBLISHERS` 里的某个公钥验签通过；`PLUGIN_REGISTRY_PINNED_TAG`
必须等于 `package.json` 版本的 `v` 前缀形式。`--online` 比对的是**签名载荷**而非文件字节：
客户端只对载荷验签，JSON 格式差异不影响安全，但内容（条目、URL、sha256）必须一致。

## 客户端接线（已生效）

`electron/services/pluginMarketService.ts` 的 `list()` 在解析出 `parsed` 之后、
遍历 `rawPlugins` 之前调用 `verifyRegistryTrust(parsed, settings.trustedPluginPublishers ?? [])`，
失败返回 `REGISTRY_SIGNATURE_INVALID`（整份列表拒绝，不逐条跳过）。

唯一例外是**空清单**（`plugins: []`）：没有条目就没有可安装内容，攻击者把它换成空表
只能造成"市场暂时是空的"，不能借此装入代码；这样未配置签名私钥时市场也不会永久报错。
非空清单一律验签。

传入空发布者清单时会回落到内置官方公钥，因此调用方忘记传值也不会退化成"跳过验签"。
单元测试见 `electron/services/pluginMarketService.test.ts`。

## 升级 tag 的流程

1. 用新的 tag 更新 `PLUGIN_REGISTRY_PINNED_TAG`（`src/shared/appSettings.ts`）；
2. 确认该 tag 下的 `plugin-registry.json` 已被签名；
3. 若同时轮换签名密钥，必须把新公钥加入 `DEFAULT_TRUSTED_PLUGIN_PUBLISHERS`，
   **保留旧公钥**直到确认所有在用版本都已升级，否则老客户端会拒绝新注册表。
