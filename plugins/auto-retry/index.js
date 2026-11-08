/**
 * Auto Retry Plugin
 *
 * 原生不支持的能力：下载失败后自动重试。
 * Aria2Desktop 只提供手动「重试」按钮；本插件监听 onDownloadError，
 * 读取失败任务的原始 URI 并重新加入队列，最多重试 3 次。
 *
 * 说明：aria2 每次 addUri 都会生成新的 GID，因此重试次数按任务名记录；
 * 任务名在 aria2 中通常来自 URL 或种子名称，足以覆盖同一个失败任务。
 */

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
let attempts = {}

function retryKey(task) {
  return (task && (task.name || task.gid)) || 'unknown'
}

function collectUris(task) {
  const uris = []
  const files = task && task.files
  if (!files || !files.length) return uris
  for (let i = 0; i < files.length; i++) {
    const fileUris = files[i].uris || []
    for (let j = 0; j < fileUris.length; j++) {
      if (fileUris[j] && fileUris[j].uri) uris.push(fileUris[j].uri)
    }
  }
  return uris
}

module.exports = {
  onActivate: function () {
    console.log('Auto Retry plugin activated (max ' + MAX_RETRIES + ' retries)')
  },

  onDownloadError: function (task) {
    const key = retryKey(task)
    const count = attempts[key] || 0
    if (count >= MAX_RETRIES) {
      console.log('Auto Retry: giving up on ' + key)
      notify.send('Auto Retry', key + ' failed after ' + MAX_RETRIES + ' retries.')
      delete attempts[key]
      return
    }

    // tellStopped 里才有 files[].uris；错误事件本身只带 gid/name
    return aria2.getStoppedTasks().then(function (stopped) {
      let current = null
      for (let i = 0; i < stopped.length; i++) {
        if (stopped[i] && stopped[i].gid === task.gid) { current = stopped[i]; break }
      }
      if (!current) return

      const uris = collectUris(current)
      if (!uris.length) {
        console.log('Auto Retry: no reusable URI for ' + key)
        return
      }

      attempts[key] = count + 1
      const options = {}
      if (current.dir) options.dir = current.dir
      console.log('Auto Retry: retry ' + attempts[key] + '/' + MAX_RETRIES + ' for ' + key)
      notify.send('Auto Retry', 'Retrying ' + key + ' (' + attempts[key] + '/' + MAX_RETRIES + ')')

      return new Promise(function (resolve) {
        setTimeout(resolve, RETRY_DELAY_MS)
      }).then(function () {
        return aria2.addUri(uris, options)
      })
    }).catch(function (error) {
      console.error('Auto Retry failed:', error && error.message ? error.message : String(error))
    })
  },

  onDownloadComplete: function (task) {
    const key = retryKey(task)
    if (attempts[key]) delete attempts[key]
  },

  onDeactivate: function () {
    attempts = {}
    console.log('Auto Retry plugin deactivated')
  }
}
