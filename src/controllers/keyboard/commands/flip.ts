import { clipboard, canvas, positionObject } from '../../../utils.js'
import { isMac } from '../utils.js'

// only flip on active object
export const isFlip = ({ metaKey, key, ctrlKey, shiftKey }: KeyboardEvent) =>
  canvas.getActiveObject() && (key === 'f' || (key === 'F' && shiftKey)) && (isMac ? metaKey : ctrlKey)

export const flip = ({ shiftKey }) => {
  const canvas_ = canvas as any
  canvas_.shouldRender = true
  const object = canvas_.getActiveObject() as any
  console.log(object)
  console.log(shiftKey)

  if (shiftKey) {
    object.flipX = !object.flipX
    canvas_.history.push({ type: 'flipX', item: object })
  } else {
    object.flipY = !object.flipY
    canvas_.history.push({ type: 'flipY', item: object })
  }
}

export const keyCombination = { key: 'f', metaKey: isMac, ctrlKey: !isMac, shiftKey: false }
export const keys = [isMac ? ['meta', 'f'] : ['ctrl', 'f'], ['shift', 'f']]
