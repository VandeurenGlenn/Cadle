import { isEditableTarget, type NativeHotkeyAction } from '../hotkeys.js'

const TOOL_MAP: Record<string, NativeHotkeyAction | undefined> = {
  v: 'tool-select',
  w: 'tool-wall',
  d: 'tool-door',
  n: 'tool-window',
  g: 'tool-gate',
  l: 'tool-line',
  t: 'tool-text',
  o: 'tool-onewire'
}

export const isToolHotkey = (event: KeyboardEvent): boolean => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return false
  if (isEditableTarget(event.target)) return false
  const key = event.key.toLowerCase()
  return key in TOOL_MAP
}

export const tool = (event: KeyboardEvent): NativeHotkeyAction | undefined => TOOL_MAP[event.key.toLowerCase()]
export const keys = [['v'], ['w'], ['d'], ['n'], ['g'], ['l'], ['t'], ['o']]
