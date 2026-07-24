import { isCopy, copy, keys as copyKeys } from './commands/copy.js'
import { isCut, cut, keys as cutKeys } from './commands/cut.js'
import { isEscape, escape, keys as escapeKeys } from './commands/escape.js'
import { isFlip, flip, keys as flipKeys } from './commands/flip.js'
import { isGroup, group, keys as groupKeys } from './commands/group.js'
import {
  isNudge,
  nudge,
  keys as nudgeKeys,
  precisionKeys as nudgePrecisionKeys,
  gridKeys as nudgeGridKeys
} from './commands/nudge.js'
import { keys as panKeys } from './commands/pan.js'
import { isPaste, paste, keys as pasteKeys } from './commands/paste.js'
import { isRemove, remove, keys as removeKeys } from './commands/remove.js'
import { isRotate, rotate, keys as rotateKeys } from './commands/rotate.js'
import { isScale, scale, keys as scaleKeys } from './commands/scale.js'
import { isSelectAll, selectAll, keys as selectAllKeys } from './commands/select-all.js'
import { isToolHotkey, tool, keys as toolKeys } from './commands/tool.js'
import { isUndo, undo, keys as undoKeys } from './commands/undo.js'
import { isUngroup, ungroup, keys as ungroupKeys } from './commands/ungroup.js'
import { keys as wallChainEndKeys } from './commands/wall-chain-end.js'
import { isEditableKeyboardEvent, isEditableTarget, isMac, isPrimaryShortcut } from './utils.js'

export type NativeHotkeyAction =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'group'
  | 'ungroup'
  | 'scale-up'
  | 'scale-down'
  | 'select-all'
  | 'delete'
  | 'escape'
  | 'tool-select'
  | 'tool-wall'
  | 'tool-door'
  | 'tool-window'
  | 'tool-gate'
  | 'tool-line'
  | 'tool-rect'
  | 'tool-circle'
  | 'tool-arc'
  | 'tool-text'
  | 'tool-symbol'
  | 'tool-onewire'
  | 'nudge-up'
  | 'nudge-down'
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up-precision'
  | 'nudge-down-precision'
  | 'nudge-left-precision'
  | 'nudge-right-precision'
  | 'nudge-up-grid'
  | 'nudge-down-grid'
  | 'nudge-left-grid'
  | 'nudge-right-grid'
  | 'rotate-left'
  | 'rotate-right'
  | 'flip-horizontal'
  | 'flip-vertical'

export type NativeHotkey = {
  action: string
  keys: string[][]
}

export const hotkeyList: Record<string, NativeHotkey[]> = {
  general: [
    { action: 'undo / redo', keys: undoKeys },
    { action: 'copy', keys: copyKeys },
    { action: 'cut', keys: cutKeys },
    { action: 'paste', keys: pasteKeys },
    { action: 'group selection', keys: groupKeys },
    { action: 'ungroup selection', keys: ungroupKeys },
    { action: 'scale selection', keys: scaleKeys },
    { action: 'move selection · 5 px', keys: nudgeKeys },
    { action: 'move selection · 1 px', keys: nudgePrecisionKeys },
    { action: 'move selection · grid step', keys: nudgeGridKeys },
    { action: 'select all', keys: selectAllKeys },
    { action: 'delete selection', keys: removeKeys },
    { action: 'cancel current action', keys: escapeKeys }
  ],
  transform: [
    { action: 'rotate selection', keys: rotateKeys },
    { action: 'flip selection', keys: flipKeys }
  ],
  drawing: [
    { action: 'tool shortcuts', keys: toolKeys },
    { action: 'pan canvas', keys: panKeys },
    { action: 'end wall chain', keys: wallChainEndKeys }
  ],
  navigation: [
    { action: 'zoom', keys: [[isMac ? 'meta' : 'ctrl', 'wheel']] },
    { action: 'pan viewport', keys: [['wheel'], ['trackpad']] }
  ]
}

export { isEditableTarget, isEditableKeyboardEvent, isPrimaryShortcut, isMac }

export const getNativeHotkeyAction = (event: KeyboardEvent): NativeHotkeyAction | null => {
  if (isEditableKeyboardEvent(event)) return null

  if (isUndo(event)) return undo(event)
  if (isCopy(event)) return copy()
  if (isPaste(event)) return paste()
  if (isRemove(event)) return remove()
  if (isCut(event)) return cut()
  if (isGroup(event)) return group()
  if (isUngroup(event)) return ungroup()
  if (isScale(event)) return scale(event)
  if (isRotate(event)) return rotate(event)
  if (isFlip(event)) return flip(event)
  if (isEscape(event)) return escape()
  if (isNudge(event)) return nudge(event)

  if (isToolHotkey(event)) return tool(event) ?? null

  return isSelectAll(event) ? selectAll() : null
}
