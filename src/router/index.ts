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
      path: '/queue',
      name: 'queue',
      component: () => import('@/views/QueueView.vue')
    },
    {
      path: '/status',
      name: 'status',
      component: () => import('@/views/Status.vue')
    },
    {
      path: '/instances',
      name: 'instances',
      component: () => import('@/views/InstancesView.vue')
    }
  ]
})

export default router
