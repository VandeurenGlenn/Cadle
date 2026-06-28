import { isPrimaryShortcut, isMac } from '../hotkeys.js'

export const isFlip = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'f' && isPrimaryShortcut(event)
export const flip = () => undefined
export const keyCombination = { key: 'f', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'f'] : ['ctrl', 'f']]
