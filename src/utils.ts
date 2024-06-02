import { Group, Object, Canvas as _Canvas } from 'fabric'
import type { DrawField } from './fields/draw.js'
import state from './state.js'

declare type currentObjectInClipboard = Group | Object | undefined

declare type Clipboard = {
  object: currentObjectInClipboard
}

interface Canvas extends _Canvas {
  shouldRender: boolean
}

export const clipboard: Clipboard = {
  object: undefined
}

export const shell = document.querySelector('app-shell')

export const pages = shell.shadowRoot.querySelector('custom-pages')

export const field = pages.querySelector('draw-field') as DrawField

export const canvas = field.canvas as Canvas

export const getActiveObjects = () => canvas.getActiveObjects()

export const getActiveObject = () => canvas.getActiveObject()

export const removeItems = items => {
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
  let items = getActiveObjects()
  canvas.history.push({ type: `move-${direction}`, items, amount: state.move.amount })
  for (const item of items) {
    if (item.type === 'activeselection') {
      // canvas.remove(item)

      // // @ts-ignore
      for (const _item of item._objects) {
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

export const moveUp = amount => {
  moveObjects('up', amount)
}

export const moveDown = amount => {
  moveObjects('down', amount)
}

export const moveLeft = amount => {
  moveObjects('left', amount)
}

export const moveRight = amount => {
  moveObjects('right', amount)
}

export const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('')

export const incrementLetter = matches => {
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
