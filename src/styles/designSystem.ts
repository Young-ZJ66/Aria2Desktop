/**
 * 设计语言 v2「Instrument」令牌 —— 全应用唯一事实来源。
 *
 * 为什么推翻 v1 而不是继续打补丁：
 * v1 的令牌是按「CSS 变量清单」组织的（--bg-primary / --text-secondary / --border-light），
 * 它描述的是「第几号颜色」而不是「这个颜色扮演什么角色」。于是每个新页面都要重新决定
 * 一次「卡片用 primary 还是 secondary」，深色模式只能靠逐条手写覆盖，阴影在深色下失效
 * 也没人负责——136 处 font-size、65 处 border-radius 字面量就是这样长出来的。
 *
 * v2 把令牌拆成三层：
 *   1. 色阶（neutral / brand / status）—— 只有这一层是「颜色」
 *   2. 角色（bg-surface / text-muted / accent-text…）—— 组件只允许消费角色
 *   3. 结构标尺（space / radius / text / elevation / motion）—— 与主题无关
 * 深色模式是「角色重映射」，不是第二套色值清单。
 *
 * 生成物：src/styles/tokens.generated.css（由 scripts/gen-theme-css.ts 生成，勿手改）
 * 一致性：src/styles/designSystem.test.ts 断言生成物与本源一致，并检查关键配色的 AA 对比度。
 */

export type ThemeMode = 'light' | 'dark'

/** 中性色阶：冷灰（色相 220 附近、低彩度），保证彩色状态色落在上面时不会被染色 */
export const neutral = {
  n0: '#ffffff',
  n25: '#fcfcfd',
  n50: '#f7f8fa',
  n100: '#f2f4f7',
  n150: '#eaedf2',
  n200: '#dfe3ea',
  n250: '#d3d8e2',
  n300: '#c2c9d6',
  n350: '#aab2c2',
  n400: '#8f98aa',
  n450: '#788294',
  n500: '#636d7f',
  n550: '#565f70',
  n600: '#4a5262',
  n650: '#3f4654',
  n700: '#353b47',
  n750: '#2c313c',
  n800: '#242932',
  n850: '#1d2129',
  n900: '#171b22',
  n925: '#141821',
  n950: '#111419',
  n975: '#0d1016',
  n1000: '#0a0c11'
} as const

/**
 * 品牌蓝。不是连续色阶：
 * - accent(#4560e0) 白底 5.24:1，是浅色主题的实心按钮底与强调色；
 * - onDark(#5465d8) 深色主题实心按钮底，白字 4.96:1（v1 直接拿 #6c86f5 当按钮底，白字只有 3.30:1）；
 * - textOnDark(#93a8ff) 深色主题里「当文字用」的蓝，面板上 6.4:1。
 * 三个值职责不同，强行凑成一条色阶只会让其中两个失准。
 */
export const brand = {
  wash: '#eef1ff',
  tint: '#dfe5ff',
  soft: '#c4ceff',
  light: '#a3b2fb',
  glow: '#7f90f5',
  accent: '#4560e0',
  accentHover: '#3a50c6',
  accentPressed: '#2f41a3',
  onDark: '#5465d8',
  onDarkHover: '#6274e6',
  onDarkPressed: '#4655bd',
  textOnDark: '#93a8ff'
} as const

export interface StatusColor {
  /** 文字/图标：必须在该主题面板底色上达到 AA */
  text: string
  /** 实心底：配 --ds-text-on-status 使用 */
  solid: string
  /** 淡色底：标签、提示条、图表填充 */
  subtle: string
}

export interface ThemeRoles {
  /* 背景与表面：深色主题靠「表面比页面更亮」建立层级，浅色主题靠阴影 */
  bgApp: string
  bgSurface: string
  bgRaised: string
  bgSunken: string
  bgHover: string
  bgActive: string
  bgSelected: string
  bgOverlay: string
  /* 描边：三级，深色主题下比 v1 更亮，否则卡片会糊在背景里 */
  borderSubtle: string
  borderBase: string
  borderStrong: string
  /* 文字：四级，faint 仅用于装饰性图标，正文一律 base 以上 */
  textStrong: string
  textBase: string
  textMuted: string
  textFaint: string
  textOnAccent: string
  /* 强调色：solid 用于按钮底，text 用于文字/图标（两者在深色下不是同一个值） */
  accent: string
  accentHover: string
  accentPressed: string
  accentText: string
  accentSubtle: string
  accentBorder: string
  focusRing: string
  /* 状态色 */
  success: StatusColor
  warning: StatusColor
  danger: StatusColor
  info: StatusColor
}

