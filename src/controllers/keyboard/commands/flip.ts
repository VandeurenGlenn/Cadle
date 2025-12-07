import { clipboard, canvas, positionObject } from '../../../utils.js'
import { isMac } from '../utils.js'

// only flip on active object
export const isFlip = ({ metaKey, key, ctrlKey, shiftKey }: KeyboardEvent) =>
  canvas.getActiveObject() && (key === 'f' || (key === 'F' && shiftKey)) && (isMac ? metaKey : ctrlKey)

export const flip = ({ shiftKey }) => {
  canvas.shouldRender = true
  const object = canvas.getActiveObject()
  console.log(object)
  console.log(shiftKey)

  if (shiftKey) {
    object.flipX = !object.flipX
    canvas.history.push({ type: 'flipX', item: object })
  } else {
    object.flipY = !object.flipY
    canvas.history.push({ type: 'flipY', item: object })
  }
}

export const keyCombination = { key: 'f', metaKey: isMac, ctrlKey: !isMac, shiftKey: false }
export const keys = [isMac ? ['meta', 'f'] : ['ctrl', 'f'], ['shift', 'f']]
