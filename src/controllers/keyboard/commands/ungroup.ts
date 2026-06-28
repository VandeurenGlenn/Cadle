import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isUngroup = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === 'g' && event.shiftKey && isPrimaryShortcut(event)
export const ungroup = () => undefined
export const keyCombination = { key: 'g', shiftKey: true, metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'shift', 'g'] : ['ctrl', 'shift', 'g']]
