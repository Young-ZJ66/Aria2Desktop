/**
 * Web 控制台端到端检查。
 *
 * 这条链路完全不经过渲染层——页面跑在浏览器里，用 CDP 覆盖不到，
 * 而它正是「无令牌能不能读到任务」「审计会不会丢」「页面脚本会不会被 CSP 拦掉」
 * 这类风险的所在。所以直接对真实运行中的应用发 HTTP 请求验证。
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { sleep } from './lib/cdp.mjs'

const REQUEST_TIMEOUT_MS = 8000

function request(url, options) {
  const opts = options || {}
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('请求超时：' + url)))
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

async function requestJson(url, options) {
  const res = await request(url, options)
  let json = null
  try { json = JSON.parse(res.body.toString('utf-8')) } catch { json = null }
  return { status: res.status, headers: res.headers, json }
}

function authHeaders(token) {
  return token ? { Authorization: 'Bearer ' + token } : {}
}

/** 读取 SSE 首帧：拿到一个完整事件块就断开，避免长连接拖住进程 */
export function readSseFirstEvent(url, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: authHeaders(token) }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve({ status: res.statusCode || 0, event: '' })
        return
      }
      let buffer = ''
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        req.destroy()
        resolve({ status: 200, event: buffer })
      }
      const timer = setTimeout(finish, REQUEST_TIMEOUT_MS)
      // 服务端先发一行 retry: 3000 控制重连节奏，真正的数据帧在它后面，
      // 所以不能见到第一个空行就收手，要等带 event: 行的帧。
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf-8')
        const frames = buffer.split('\n\n')
        for (let i = 0; i < frames.length; i++) {
          if (frames[i].indexOf('event:') === 0 || frames[i].indexOf('\nevent:') > 0) { finish(); return }
        }
      })
      res.on('end', finish)
      res.on('error', finish)
    })
    req.on('error', (error) => reject(error))
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('SSE 超时')))
  })
}

export async function runWebConsoleCheck({ reporter, outDir, baseUrl, token, auditFile }) {
  // 1. 登录页本身必须能打开，且带严格安全头
  const home = await request(baseUrl + '/')
  const csp = String(home.headers['content-security-policy'] || '')
  const homeText = home.body.toString('utf-8')
  reporter.check('Web 控制台首页可访问', home.status === 200 && String(home.headers['content-type'] || '').indexOf('text/html') >= 0, 'status=' + home.status)
  reporter.check(
    '首页带严格 CSP 且禁止被嵌入',
    csp.indexOf("default-src 'none'") >= 0 && csp.indexOf("frame-ancestors 'none'") >= 0 && home.headers['x-frame-options'] === 'DENY',
    csp
  )
  reporter.check('首页脚本受 CSP 哈希白名单约束', csp.indexOf("script-src 'sha256-") >= 0, csp)
  reporter.check(
    '首页包含登录表单与页面脚本',
    homeText.indexOf('id="token"') >= 0 && homeText.indexOf('data-act="login"') >= 0 && homeText.indexOf('applyStaticText') >= 0,
    'bytes=' + home.body.length
  )

  // 2. PWA 资源：手机「添加到主屏幕」依赖清单、Service Worker 与图标
  const manifest = await requestJson(baseUrl + '/manifest.webmanifest')
  const sw = await request(baseUrl + '/sw.js')
  const icon = await request(baseUrl + '/icon-192.png')
  reporter.check(
    'PWA 清单与 Service Worker 可下载',
    manifest.status === 200 && !!manifest.json && manifest.json.name !== undefined && sw.status === 200 && String(sw.headers['content-type'] || '').indexOf('javascript') >= 0,
    'manifest=' + manifest.status + ' sw=' + sw.status
  )
  reporter.check('PWA 图标可下载', icon.status === 200 && icon.body.length > 100, 'bytes=' + icon.body.length)

  // 3. OpenAPI 文档（外部自动化接入靠它）
  const openapi = await requestJson(baseUrl + '/openapi.json')
  const paths = openapi.json && openapi.json.paths ? openapi.json.paths : {}
  reporter.check(
    'OpenAPI 文档可用且覆盖状态接口',
    openapi.status === 200 && !!openapi.json && String(openapi.json.openapi || '').indexOf('3.') === 0 && !!paths['/api/status'],
    'openapi=' + (openapi.json ? openapi.json.openapi : 'null')
  )

  // 4. 鉴权边界：无令牌、错令牌都必须 401，正确令牌才放行
  const anonymous = await requestJson(baseUrl + '/api/status')
  const wrongToken = await requestJson(baseUrl + '/api/status', { headers: authHeaders('wrong-token-0123456789') })
  reporter.check('无令牌访问接口被拒', anonymous.status === 401, 'status=' + anonymous.status)
  reporter.check('错误令牌访问接口被拒', wrongToken.status === 401, 'status=' + wrongToken.status)

  const status = await requestJson(baseUrl + '/api/status', { headers: authHeaders(token) })
  const payload = status.json || {}
  const taskCount = (payload.active || []).length + (payload.waiting || []).length + (payload.stopped || []).length
  reporter.check(
    '正确令牌可读取任务状态',
    status.status === 200 && payload.ok === true && Array.isArray(payload.active) && Array.isArray(payload.stopped) && !!payload.globalStat,
    'status=' + status.status
  )
  reporter.check('状态接口能读到真实任务', taskCount > 0, 'tasks=' + taskCount)

  // 5. 写入路径的输入校验：非法协议不能被塞进 aria2
  const badUri = await requestJson(baseUrl + '/api/tasks', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: ['javascript:alert(1)'] })
  })
  reporter.check('非法 URI 被拒绝', badUri.status === 400 && !!badUri.json && badUri.json.error === 'invalid_uri', 'status=' + badUri.status)

  // 6. 未知路由不能回落到首页
  const notFound = await requestJson(baseUrl + '/definitely-not-a-route')
  reporter.check('未知路由返回 404', notFound.status === 404, 'status=' + notFound.status)

  // 7. SSE 首帧：订阅后立即拿到一帧任务状态
  const sse = await readSseFirstEvent(baseUrl + '/api/events', token)
  reporter.check('SSE 首帧推送任务状态', sse.status === 200 && sse.event.indexOf('event: status') >= 0, 'event=' + sse.event.slice(0, 60))

  // 8. 审计：失败的鉴权尝试要留痕，且必须落盘（重启后仍能看到）
  const audit = await requestJson(baseUrl + '/api/audit', { headers: authHeaders(token) })
  const items = audit.json && Array.isArray(audit.json.items) ? audit.json.items : []
  const hasAuthFailure = items.some((entry) => entry && entry.action === 'auth' && entry.success === false)
  reporter.check('审计记录包含失败的鉴权尝试', audit.status === 200 && hasAuthFailure, 'items=' + items.length)

  // 落盘是防抖写入（1 秒），等一拍再读文件
  await sleep(1500)
  let persisted = []
  try {
    persisted = JSON.parse(fs.readFileSync(auditFile, 'utf-8'))
  } catch {
    persisted = []
  }
  reporter.check(
    '审计日志已落盘（重启不丢）',
    Array.isArray(persisted) && persisted.length > 0 && persisted.some((entry) => entry && entry.action === 'auth'),
    'file=' + auditFile + ' entries=' + (Array.isArray(persisted) ? persisted.length : 0)
  )

  // 留一份页面快照便于人工排查（登录页就是用户第一眼看到的界面）
  try {
    fs.writeFileSync(path.join(outDir, 'web-console-login.html'), home.body)
  } catch {
    // 截图/快照属辅助产物，写不了不影响结论
  }
}
