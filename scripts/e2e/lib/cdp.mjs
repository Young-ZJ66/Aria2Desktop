/**
 * E2E 公共工具：CDP（Chrome DevTools Protocol）客户端、轮询、截图、进程树清理。
 *
 * 只依赖 Node 内置模块（Node 22+ 自带全局 WebSocket），不引入 puppeteer/playwright，
 * 避免为几个断言增加数百 MB 依赖。
 */

import http from 'node:http'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 发送 HTTP 请求并解析 JSON（CDP 的 /json/list 等端点） */
export function httpJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body || 'null'))
        } catch {
          resolve(body)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

/** 等待条件成立（返回最后取到的值） */
export async function waitFor(fn, { timeoutMs = 60000, intervalMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await fn()
      if (last) return last
    } catch {
      // 目标尚未就绪：继续轮询
    }
    await sleep(intervalMs)
  }
  throw new Error(`等待超时：${label}`)
}

/** 连接一个 CDP target，返回命令发送器与事件收集器 */
export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const events = []
    let nextId = 0
    ws.onopen = () =>
      resolve({
        events,
        send(method, params = {}) {
          return new Promise((res) => {
            const id = ++nextId
            pending.set(id, res)
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close() {
          ws.close()
        }
      })
    ws.onerror = () => reject(new Error(`CDP 连接失败：${wsUrl}`))
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      } else if (message.method) {
        events.push(message)
      }
    }
  })
}

/** 在页面/Service Worker 中求值；抛异常时把异常文本带回 Node 侧 */
export async function evalIn(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.result?.exceptionDetails) {
    throw new Error(`求值异常：${result.result.exceptionDetails.text}（${expression.slice(0, 120)}）`)
  }
  return result.result?.result?.value
}

/** 截图保存到磁盘 */
export async function capture(session, filePath) {
  const result = await session.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(filePath, Buffer.from(result.result.data, 'base64'))
  return filePath
}

/** 收集渲染层未捕获异常与 error 级日志文本（用于断言"无运行时错误"） */
export function collectErrors(session) {
  return session.events.filter(
    (event) =>
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
  )
}

/** 结束整个进程树（Windows 用 taskkill /T，POSIX 用进程组） */
export function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 进程已退出
    }
  }
}

/** 断言收集器：统一输出 PASS/FAIL 与最终汇总 */
export function createReporter() {
  const results = []
  return {
    results,
    check(name, ok, detail = '') {
      results.push({ name, ok: Boolean(ok), detail: String(detail) })
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
    },
    get failed() {
      return results.filter((item) => !item.ok)
    },
    summary() {
      const failed = this.failed
      // CI 上的作业日志必须登录才能看，匿名只剩一句 "Process completed with exit code 1"。
      // 把失败断言升格成 ::error:: 注解，运行页面上任何人不登录也能读到是哪一条、卡在什么地方。
      if (process.env.GITHUB_ACTIONS === 'true') {
        for (const item of failed.slice(0, 10)) {
          const title = escapeWorkflowCommand(item.name)
          const message = escapeWorkflowCommand(item.detail || '断言失败（无附加信息）')
          console.log(`::error title=${title}::${message}`)
        }
        if (failed.length > 10) {
          console.log(`::error title=E2E::还有 ${failed.length - 10} 条失败断言未列出，见作业日志`)
        }
      }
      console.log(`\n结果：${results.length - failed.length} 项通过，${failed.length} 项失败`)
      return failed.length
    }
  }
}

/** GitHub Actions 工作流命令里 %、换行需要转义，否则注解会被截断 */
function escapeWorkflowCommand(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}
