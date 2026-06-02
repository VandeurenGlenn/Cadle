import { canvas } from '../../../utils.js'
import type { FabricObject } from 'fabric'
import { isMac } from '../utils.js'

// only flip on active object
export const isFlip = ({ metaKey, key, ctrlKey, shiftKey }: KeyboardEvent) =>
  Boolean(canvas.getActiveObject()) && (key === 'f' || (key === 'F' && shiftKey)) && (isMac ? metaKey : ctrlKey)

export const flip = ({ shiftKey }: KeyboardEvent) => {
  const canvas_ = canvas
  canvas_.shouldRender = true
  const object = canvas_.getActiveObject() as FabricObject | null
  if (!object) return

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
