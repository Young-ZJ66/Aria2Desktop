/**
 * 生成 release 更新内容：从上个版本到当前版本的提交中，按 conventional commit 类型归类汇总
 * 用法: node scripts/generate-release-notes.mjs <newTag>
 * 自动查找上一版本 tag（按版本号倒序排除当前 tag），将生成结果写入 release-notes.md
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const newTag = process.argv[2]
if (!newTag) {
  console.error('用法: node scripts/generate-release-notes.mjs <newTag>')
  process.exit(1)
}

// 按版本号倒序列出所有 tag，排除当前 tag，取第一个作为上一版本
function getPrevTag() {
  try {
    const tags = execSync('git tag --sort=-v:refname', { encoding: 'utf-8' })
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => t !== newTag)
    return tags[0] || ''
  } catch {
    return ''
  }
}

// 获取两个 tag 之间的提交主题（不含 merge 提交）
function getCommits(prev, curr) {
  const range = prev ? `${prev}..${curr}` : curr
  try {
    return execSync(`git log --no-merges --format=%s ${range}`, { encoding: 'utf-8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// conventional commit 类型 -> 中文分组标题
const CATEGORIES = [
  { prefix: 'feat', label: '新功能' },
  { prefix: 'fix', label: '问题修复' },
  { prefix: 'perf', label: '性能优化' },
  { prefix: 'refactor', label: '代码重构' },
  { prefix: 'docs', label: '文档' },
  { prefix: 'build', label: '构建与打包' },
  { prefix: 'ci', label: '持续集成' },
  { prefix: 'style', label: '样式' },
  { prefix: 'chore', label: '其他' }
]

const ALL_PREFIXES = CATEGORIES.map((c) => c.prefix).join('|')
const TYPE_RE = new RegExp(`^(${ALL_PREFIXES})(\\([^)]*\\))?:`)
const STRIP_RE = new RegExp(`^(${ALL_PREFIXES})(\\([^)]*\\))?:\\s*`, 'i')

function stripPrefix(subject) {
  const stripped = subject.replace(STRIP_RE, '').trim()
  return stripped || subject
}

const prevTag = getPrevTag()
const commits = getCommits(prevTag, newTag)

const lines = []
lines.push('## 更新内容')
lines.push('')

if (commits.length === 0) {
  lines.push('无具体变更记录。')
} else {
  const groups = CATEGORIES.map(({ prefix, label }) => ({
    label,
    items: commits.filter((c) => new RegExp(`^${prefix}(\\([^)]*\\))?:`).test(c)).map(stripPrefix)
  })).filter((g) => g.items.length > 0)
  const uncategorized = commits.filter((c) => !TYPE_RE.test(c))

  if (groups.length === 0 && uncategorized.length === 0) {
    lines.push('无具体变更记录。')
  } else {
    for (const group of groups) {
      lines.push(`### ${group.label}`)
      for (const item of group.items) lines.push(`- ${item}`)
      lines.push('')
    }
    if (uncategorized.length > 0) {
      lines.push('### 其他')
      for (const c of uncategorized) lines.push(`- ${c}`)
      lines.push('')
    }
  }
}

if (prevTag) {
  lines.push(`> 变更范围：\`${prevTag}\` → \`${newTag}\``)
} else {
  lines.push(`> 首次发布版本：\`${newTag}\``)
}

const content = lines.join('\n')
fs.writeFileSync('release-notes.md', content, 'utf-8')
console.log(`已生成 release-notes.md（${commits.length} 条提交，${prevTag ? `范围 ${prevTag}..${newTag}` : `首次发布 ${newTag}`}）`)
