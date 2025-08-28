import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/downloading'
    },
    {
      path: '/downloading',
      name: 'downloading',
      component: () => import('@/views/TaskList.vue'),
      props: { taskType: 'active-and-waiting' }
    },
    {
      path: '/completed',
      name: 'completed',
      component: () => import('@/views/TaskList.vue'),
      props: { taskType: 'stopped' }
    },
    {
      path: '/stopped',
      redirect: '/completed'
    },
    {
      path: '/new',
      name: 'new',
      component: () => import('@/views/NewTask.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      redirect: '/settings/general'
    },
    {
      path: '/settings/general',
      name: 'general-settings',
      component: () => import('@/views/settings/GeneralSettings.vue')
    },
    {
      path: '/settings/aria2/basic',
      name: 'aria2-basic-settings',
      component: () => import('@/views/settings/Aria2BasicSettings.vue')
    },
    {
      path: '/settings/aria2/http-ftp-sftp',
      name: 'aria2-http-ftp-sftp-settings',
      component: () => import('@/views/settings/Aria2HttpFtpSftpSettings.vue')
    },
    {
      path: '/settings/aria2/http',
      name: 'aria2-http-settings',
      component: () => import('@/views/settings/Aria2HttpSettings.vue')
    },
    {
      path: '/settings/aria2/ftp-sftp',
      name: 'aria2-ftp-sftp-settings',
      component: () => import('@/views/settings/Aria2FtpSftpSettings.vue')
    },
    {
      path: '/settings/aria2/bt',
      name: 'aria2-bt-settings',
      component: () => import('@/views/settings/Aria2BtSettings.vue')
    },
    {
      path: '/settings/aria2/metalink',
      name: 'aria2-metalink-settings',
      component: () => import('@/views/settings/Aria2MetalinkSettings.vue')
    },
    {
      path: '/settings/aria2/rpc',
      name: 'aria2-rpc-settings',
      component: () => import('@/views/settings/Aria2RpcSettings.vue')
    },
    {
      path: '/settings/aria2/advanced',
      name: 'aria2-advanced-settings',
      component: () => import('@/views/settings/Aria2AdvancedSettings.vue')
    },
    {
      path: '/status',
      name: 'status',
      component: () => import('@/views/Status.vue')
    },
    {
      path: '/task/:gid',
      name: 'task-detail',
      component: () => import('@/views/TaskDetail.vue'),
      props: true
    }
  ]
})

export default router
