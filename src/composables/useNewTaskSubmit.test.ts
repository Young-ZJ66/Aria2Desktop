import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isConnected: true,
  closeNewTask: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  ensureMinimumDuration: vi.fn(async () => {}),
  getUserFriendlyError: vi.fn((error: unknown, fallback: string) => `${fallback}<${String(error)}>`)
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/utils/feedback', () => ({ message: { error: h.messageError, success: h.messageSuccess } }))
vi.mock('@/utils/errorMessages', () => ({ getUserFriendlyError: h.getUserFriendlyError }))
vi.mock('@/composables/useMinimumLoading', () => ({ ensureMinimumDuration: h.ensureMinimumDuration }))
vi.mock('@/stores/uiStore', () => ({ useUiStore: () => ({ closeNewTask: h.closeNewTask }) }))
vi.mock('@/stores/connectionStore', () => ({
  useConnectionStore: () => ({
    get isConnected() {
      return h.isConnected
    }
  })
}))

async function loadSubmit() {
  vi.resetModules()
  const { useNewTaskSubmit } = await import('./useNewTaskSubmit')
  return useNewTaskSubmit()
}

beforeEach(() => {
  h.isConnected = true
  h.closeNewTask.mockClear()
  h.messageError.mockClear()
  h.messageSuccess.mockClear()
  h.ensureMinimumDuration.mockClear()
  h.getUserFriendlyError.mockClear()
})

describe('提交骨架', () => {
  it('成功时提示、关弹窗并复位 submitting', async () => {
    const { submitting, runSubmit } = await loadSubmit()
    const perform = vi.fn(async () => '已添加 1 个任务')
    await runSubmit({ perform, fallbackError: '添加失败', logLabel: 'uri' })
    expect(perform).toHaveBeenCalledTimes(1)
    expect(h.messageSuccess).toHaveBeenCalledWith('已添加 1 个任务')
    expect(h.closeNewTask).toHaveBeenCalledTimes(1)
    expect(submitting.value).toBe(false)
  })

  it('提交过程中 submitting 为 true（按钮 loading 依赖它）', async () => {
    const { submitting, runSubmit } = await loadSubmit()
    const seen: boolean[] = []
    await runSubmit({
      perform: async () => {
        seen.push(submitting.value)
        return 'ok'
      },
      fallbackError: 'x',
      logLabel: 'uri'
    })
    expect(seen).toEqual([true])
    expect(submitting.value).toBe(false)
  })

  it('先跑表单校验，再跑连接校验', async () => {
    const { runSubmit } = await loadSubmit()
    const order: string[] = []
    const perform = vi.fn(async () => 'ok')
    await runSubmit({
      validate: async () => {
        order.push('validate')
      },
      precheck: () => {
        order.push('precheck')
        return 'checked'
      },
      perform,
      fallbackError: 'x',
      logLabel: 'uri'
    })
    expect(order).toEqual(['validate', 'precheck'])
  })

  it('校验抛错时不提交，给出兜底错误文案', async () => {
    const { submitting, runSubmit } = await loadSubmit()
    const perform = vi.fn(async () => 'ok')
    await runSubmit({
      validate: async () => {
        throw new Error('表单未填')
      },
      perform,
      fallbackError: '添加失败',
      logLabel: 'uri'
    })
    expect(perform).not.toHaveBeenCalled()
    expect(h.getUserFriendlyError).toHaveBeenCalledTimes(1)
    expect(h.messageError).toHaveBeenCalledWith('添加失败<Error: 表单未填>')
    expect(submitting.value).toBe(false)
  })
})

