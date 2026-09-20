/**
 * Download Notifier Plugin
 * Demonstrates the Aria2Desktop plugin API.
 * Logs download events and sends notifications.
 */

module.exports = {
  onActivate: function() {
    console.log('Download Notifier plugin activated!')
  },

  onDownloadComplete: function(task) {
    console.log('Download completed:', task.name)
    notify.send('Download Complete', task.name)
  },

  onDownloadStart: function(task) {
    console.log('Download started:', task.name)
  },

  onDeactivate: function() {
    console.log('Download Notifier plugin deactivated')
  }
}
