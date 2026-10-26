import type { PongApi } from '../shared/api'

declare global {
  interface Window {
    pong: PongApi
  }
}

export {}
