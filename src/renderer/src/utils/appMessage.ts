import type { MessageInstance } from 'antd/es/message/interface'

let currentMessageApi: MessageInstance | null = null

export const bindMessageApi = (messageApi: MessageInstance): void => {
  currentMessageApi = messageApi
}

const getMessageApi = (): MessageInstance => {
  if (!currentMessageApi) {
    throw new Error('Ant Design message API is not ready yet.')
  }

  return currentMessageApi
}

export const appMessage: MessageInstance = {
  success: (...args) => getMessageApi().success(...args),
  error: (...args) => getMessageApi().error(...args),
  info: (...args) => getMessageApi().info(...args),
  warning: (...args) => getMessageApi().warning(...args),
  loading: (...args) => getMessageApi().loading(...args),
  open: (...args) => getMessageApi().open(...args),
  destroy: (...args) => getMessageApi().destroy(...args)
}
