import { canvas } from '../../../utils.js'
import type { FabricObject } from 'fabric'

type FabricObjectWithScale = FabricObject & { currentScale?: number }

// only flip on active object
export const isScale = ({ key }: KeyboardEvent) => Boolean(canvas.getActiveObject()) && (key === '/' || key === '*')

export const scale = ({ key }: KeyboardEvent) => {
  const canvas_ = canvas
  canvas_.shouldRender = true
  const object = canvas_.getActiveObject() as FabricObjectWithScale | null
  if (!object) return

  if (key === '/') {
    if (!object.currentScale) {
      object.currentScale = 0.9
      object.scale(object.currentScale)
    } else {
      const scaleAmount = object.currentScale - 0.1
      object.currentScale = scaleAmount
      object?.scale(scaleAmount)
    }

    canvas_.history.push({ type: 'scale-down', item: object })
  } else {
    if (!object.currentScale) {
      object.currentScale = 1.1
      object?.scale(object.currentScale)
    } else {
      const scaleAmount = object.currentScale + 0.1
      object.currentScale = scaleAmount
      object?.scale(scaleAmount)
    }

    canvas_.history.push({ type: 'scale-up', item: object })
  }
}

export const keyCombination = { key: '/ or *' }
export const keys = [['/'], ['*']]
