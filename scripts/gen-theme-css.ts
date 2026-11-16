/* 由 designSystem.ts 生成 tokens.generated.css。用法：node --experimental-strip-types scripts/gen-theme-css.ts */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { themeCss } from '../src/styles/designSystem.ts'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'src', 'styles', 'tokens.generated.css')
writeFileSync(target, themeCss(), 'utf8')
console.log('wrote', target, themeCss().length, 'bytes')
