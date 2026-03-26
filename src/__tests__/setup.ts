/**
 * Test setup for Jest testing framework
 * Configures testing environment and mocks for Electron APIs
 */

export {}

// Global test utilities
declare global {
  var createMockCancellationToken: () => {
    cancelled: boolean;
    cancel(): void;
  };
  var createMockBrowserWindow: () => {
    webContents: {
      send: jest.Mock;
    };
    isDestroyed: jest.Mock;
  };
}

// Global test utilities
global.createMockCancellationToken = () => {
  let cancelled = false
  return {
    get cancelled() { return cancelled },
    cancel: () => { cancelled = true }
  }
}

global.createMockBrowserWindow = () => ({
  webContents: {
    send: jest.fn()
  },
  isDestroyed: jest.fn().mockReturnValue(false)
})

// Setup and teardown hooks
beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})
