import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isSave = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 's' && isPrimaryShortcut(event)
export const save = () => window.cadleShell?.save?.()
export const keyCombination = { key: 's', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 's'] : ['ctrl', 's']]
