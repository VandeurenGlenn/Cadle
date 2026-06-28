import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isSendBackwards = (event: KeyboardEvent): boolean => event.key === '[' && isPrimaryShortcut(event)
export const sendBackwards = () => undefined
export const keyCombination = { key: '[', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', '['] : ['ctrl', '[']]