describe('连接与资源校验', () => {
  it('未连接时提示先连接，且不进入提交阶段', async () => {
    h.isConnected = false
    const { submitting, runSubmit } = await loadSubmit()
    const perform = vi.fn(async () => 'ok')
    const precheck = vi.fn(() => 'checked')
    await runSubmit({ precheck, perform, fallbackError: 'x', logLabel: 'uri' })
    expect(h.messageError).toHaveBeenCalledWith('newTask.connectFirst')
    expect(precheck).not.toHaveBeenCalled()
    expect(perform).not.toHaveBeenCalled()
    expect(h.ensureMinimumDuration).not.toHaveBeenCalled()
    expect(submitting.value).toBe(false)
  })

  it('precheck 返回 null 表示自行提示并终止，不提交', async () => {
    const { runSubmit } = await loadSubmit()
    const perform = vi.fn(async () => 'ok')
    await runSubmit({ precheck: () => null, perform, fallbackError: 'x', logLabel: 'uri' })
    expect(perform).not.toHaveBeenCalled()
    expect(h.messageError).not.toHaveBeenCalled()
    expect(h.messageSuccess).not.toHaveBeenCalled()
    expect(h.closeNewTask).not.toHaveBeenCalled()
  })

  it('precheck 的结果原样传给 perform（不靠闭包传值）', async () => {
    const { runSubmit } = await loadSubmit()
    const perform = vi.fn(async (checked: string[]) => `added ${checked.length}`)
    await runSubmit({
      precheck: () => ['https://a', 'https://b'],
      perform,
      fallbackError: 'x',
      logLabel: 'uri'
    })
    expect(perform).toHaveBeenCalledWith(['https://a', 'https://b'])
    expect(h.messageSuccess).toHaveBeenCalledWith('added 2')
  })

  it('没有 precheck 时 perform 收到 null（内部初值是 null，不是 undefined）', async () => {
    const { runSubmit } = await loadSubmit()
    const perform = vi.fn(async (checked: unknown) => String(checked))
    await runSubmit({ perform, fallbackError: 'x', logLabel: 'uri' })
    expect(perform).toHaveBeenCalledWith(null)
  })
})

describe('取消与失败', () => {
  it('perform 返回空串表示用户取消：不提示成功也不关弹窗', async () => {
    const { runSubmit } = await loadSubmit()
    await runSubmit({ perform: async () => '', fallbackError: 'x', logLabel: 'uri' })
    expect(h.messageSuccess).not.toHaveBeenCalled()
    expect(h.closeNewTask).not.toHaveBeenCalled()
    expect(h.messageError).not.toHaveBeenCalled()
  })

  it('perform 抛错时走友好错误文案并复位 submitting', async () => {
    const { submitting, runSubmit } = await loadSubmit()
    await runSubmit({
      perform: async () => {
        throw new Error('disk full')
      },
      fallbackError: '添加失败',
      logLabel: 'metalink'
    })
    expect(h.messageSuccess).not.toHaveBeenCalled()
    expect(h.closeNewTask).not.toHaveBeenCalled()
    expect(h.getUserFriendlyError).toHaveBeenCalledWith(expect.any(Error), '添加失败')
    expect(submitting.value).toBe(false)
  })

  it('进入提交阶段才补最短加载时长（校验就返回的路径不补）', async () => {
    const { runSubmit } = await loadSubmit()
    await runSubmit({ perform: async () => 'ok', fallbackError: 'x', logLabel: 'uri' })
    expect(h.ensureMinimumDuration).toHaveBeenCalledTimes(1)
    const [startedAt] = h.ensureMinimumDuration.mock.calls[0] as unknown as [number]
    expect(typeof startedAt).toBe('number')
  })

  it('失败路径同样补最短加载时长（按钮动画不能一闪而过）', async () => {
    const { runSubmit } = await loadSubmit()
    await runSubmit({
      perform: async () => {
        throw new Error('boom')
      },
      fallbackError: 'x',
      logLabel: 'uri'
    })
    expect(h.ensureMinimumDuration).toHaveBeenCalledTimes(1)
  })

  it('每页各自持有一份 submitting（互不干扰）', async () => {
    const first = await loadSubmit()
    const second = await loadSubmit()
    expect(first.submitting).not.toBe(second.submitting)
  })
})
