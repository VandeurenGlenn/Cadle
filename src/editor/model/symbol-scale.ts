const PUSH_BUTTON_PATH = /switches\/(?:(?:illuminated |double )?push button|push switch with safety cover)\.svg$/i

export const renderedSymbolScale = (path: string, scale: number): number =>
  Math.max(PUSH_BUTTON_PATH.test(path) ? 0.2 : 0.4, scale)
