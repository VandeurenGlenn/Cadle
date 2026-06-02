import { canvas } from '../../../utils.js'
import type { FabricObject } from 'fabric'
import { isMac } from '../utils.js'

type FabricObjectWithRotation = FabricObject & { currentRotation?: number }

// only flip on active object
export const isRotate = ({ metaKey, key, ctrlKey }: KeyboardEvent) =>
  Boolean(canvas.getActiveObject()) &&
  (isMac ? metaKey && (key === '+' || key === '-') : ctrlKey && (key === '+' || key === '-'))

export const rotate = ({ key }: KeyboardEvent) => {
  const canvas_ = canvas
  canvas_.shouldRender = true
  const object = canvas_.getActiveObject() as FabricObjectWithRotation | null
  if (!object) return

  if (key === '-') {
    if (!object.currentRotation) {
      object.currentRotation = -45
      object?.rotate(object.currentRotation)
    } else {
      let rotationAmount = -45
      if (object.currentRotation + -45 >= -180) {
        rotationAmount = -180
      } else {
        rotationAmount = object.currentRotation > 0 ? object.currentRotation - 45 : object.currentRotation + -45
      }

      object.currentRotation = rotationAmount
      object?.rotate(rotationAmount)
    }

    canvas_.history.push({ type: 'rotate-up', item: object })
  } else {
    if (!object.currentRotation) {
      object.currentRotation = 45
      object?.rotate(object.currentRotation)
    } else {
      let rotationAmount = 45
      if (object.currentRotation + 45 >= 180) {
        rotationAmount = -180
      } else {
        rotationAmount = object.currentRotation + 45
      }

      object.currentRotation = rotationAmount
      object?.rotate(rotationAmount)
    }

    canvas_.history.push({ type: 'rotate-down', item: object })
  }
}

export const keyCombination = { key: '+ / -' }
export const keys = [['+'], ['-']]
