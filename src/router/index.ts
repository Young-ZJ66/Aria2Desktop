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
      path: '/status',
      name: 'status',
      component: () => import('@/views/Status.vue')
    }
  ]
})

export default router