export const light: ThemeRoles = {
  bgApp: neutral.n50,
  bgSurface: neutral.n0,
  bgRaised: neutral.n0,
  bgSunken: neutral.n100,
  bgHover: neutral.n100,
  bgActive: neutral.n150,
  bgSelected: brand.wash,
  bgOverlay: 'rgba(16, 20, 28, 0.44)',
  borderSubtle: neutral.n150,
  borderBase: neutral.n200,
  borderStrong: neutral.n300,
  textStrong: neutral.n900,
  textBase: neutral.n650,
  textMuted: neutral.n500,
  textFaint: neutral.n450,
  textOnAccent: '#ffffff',
  accent: brand.accent,
  accentHover: brand.accentHover,
  accentPressed: brand.accentPressed,
  accentText: brand.accentHover,
  accentSubtle: brand.wash,
  accentBorder: brand.soft,
  focusRing: brand.accent,
  success: { text: '#15803d', solid: '#16a34a', subtle: '#e8f7ee' },
  warning: { text: '#b45309', solid: '#d97706', subtle: '#fdf3e3' },
  danger: { text: '#c81e1e', solid: '#dc2626', subtle: '#fdeaea' },
  info: { text: '#1d4ed8', solid: '#3b82f6', subtle: '#eaf2fe' }
}

export const dark: ThemeRoles = {
  bgApp: neutral.n975,
  bgSurface: '#1a1f28',
  bgRaised: '#262d3c',
  bgSunken: '#141821',
  bgHover: '#232936',
  bgActive: '#2c3442',
  bgSelected: '#1d2740',
  bgOverlay: 'rgba(4, 6, 10, 0.62)',
  borderSubtle: '#232936',
  borderBase: '#2c3442',
  borderStrong: '#3d4759',
  textStrong: '#eef1f6',
  textBase: '#c3cad6',
  textMuted: '#98a1b3',
  textFaint: '#6f7a8c',
  textOnAccent: '#ffffff',
  accent: brand.onDark,
  accentHover: brand.onDarkHover,
  accentPressed: brand.onDarkPressed,
  accentText: brand.textOnDark,
  accentSubtle: 'rgba(84, 101, 216, 0.18)',
  accentBorder: 'rgba(147, 168, 255, 0.32)',
  focusRing: brand.textOnDark,
  success: { text: '#63e2b7', solid: '#34d399', subtle: 'rgba(52, 211, 153, 0.14)' },
  warning: { text: '#f2c97d', solid: '#fbbf24', subtle: 'rgba(251, 191, 36, 0.14)' },
  danger: { text: '#ff8b8b', solid: '#f87171', subtle: 'rgba(248, 113, 113, 0.14)' },
  info: { text: '#8ab4f8', solid: '#60a5fa', subtle: 'rgba(96, 165, 250, 0.14)' }
}

export const roles: Record<ThemeMode, ThemeRoles> = { light, dark }

/** 间距标尺：4 的倍数为主，允许 2/6/10 做微观微调 */
export const space = {
  0: '0px',
  2: '2px',
  4: '4px',
  6: '6px',
  8: '8px',
  10: '10px',
  12: '12px',
  16: '16px',
  20: '20px',
  24: '24px',
  32: '32px',
  40: '40px',
  48: '48px',
  64: '64px'
} as const

/** 圆角：12 是卡片，8 是控件，6 是标签，16 是浮层 */
export const radius = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  pill: '999px'
} as const

/** 控件高度：表格行 52 / 工具栏 34 / 紧凑按钮 28 */
export const control = {
  heightSm: '28px',
  heightMd: '34px',
  heightLg: '40px',
  rowComfortable: '52px',
  rowCompact: '40px',
  navItem: '36px',
  sidebarWidth: '236px',
  sidebarRailWidth: '68px',
  footerHeight: '36px'
} as const

/**
 * 字号阶梯。v1 是 11/12/13/14 + h1 22，中间断档，导致 naive 卡片标题(18px)直接和 h1 抢层级。
 * v2 补 16px 一档作为「区块标题」，并把 22px 收到 20px——标题不需要那么大，需要的是层级清晰。
 */
export const text = {
  micro: { size: '11px', lineHeight: '1.45' },
  small: { size: '12px', lineHeight: '1.5' },
  body: { size: '13px', lineHeight: '1.55' },
  bodyLg: { size: '14px', lineHeight: '1.5' },
  title: { size: '16px', lineHeight: '1.4' },
  h1: { size: '20px', lineHeight: '1.3' },
  display: { size: '24px', lineHeight: '1.25' }
} as const

export const fontWeight = { regular: '400', medium: '500', semibold: '600' } as const

/**
 * 抬升。浅色主题用阴影；深色主题阴影在近黑底上不可见，改用「描边 + 内高光 + 更深的投影」，
 * 这是 v1 深色界面「糊成一片」的直接原因。组件只消费 elev-1/2/3，不关心主题。
 */
