import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isBringForward = (event: KeyboardEvent): boolean => event.key === ']' && isPrimaryShortcut(event)
export const bringForward = () => undefined
export const keyCombination = { key: ']', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', ']'] : ['ctrl', ']']]