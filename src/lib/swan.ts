import type { SwanApi } from '../../electron/preload';

declare global {
  interface Window {
    swan: SwanApi;
  }
}

export const swan = window.swan;
