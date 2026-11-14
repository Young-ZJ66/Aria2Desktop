/**
 * 下载完成动作规则服务。
 *
 * 渲染层在 aria2 完成通知里只带 gid/name，主进程按 gid 反查 tellStatus，
 * 再按用户配置的条件（分类/扩展名/状态）执行移动、重命名、打开、通知、
 * Webhook 或解压。规则按顺序执行，单个规则失败只记录日志，不影响后续规则。
 */
import { Notification, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
import { extractArchive } from './archiveService'
import { getWebhookDispatchService } from './webhookDispatchService'
import { getFileExtension, resolveCategory } from '../../src/shared/fileCategories'
import type { CompletionRule, CompletionRuleAction } from '../../src/shared/appSettings'

const logger = createLogger('CompletionRules')

interface Aria2FileStatus {
  path?: string
  uris?: Array<{ uri?: string }>
}

interface Aria2TaskStatus {
  gid?: string
  status?: string
  dir?: string
  files?: Aria2FileStatus[]
  bittorrent?: { name?: string }
  errorMessage?: string
}

function taskFiles(status: Aria2TaskStatus): string[] {
  const dir = status.dir || ''
  return (status.files || [])
    .map(file => String(file.path || ''))
    .filter(Boolean)
    .map(filePath => (path.isAbsolute(filePath) ? filePath : path.join(dir, filePath)))
}

function ruleMatches(rule: CompletionRule, status: Aria2TaskStatus, succeeded: boolean): boolean {
  if (!rule.enabled) return false
  const condition = rule.condition || {}
  if (condition.status === 'complete' && !succeeded) return false
  if (condition.status === 'error' && succeeded) return false
  const files = taskFiles(status)
  if (condition.extensions && condition.extensions.length > 0) {
    const allowed = new Set(condition.extensions.map(ext => String(ext).toLowerCase().replace(/^\./, '')))
    if (!files.some(file => allowed.has(getFileExtension(file)))) return false
  }
  if (condition.category) {
    const settings = getSettingsFresh()
    const categories = settings.category?.categories || []
    const matched = files.some(file => resolveCategory(path.basename(file), categories).id === condition.category)
    if (!matched) return false
  }
  return true
}

async function moveFile(source: string, targetDir: string, taskDir: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(source)
    if (!stat.isFile()) return null
    await fs.promises.mkdir(targetDir, { recursive: true })
    const relative = path.isAbsolute(taskDir) ? path.relative(taskDir, source) : path.basename(source)
    const safeRelative = relative.startsWith('..') || path.isAbsolute(relative) ? path.basename(source) : relative
    let destination = path.join(targetDir, safeRelative)
    await fs.promises.mkdir(path.dirname(destination), { recursive: true })
    // 目标已存在时加序号，绝不覆盖用户已有文件
    if (fs.existsSync(destination)) {
      const ext = path.extname(destination)
      const base = destination.slice(0, destination.length - ext.length)
      let index = 1
      while (fs.existsSync(`${base} (${index})${ext}`)) index += 1
      destination = `${base} (${index})${ext}`
    }
    try {
      await fs.promises.rename(source, destination)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EXDEV') throw error
      await fs.promises.copyFile(source, destination)
      await fs.promises.unlink(source)
    }
    return destination
  } catch (error) {
    logger.warn(`移动文件失败: ${source} -> ${targetDir}`, error)
    return null
  }
}

