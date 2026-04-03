import type { NotificationInstance } from 'antd/es/notification/interface'

let currentNotificationApi: NotificationInstance | null = null

export const bindNotificationApi = (notificationApi: NotificationInstance): void => {
  currentNotificationApi = notificationApi
}

const getNotificationApi = (): NotificationInstance => {
  if (!currentNotificationApi) {
    throw new Error('Ant Design notification API is not ready yet.')
  }

  return currentNotificationApi
}

export const appNotification: NotificationInstance = {
  success: (...args) => getNotificationApi().success(...args),
  error: (...args) => getNotificationApi().error(...args),
  info: (...args) => getNotificationApi().info(...args),
  warning: (...args) => getNotificationApi().warning(...args),
  open: (...args) => getNotificationApi().open(...args),
  destroy: (...args) => getNotificationApi().destroy(...args)
}
