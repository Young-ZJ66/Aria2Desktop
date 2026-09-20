import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { getUserFriendlyError } from '@/utils/errorMessages'
import { useUiStore } from '@/stores/uiStore'
import { useConnectionStore } from '@/stores/connectionStore'

/**
 * 新建任务三页（URI / 种子 / Metalink）共用的提交骨架。
 *
 * 这三页原先各自实现了一遍同构流程，差异只有"校验什么、组装什么选项、调哪个 store 方法、提示什么"。
 * 这里把骨架收敛到一处：
 *   表单校验 → 连接校验 → 资源校验 → submitting 置位 → 提交 → 成功提示 + 关弹窗 → 失败提示 → 复位 submitting
 *
 * 行为保持（不要顺手"优化"）：
 * - `submitting` 的置位时机与旧实现一致：在连接校验之后、真正提交之前，并在 finally 中复位；
 * - 失败统一经 `getUserFriendlyError` 包装；成功路径**不复位表单**（只有用户点「重置」才清空）；
 * - 连接校验优先于资源校验（先提示"请先连接"、再提示文件/URL 问题）。
 *
 * 关于 `submitting` 的作用域：每个 pane 各自调用本 composable，因此标志是 per-tab 的。
 * 旧实现三页共用一个标志，但实际不可见（同一时刻只有一个标签页在操作，且提交很快）；
 * 若将来需要"跨页统一禁用"，应改为由壳持有后下发。
 */
export function useNewTaskSubmit() {
  const { t } = useI18n()
  const uiStore = useUiStore()
  const connectionStore = useConnectionStore()

  const submitting = ref(false)

  interface RunSubmitOptions<TChecked> {
    /**
     * 表单校验；不传表示该页没有需要校验的表单（如流媒体页）。
     * 返回类型用 `unknown`：`n-form` 的 validate() 会返回校验结果对象，这里只关心"是否抛错"。
     */
    validate?: () => Promise<unknown>
    /**
     * 资源/格式校验。返回 `null` 表示终止本次提交（提示由它自己给出，不触发 perform）；
     * 否则返回值会原样传给 perform —— 这样"校验时算出来的东西"（解析好的 URL 列表、文件对象）
     * 不必靠闭包变量传递，也就不会出现"perform 里再判一次空"的冗余分支。
     */
    precheck?: () => TChecked | null
    /** 真正提交；resolve 出的文案作为成功提示。
     *  返回**空串**表示用户在提交过程中取消（如重名确认选择"取消"）：
     *  不提示成功、不关闭弹窗，让用户继续调整表单。 */
    perform: (checked: TChecked) => Promise<string>
    /** 失败时的兜底文案 */
    fallbackError: string
    /** 日志前缀，便于定位是哪一页失败 */
    logLabel: string
  }

  async function runSubmit<TChecked = void>(options: RunSubmitOptions<TChecked>): Promise<void> {
    try {
      await options.validate?.()

      if (!connectionStore.isConnected) {
        message.error(t('newTask.connectFirst'))
        return
      }

      let checked: TChecked | null = null
      if (options.precheck) {
        checked = options.precheck()
        if (checked === null) return
      }

      submitting.value = true
      const successMessage = await options.perform(checked as TChecked)
      // 空串 = 用户在提交过程中取消了本次任务：不提示成功、也不关闭弹窗
      if (!successMessage) return
      message.success(successMessage)
      uiStore.closeNewTask()
    } catch (error) {
      console.error(`[${options.logLabel}] Failed to add task:`, error)
      message.error(getUserFriendlyError(error, options.fallbackError))
    } finally {
      submitting.value = false
    }
  }

  return { submitting, runSubmit }
}
