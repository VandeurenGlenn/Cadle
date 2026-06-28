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
  | 'tool-text'
  | 'tool-onewire'

export type NativeHotkey = {
  action: string
  keys: string[][]
}

export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)

const modifier = isMac ? 'meta' : 'ctrl'

export const isPrimaryShortcut = (event: KeyboardEvent): boolean => (isMac ? event.metaKey : event.ctrlKey)

export const hotkeyList: Record<string, NativeHotkey[]> = {
  general: [
    { action: 'undo', keys: [[modifier, 'z']] },
    {
      action: 'redo',
      keys: [
        [modifier, 'shift', 'z'],
        [modifier, 'y']
      ]
    },
    { action: 'copy', keys: [[modifier, 'c']] },
    { action: 'cut', keys: [[modifier, 'x']] },
    { action: 'paste', keys: [[modifier, 'v']] },
    { action: 'group selection', keys: [[modifier, 'g']] },
    { action: 'ungroup selection', keys: [[modifier, 'shift', 'g']] },
    {
      action: 'scale selection up',
      keys: [
        [modifier, '+'],
        [modifier, '='],
        [modifier, 'numpadadd']
      ]
    },
    {
      action: 'scale selection down',
      keys: [
        [modifier, '-'],
        [modifier, 'numpadsubtract']
      ]
    },
    { action: 'select all', keys: [[modifier, 'a']] },
    { action: 'delete selection', keys: [['delete'], ['backspace']] },
    { action: 'cancel current action', keys: [['esc']] }
  ],
  drawing: [
    { action: 'select tool', keys: [['v']] },
    { action: 'wall tool', keys: [['w']] },
    { action: 'door tool', keys: [['d']] },
    { action: 'window tool', keys: [['n']] },
    { action: 'gate tool', keys: [['g']] },
    { action: 'line tool', keys: [['l']] },
    { action: 'text tool', keys: [['t']] },
    { action: 'one-wire tool', keys: [['o']] },
    { action: 'pan canvas', keys: [['space', 'drag']] },
    { action: 'end wall chain', keys: [['double-click'], ['esc']] }
  ],
  navigation: [
    { action: 'zoom', keys: [[modifier, 'wheel']] },
    { action: 'pan viewport', keys: [['wheel'], ['trackpad']] }
  ]
}

const isEditableElement = (element: HTMLElement): boolean => {
  const tagName = element.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true
  if (element.isContentEditable) return true
  if (element.getAttribute('role') === 'textbox') return true
  if (element.localName.endsWith('-text-field')) return true
  return Boolean(element.closest('md-outlined-text-field, md-filled-text-field, md-outlined-select, md-filled-select'))
}

const activeElementChain = (): Element[] => {
  const elements: Element[] = []
  let root: Document | ShadowRoot = document
  let activeElement = root.activeElement

  while (activeElement) {
    elements.push(activeElement)
    if (!(activeElement instanceof HTMLElement) || !activeElement.shadowRoot) break
    root = activeElement.shadowRoot
    activeElement = root.activeElement
  }

  return elements
}

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && isEditableElement(target)

export const isEditableKeyboardEvent = (event: KeyboardEvent): boolean => {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (path.some((target) => target instanceof HTMLElement && isEditableElement(target))) return true
  return activeElementChain().some((element) => element instanceof HTMLElement && isEditableElement(element))
}

export const getNativeHotkeyAction = (event: KeyboardEvent): NativeHotkeyAction | null => {
  if (isEditableKeyboardEvent(event)) return null

  const key = event.key.toLowerCase()
  const primary = isPrimaryShortcut(event)

  if (primary && key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (primary && key === 'y') return 'redo'
  if (primary && key === 'c') return 'copy'
  if (primary && key === 'x') return 'cut'
  if (primary && key === 'v') return 'paste'
  if (primary && event.shiftKey && key === 'g') return 'ungroup'
  if (primary && key === 'g') return 'group'
  if (primary && (key === '+' || key === '=' || event.code === 'NumpadAdd')) return 'scale-up'
  if (primary && (key === '-' || event.code === 'NumpadSubtract')) return 'scale-down'
  if (primary && key === 'a') return 'select-all'
  if (key === 'delete' || key === 'backspace') return 'delete'
  if (key === 'escape') return 'escape'

  if (event.metaKey || event.ctrlKey || event.altKey) return null
  switch (key) {
    case 'v':
      return 'tool-select'
    case 'w':
      return 'tool-wall'
    case 'd':
      return 'tool-door'
    case 'n':
      return 'tool-window'
    case 'g':
      return 'tool-gate'
    case 'l':
      return 'tool-line'
    case 't':
      return 'tool-text'
    case 'o':
      return 'tool-onewire'
    default:
      return null
  }
}
