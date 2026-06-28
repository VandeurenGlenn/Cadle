import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isPrint = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'p' && isPrimaryShortcut(event)
export const print = () => window.print()
export const keyCombination = { key: 'p', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'p'] : ['ctrl', 'p']]