async function executeAction(action: CompletionRuleAction, status: Aria2TaskStatus): Promise<void> {
  const files = taskFiles(status)
  if (action.type === 'move') {
    const taskDir = status.dir || (files[0] ? path.dirname(files[0]) : '')
    for (const file of files) await moveFile(file, action.targetDir, taskDir)
    return
  }
  if (action.type === 'rename') {
    if (files.length !== 1) {
      logger.warn('重命名动作仅支持单文件任务，已跳过')
      return
    }
    const file = files[0]!
    const ext = path.extname(file)
    const base = path.basename(file, ext)
    const date = new Date().toISOString().slice(0, 10)
    const nextBase = action.pattern
      .replace(/\{name\}/g, base)
      .replace(/\{ext\}/g, ext.replace(/^\./, ''))
      .replace(/\{date\}/g, date)
      .replace(/[\\/:*?"<>|]/g, '_')
    const destination = path.join(path.dirname(file), `${nextBase || base}${ext}`)
    if (destination !== file) await fs.promises.rename(file, destination)
    return
  }
  if (action.type === 'open') {
    if (files.length === 1) await shell.openPath(files[0]!)
    else if (status.dir) await shell.openPath(status.dir)
    return
  }
  const succeeded = status.status === 'complete'
  if (action.type === 'notify') {
    if (!Notification.isSupported()) return
    new Notification({
      title: String(action.title || (succeeded ? '下载完成' : '下载失败')).slice(0, 120),
      body: String(action.body || status.bittorrent?.name || status.files?.[0]?.path || '').slice(0, 500)
    }).show()
    return
  }
  if (action.type === 'webhook') {
    const payload = {
      event: succeeded ? 'download.complete' : 'download.error',
      gid: status.gid || '',
      status: status.status || (succeeded ? 'complete' : 'error'),
      name: status.bittorrent?.name || (files[0] ? path.basename(files[0]) : ''),
      files,
      dir: status.dir || '',
      timestamp: new Date().toISOString()
    }
    // 投递交给队列（失败指数退避重试 + HMAC 签名 + 失败队列可在设置页手动重试）；
    // 这里不再内联 fetch：对端一次 502 就永久丢事件的旧行为正是本轮要修的问题。
    const dispatcher = getWebhookDispatchService()
    if (!dispatcher) {
      logger.warn(`Webhook 投递服务未就绪，已跳过: ${action.url}`)
      return
    }
    dispatcher.enqueue(action, payload)
    return
  }
  if (action.type === 'extract') {
    for (const file of files) {
      const result = await extractArchive(file)
      if (!result.success) logger.warn(`自动解压失败: ${file}`, result.reason)
    }
  }
}

async function readTaskStatus(gid: string): Promise<Aria2TaskStatus | null> {
  const settingsNow = getSettingsFresh()
  try {
    return await callAria2Rpc({
      ...activeRpcOptions(settingsNow),
      method: 'aria2.tellStatus',
      params: [gid, ['gid', 'status', 'dir', 'files', 'bittorrent', 'errorMessage']]
    }) as Aria2TaskStatus
  } catch (error) {
    logger.warn(`读取任务状态失败: ${gid}`, error)
    return null
  }
}

/**
 * 对单个完成任务执行匹配的规则；返回是否有规则被触发。
 *
 * aria2 的 downloadComplete/downloadError 通知可能早于 tellStatus 的状态切换，
 * 因此这里对 active/waiting 状态做短暂轮询，避免规则因状态竞态被跳过。
 */
export async function applyCompletionRules(gid: string): Promise<boolean> {
  const settings = getSettingsFresh()
  const rules = settings.completionRules || []
  if (rules.length === 0) return false
  let status: Aria2TaskStatus | null = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    status = await readTaskStatus(gid)
    if (!status) return false
    if (status.status !== 'active' && status.status !== 'waiting' && status.status !== 'paused') break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  if (!status) return false
  if (status.status === 'active' || status.status === 'waiting' || status.status === 'paused') {
    logger.warn(`任务状态仍为 ${status.status}，跳过完成规则: ${gid}`)
    return false
  }
  const succeeded = status.status === 'complete'
  let matched = false
  for (const rule of rules) {
    if (!ruleMatches(rule, status, succeeded)) continue
    matched = true
    logger.info(`执行完成规则 "${rule.name}" (gid=${gid})`)
    for (const action of rule.actions || []) {
      try {
        await executeAction(action, status)
      } catch (error) {
        logger.warn(`完成规则 "${rule.name}" 的动作 ${action.type} 失败`, error)
      }
    }
  }
  return matched
}
