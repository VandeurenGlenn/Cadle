import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isSendToBack = (event: KeyboardEvent): boolean =>
  event.key === '[' && event.shiftKey && isPrimaryShortcut(event)
export const sendToBack = () => undefined
export const keyCombination = { key: '[', shiftKey: true, metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'shift', '['] : ['ctrl', 'shift', '[']]