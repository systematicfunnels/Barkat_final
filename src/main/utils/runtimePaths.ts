import path from 'path'
import { app } from 'electron'

export const isPackagedApp = (): boolean => {
  if (typeof process.env.BARKAT_IS_PACKAGED === 'string') {
    return process.env.BARKAT_IS_PACKAGED === '1'
  }

  return Boolean(app?.isPackaged)
}

export const getUserDataPath = (): string => {
  if (process.env.BARKAT_USER_DATA_PATH) {
    return process.env.BARKAT_USER_DATA_PATH
  }

  if (typeof app?.getPath === 'function') {
    return app.getPath('userData')
  }

  if (process.env.BARKAT_DB_PATH) {
    return path.dirname(process.env.BARKAT_DB_PATH)
  }

  return path.resolve(process.cwd(), 'out')
}
