import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isGroup = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'g' && isPrimaryShortcut(event)
export const group = () => undefined
export const keyCombination = { key: 'g', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'g'] : ['ctrl', 'g']]
