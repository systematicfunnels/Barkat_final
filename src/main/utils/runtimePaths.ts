import { createRequire } from 'node:module'
import os from 'os'
import path from 'path'

type ElectronAppLike = {
  isPackaged?: boolean
  getPath?: (name: string) => string
}

const APP_NAME = 'Barkat'
const localRequire = createRequire(__filename)

const getElectronApp = (): ElectronAppLike | undefined => {
  try {
    return localRequire('electron')?.app as ElectronAppLike | undefined
  } catch {
    return undefined
  }
}

const getFallbackUserDataPath = (): string => {
  if (process.platform === 'win32') {
    const roamingAppData = process.env.APPDATA
    if (roamingAppData) {
      return path.join(roamingAppData, APP_NAME)
    }

    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      return path.join(localAppData, APP_NAME)
    }
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME)
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, APP_NAME)
  }

  return path.join(os.homedir(), '.config', APP_NAME)
}

export const isPackagedApp = (): boolean => {
  const app = getElectronApp()

  if (typeof process.env.BARKAT_IS_PACKAGED === 'string') {
    return process.env.BARKAT_IS_PACKAGED === '1'
  }

  if (typeof app?.isPackaged === 'boolean') {
    return app.isPackaged
  }

  const resourcesPath = process.resourcesPath
  if (resourcesPath) {
    const normalizedResourcesPath = resourcesPath.replace(/\\/g, '/').toLowerCase()
    if (!normalizedResourcesPath.includes('/node_modules/electron/dist/resources')) {
      return true
    }
  }

  return false
}

export const getUserDataPath = (): string => {
  const app = getElectronApp()

  if (process.env.BARKAT_USER_DATA_PATH) {
    return process.env.BARKAT_USER_DATA_PATH
  }

  if (typeof app?.getPath === 'function') {
    return app.getPath('userData')
  }

  if (isPackagedApp()) {
    return getFallbackUserDataPath()
  }

  if (process.env.BARKAT_DB_PATH) {
    return path.dirname(process.env.BARKAT_DB_PATH)
  }

  return path.resolve(process.cwd(), 'out')
}
