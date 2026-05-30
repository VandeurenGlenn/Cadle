import { Group, FabricObject, Canvas as _Canvas } from 'fabric'
import type { DrawField } from './fields/draw.js'
import state from './state.js'
import { HistoryAction } from './types.js'

declare type currentObjectInClipboard = Group | FabricObject | undefined

declare type Clipboard = {
  object: currentObjectInClipboard
}

interface Canvas extends _Canvas {
  shouldRender: boolean
}

export const clipboard: Clipboard = {
  object: undefined
}

// Lazy shell/canvas refs: import order across the app is non-deterministic
// and these used to crash at module load when utils.ts ran before
// `<app-shell>` had attached its shadow root. Resolving on first access
// (and re-resolving until the chain is satisfied) keeps the long-standing
// public API (`shell`, `pages`, `field`, `canvas`) without forcing every
// call site to switch to a function.
let _shell: any
let _pages: any
let _field: any
let _canvas: any

const resolveShellRefs = () => {
  if (!_shell) _shell = document.querySelector('app-shell')
  if (!_pages) _pages = _shell?.shadowRoot?.querySelector('custom-pages')
  if (!_field) _field = _pages?.querySelector('draw-field')
  if (!_canvas) _canvas = _field?.canvas
}

const lazyProxy = <T extends object>(getTarget: () => any): T =>
  new Proxy({} as T, {
    get(_t, prop) {
      resolveShellRefs()
      const target = getTarget()
      const value = target?.[prop as any]
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(_t, prop, value) {
      resolveShellRefs()
      const target = getTarget()
      if (target) target[prop as any] = value
      return true
    },
    has(_t, prop) {
      resolveShellRefs()
      return prop in (getTarget() ?? {})
    }
  })

export const shell = lazyProxy<any>(() => _shell)
export const pages = lazyProxy<any>(() => _pages)
export const field = lazyProxy<DrawField>(() => _field)
export const canvas = lazyProxy<Canvas>(() => _canvas)

export const getActiveObjects = () => canvas.getActiveObjects()

export const getActiveObject = () => canvas.getActiveObject()

export const shouldRender = (should: boolean) => {
  canvas.shouldRender = should
}

/**
 * remove items from canvas
 * @param items
 */

export const removeItems = (items) => {
  for (const item of items) {
    canvas.remove(item)
  }
}

/**
 * position object according mouse position
 * @returns {left, right}
 */
export const positionObject = (): { left: number; top: number } => {
  return {
    left: state.mouse.position.x as number,
    top: state.mouse.position.y as number
  }
}

const moveObject = (object, direction: 'left' | 'right' | 'down' | 'up', amount) => {
  if (direction === 'left') object.left = Math.round((object.left - amount) * 100) / 100
  if (direction === 'right') object.left = Math.round((object.left + amount) * 100) / 100
  if (direction === 'up') object.top = Math.round((object.top - amount) * 100) / 100
  if (direction === 'down') object.top = Math.round((object.top + amount) * 100) / 100
}

const moveObjects = (direction: 'left' | 'right' | 'down' | 'up', amount?: number) => {
  amount = amount || 0.5
  const items = getActiveObjects()
  history.push({ type: `move`, objects: items })
  for (const item of items) {
    if (item.type === 'activeSelection') {
      // canvas.remove(item)

      const selectedObjects = (item as any).getObjects?.() ?? []
      for (const _item of selectedObjects) {
        moveObject(_item, direction, amount)
        // canvas.setActiveObject(_item)
      }

      moveObject(item, direction, amount)
    } else {
      moveObject(item, direction, amount)
      // canvas.setActiveObject(item)
    }
  }

  canvas.shouldRender = true
}

export const moveUp = (amount) => {
  moveObjects('up', amount)
}

export const moveDown = (amount) => {
  moveObjects('down', amount)
}

export const moveLeft = (amount) => {
  moveObjects('left', amount)
}

export const moveRight = (amount) => {
  moveObjects('right', amount)
}

export const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('')

export const incrementLetter = (matches) => {
  let text = ''

  if (matches?.length > 0) {
    if (matches.length > 1) {
      if (matches[1] === 'Z') {
        text = `${matches[0]}A`
      } else {
        text = `${matches[0]}${alphabet[alphabet.indexOf(matches[1].toLowerCase()) + 1].toUpperCase()}`
      }
    } else {
      if (matches[0] === 'Z') {
        text = 'AA'
      } else {
        text = alphabet[alphabet.indexOf(matches[0].toLowerCase()) + 1].toUpperCase()
      }
    }
  }
  return text
}

export const incrementSocket = () => {
  const textMatch = state.text.current.match(/\D/g)
  const text = incrementLetter(textMatch)
  state.text.current = `${text}${state.text.lastNumber}`
}

export const canvasContainer = () => field.canvasContainer as HTMLElement

export const snapToGrid = ({ left, top }: { left?: number; top?: number }): { left?: number; top?: number } => {
  if (!state.freeDraw) {
    if (left) left = Math.round(left / state.gridSize) * state.gridSize
    if (top) top = Math.round(top / state.gridSize) * state.gridSize
  }
  return { left, top }
}

const applyAction = (action: HistoryAction, method: 'undo' | 'redo') => {
  const object = (action.object ?? action.objects?.[0]) as any
  if (!object) return
  switch (action.type) {
  case 'remove':
    if (method === 'undo') {
      canvas.add(object)
    } else {
      canvas.remove(object)
    }

    break
  case 'add':
    if (method === 'undo') {
      canvas.remove(object)
    } else {
      canvas.add(object)
    }

    break
  case 'modify':
    if (method === 'undo' && action.prevState) {
      object.set(action.prevState)
    } else if (method === 'redo' && action.newState) {
      object.set(action.newState)
    }

    break
  }
}

export const history = {
  stack: [] as any[],
  position: -1,
  applyAction,
  push(action: HistoryAction) {
    // if we are not at the end of the stack, remove all redo actions
    if (this.position < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.position + 1)
    }

    this.stack.push(action)
    this.position++
  },
  undo() {
    if (this.position >= 0) {
      const action = this.stack[this.position]
      this.position--
      this.applyAction(action, 'undo')
      return action
    }
    return null
  },
  redo() {
    if (this.position < this.stack.length - 1) {
      this.position++
      const action = this.stack[this.position]
      return action
    }
    return null
  }
}
