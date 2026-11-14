#!/usr/bin/env node
/**
 * Aria2Desktop MCP CLI
 *
 * 通过本机扩展接口的 /api/mcp（JSON-RPC）调用下载管理工具，适合脚本、CI 和
 * 不想安装 MCP 客户端的场景。
 *
 * 用法：
 *   ARIA2_DESKTOP_SECRET=<RPC 密钥> node scripts/aria2-desktop-cli.mjs tools
 *   ARIA2_DESKTOP_SECRET=... node scripts/aria2-desktop-cli.mjs list active
 *   ARIA2_DESKTOP_SECRET=... node scripts/aria2-desktop-cli.mjs add "https://example.com/file.iso"
 *   ARIA2_DESKTOP_SECRET=... node scripts/aria2-desktop-cli.mjs call set_speed_limit '{"download":"5M"}'
 *
 * 参数：--url <接口地址，默认 http://127.0.0.1:6801>、--secret <密钥>（也可用环境变量）
 */

import process from "node:process"

const args = process.argv.slice(2)
let baseUrl = process.env.ARIA2_DESKTOP_URL || "http://127.0.0.1:6801"
let secret = process.env.ARIA2_DESKTOP_SECRET || ""

function takeOption(name, short) {
  const index = args.findIndex((arg) => arg === name || (short && arg === short))
  if (index === -1) return undefined
  const value = args[index + 1]
  args.splice(index, 2)
  return value
}

baseUrl = takeOption("--url", "-u") || baseUrl
secret = takeOption("--secret", "-s") || secret

const command = args.shift()
let rpcId = 0

async function mcp(method, params) {
  const response = await fetch(baseUrl.replace(/\/$/, "") + "/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: "Bearer " + secret } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params })
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error("HTTP " + response.status + ": " + (data && data.error ? data.error : response.statusText))
  }
  if (data && data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data && data.result
}

async function callTool(name, toolArgs = {}) {
  const result = await mcp("tools/call", { name, arguments: toolArgs })
  const content = Array.isArray(result && result.content) ? result.content : []
  for (const item of content) {
    if (item && item.type === "text" && typeof item.text === "string") {
      try {
        console.log(JSON.stringify(JSON.parse(item.text), null, 2))
      } catch {
        console.log(item.text)
      }
    }
  }
  if (result && result.isError) process.exitCode = 1
}

async function main() {
  if (!command || command === "help" || command === "--help") {
    console.log("用法：node scripts/aria2-desktop-cli.mjs <tools|stats|list|add|pause|resume|remove|call> [参数]")
    console.log("环境变量：ARIA2_DESKTOP_SECRET（必需）、ARIA2_DESKTOP_URL（可选）")
    return
  }

  if (command === "tools") {
    const result = await mcp("tools/list", {})
    for (const tool of (result && result.tools) || []) {
      console.log(tool.name + "\t" + (tool.description || ""))
    }
    return
  }

  if (command === "stats") {
    await callTool("get_global_stats")
    return
  }

  if (command === "list") {
    const status = args[0] || "all"
    await callTool("list_tasks", { status })
    return
  }

  if (command === "add") {
    if (args.length === 0) throw new Error("add 需要至少一个 URL")
    // add_download 只接受单个 url（分类目录、重名处理都由应用侧决定），
    // 多 URL 逐个下发；早先传 { urls: [...] } 与工具 schema 不符，必定失败。
    const dir = takeOption("--dir", "-d")
    if (dir) {
      throw new Error(
        "add 不支持 --dir：目标目录由应用内的分类规则决定（设置 → 下载 → 分类目录），" +
          "需要指定目录请改用 call add_download 配合应用内设置"
      )
    }
    const fileName = takeOption("--fileName", "-n")
    for (const url of args) {
      await callTool("add_download", fileName ? { url, fileName } : { url })
    }
    return
  }

  if (["pause", "resume", "remove"].includes(command)) {
    if (!args[0]) throw new Error(command + " 需要 gid")
    const toolName = { pause: "pause_task", resume: "resume_task", remove: "remove_task" }[command]
    await callTool(toolName, { gid: args[0] })
    return
  }

  if (command === "call") {
    const name = args.shift()
    if (!name) throw new Error("call 需要工具名")
    const raw = args.shift()
    await callTool(name, raw ? JSON.parse(raw) : {})
    return
  }

  throw new Error("未知命令：" + command)
}

main().catch((error) => {
  console.error("错误：" + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
