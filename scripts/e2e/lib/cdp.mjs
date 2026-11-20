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

// 单条 CDP 命令的兜底超时。没有它时，一旦渲染层忙或 CDP 不回包，
// send() 返回的 Promise 会永远 pending，整轮 e2e 静默挂死到 CI 作业超时（曾发生一次 40 分钟）。
export const CDP_COMMAND_TIMEOUT_MS = 20000

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
        send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
          return new Promise((resolve, reject) => {
            const id = ++nextId
            const timer = setTimeout(() => {
              pending.delete(id)
              reject(new Error(`CDP 命令超时（${timeoutMs}ms）：${method}`))
            }, timeoutMs)
            pending.set(id, { resolve, reject, timer })
            try {
              ws.send(JSON.stringify({ id, method, params }))
            } catch (error) {
              // 套接字已关闭时 ws.send 会同步抛错；不在这里收尾就又是一个永远 pending 的 Promise
              pending.delete(id)
              clearTimeout(timer)
              reject(new Error(`CDP 命令发送失败：${method}（${error instanceof Error ? error.message : error}）`))
            }
          })
        },
        close() {
          ws.close()
        }
      })
    ws.onerror = () => reject(new Error(`CDP 连接失败：${wsUrl}`))
    // 连接断开时把还在等的命令全部拒掉，否则它们会一直 pending
    ws.onclose = () => {
      for (const [id, entry] of pending) {
        pending.delete(id)
        clearTimeout(entry.timer)
        entry.reject(new Error(`CDP 连接已关闭：${wsUrl}`))
      }
    }
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const entry = message.id ? pending.get(message.id) : undefined
      if (entry) {
        pending.delete(message.id)
        clearTimeout(entry.timer)
        entry.resolve(message)
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

/**
 * 截图保存到磁盘；失败只告警不抛。
 * 截图是辅助产物（CI 上传用于人工排查），不该因为一次截图超时让整轮 e2e 挂死，
 * 所以这里 best-effort：成功返回路径，失败返回 null。
 */
export async function capture(session, filePath, options = {}) {
  const { clip, timeoutMs = 15000 } = options || {}
  try {
    const params = clip ? { format: 'png', clip } : { format: 'png' }
    const result = await session.send('Page.captureScreenshot', params, timeoutMs)
    const data = result?.result?.data
    if (!data) throw new Error('返回内容缺少 data 字段')
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
    return filePath
  } catch (error) {
    console.log(`WARN 截图跳过：${filePath}（${error instanceof Error ? error.message : error}）`)
    return null
  }
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

/**
 * 删除临时目录：Windows 上被 kill 掉的 Chrome 句柄释放有延迟，一次性 rmSync 会抛
 * EBUSY（force 只忽略 ENOENT），曾让整轮 e2e 在最后清理阶段判失败——所有断言其实都 PASS。
 * 这里重试几次，最终仍失败只 warn 不抛：临时目录残留不该改写测试结论。
 */
export async function removeDirWithRetry(dir, { attempts = 5, delayMs = 300 } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      return true
    } catch (error) {
      if (i === attempts) {
        console.warn(`WARN 临时目录清理失败（已重试 ${attempts} 次）：${dir} :: ${error?.code ?? error}`)
        return false
      }
      await sleep(delayMs)
    }
  }
  return false
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
