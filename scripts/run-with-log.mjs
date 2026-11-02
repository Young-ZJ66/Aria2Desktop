/**
 * 带日志与失败注解的命令包装器。
 *
 * 为什么需要它：GitHub 的作业日志只有登录后才能看，匿名访问只能看到"Process completed
 * with exit code 1"这一句。失败时把关键行重新打成 `::error::` 注解，注解会渲染在运行页面上，
 * 任何人（包括没有登录的协作者、以及自动化工具）都能直接读到失败原因。
 *
 * 用法：
 *   node scripts/run-with-log.mjs <标签> <命令> [...参数]
 *   node scripts/run-with-log.mjs 单元测试 npm run test:run
 *
 * 行为：子进程输出照常透传到日志；同时落一份到 test-results/ci/<标签>.log；
 * 失败时把最后若干行里像错误的那几行升格为注解。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [, , label, ...command] = process.argv

if (!label || command.length === 0) {
  console.error('用法: node scripts/run-with-log.mjs <标签> <命令> [...参数]')
  process.exit(2)
}

const LOG_DIR = path.join(process.cwd(), 'test-results', 'ci')
const LOG_FILE = path.join(LOG_DIR, `${label.replace(/[\\/:*?"<>|]/g, '_')}.log`)
const TAIL_LIMIT = 40
const ANNOTATION_LIMIT = 8
const ERROR_LINE = /(\bFAIL\b|✕|AssertionError|\berror\b|\bError:|TS\d{4}|problems? \(|exit code [1-9])/

fs.mkdirSync(LOG_DIR, { recursive: true })
fs.writeFileSync(LOG_FILE, '')

const tail = []

function record(chunk) {
  const text = chunk.toString()
  process.stdout.write(text)
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    tail.push(line)
    if (tail.length > TAIL_LIMIT) tail.shift()
  }
  fs.appendFileSync(LOG_FILE, text)
}

const child = spawn(command[0], command.slice(1), {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
  env: process.env
})

child.stdout.on('data', record)
child.stderr.on('data', record)

function report(code, signal) {
  const failed = code !== 0 && code !== null
  if (!failed) return

  const reason = signal ? `被信号 ${signal} 终止` : `退出码 ${code}`
  const picked = tail.filter((line) => ERROR_LINE.test(line)).slice(-ANNOTATION_LIMIT)
  console.log(`::error::${label} 失败（${reason}），完整日志见 test-results/ci 产物`)
  for (const line of picked) {
    console.log(`::error::${line.trim().slice(0, 300)}`)
  }
}

child.on('error', (error) => {
  console.log(`::error::${label} 无法启动：${error.message}`)
  process.exit(1)
})

child.on('close', (code, signal) => {
  report(code, signal)
  process.exit(signal ? 1 : code ?? 1)
})