export const elevation = {
  light: {
    e1: '0 1px 2px rgba(16, 20, 28, 0.06), 0 1px 3px rgba(16, 20, 28, 0.04)',
    e2: '0 4px 12px -2px rgba(16, 20, 28, 0.10), 0 2px 4px rgba(16, 20, 28, 0.05)',
    e3: '0 16px 40px -12px rgba(16, 20, 28, 0.22), 0 4px 10px rgba(16, 20, 28, 0.06)'
  },
  dark: {
    e1: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 1px 2px rgba(0, 0, 0, 0.45)',
    e2: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 10px 28px -10px rgba(0, 0, 0, 0.65)',
    e3: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.06), 0 24px 56px -16px rgba(0, 0, 0, 0.78)'
  }
} as const

export const motion = {
  dur1: '90ms',
  dur2: '140ms',
  dur3: '200ms',
  dur4: '280ms',
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easePress: 'cubic-bezier(0.3, 0, 0.5, 1)'
} as const

export const font = {
  sans: "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  mono: "'Cascadia Mono', 'Cascadia Code', 'Consolas', 'SFMono-Regular', monospace"
} as const

/** 角色 → CSS 变量。生成脚本与测试都从这里读，组件里不允许再出现裸色值。 */
export function cssVars(mode: ThemeMode): Record<string, string> {
  const r = roles[mode]
  const out: Record<string, string> = {}
  out['bg-app'] = r.bgApp
  out['bg-surface'] = r.bgSurface
  out['bg-raised'] = r.bgRaised
  out['bg-sunken'] = r.bgSunken
  out['bg-hover'] = r.bgHover
  out['bg-active'] = r.bgActive
  out['bg-selected'] = r.bgSelected
  out['bg-overlay'] = r.bgOverlay
  out['border-subtle'] = r.borderSubtle
  out['border-base'] = r.borderBase
  out['border-strong'] = r.borderStrong
  out['text-strong'] = r.textStrong
  out['text-base'] = r.textBase
  out['text-muted'] = r.textMuted
  out['text-faint'] = r.textFaint
  out['text-on-accent'] = r.textOnAccent
  out['accent'] = r.accent
  out['accent-hover'] = r.accentHover
  out['accent-pressed'] = r.accentPressed
  out['accent-text'] = r.accentText
  out['accent-subtle'] = r.accentSubtle
  out['accent-border'] = r.accentBorder
  out['focus-ring'] = r.focusRing
  for (const name of ['success', 'warning', 'danger', 'info'] as const) {
    out['status-' + name + '-text'] = r[name].text
    out['status-' + name + '-solid'] = r[name].solid
    out['status-' + name + '-subtle'] = r[name].subtle
  }
  for (const [k, v] of Object.entries(space)) out['space-' + k] = v
  for (const [k, v] of Object.entries(radius)) out['radius-' + k] = v
  for (const [k, v] of Object.entries(control)) out['control-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = v
  for (const [k, v] of Object.entries(text)) {
    out['text-' + k + '-size'] = v.size
    out['text-' + k + '-leading'] = v.lineHeight
  }
  for (const [k, v] of Object.entries(elevation[mode])) out['elev-' + k.slice(1)] = v
  for (const [k, v] of Object.entries(motion)) out['motion-' + k.replace(/[A-Z0-9]/g, (m) => '-' + m.toLowerCase())] = v
  out['font-sans'] = font.sans
  out['font-mono'] = font.mono
  return out
}

/** WCAG 相对亮度；测试用它断言「角色之间」的对比度，而不是靠肉眼。 */
export function relativeLuminance(hex: string): number {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  const [r0, g0, b0] = linear as [number, number, number]
  return 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
/** 生成 :root / [data-theme] 变量块。生成脚本与测试共用，保证格式完全一致。 */
export function cssVarBlock(mode: ThemeMode): string {
  const vars = cssVars(mode)
  const lines = Object.keys(vars).map((k) => '  --ds-' + k + ': ' + vars[k] + ';')
  return lines.join('\n')
}

export function themeCss(): string {
  const header = [
    '/*',
    ' * 本文件由 scripts/gen-theme-css.ts 从 src/styles/designSystem.ts 生成，请勿手改。',
    ' * 改色/改标尺请改 designSystem.ts，然后执行 npm run theme:css。',
    ' */'
  ].join('\n')
  const lightBlock = ':root,\n[data-theme=\'light\'] {\n' + cssVarBlock('light') + '\n}'
  const darkBlock = '[data-theme=\'dark\'] {\n' + cssVarBlock('dark') + '\n}'
  return header + '\n\n' + lightBlock + '\n\n' + darkBlock + '\n'
}
