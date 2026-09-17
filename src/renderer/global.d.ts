import type { HarnessStudioApi } from '../shared/contracts'

declare global {
  interface Window {
    harnessStudio: HarnessStudioApi
  }
}

export {}
