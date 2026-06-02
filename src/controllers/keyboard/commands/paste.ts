import type { FabricObject } from 'fabric'
import state from '../../../state.js'
import { clipboard, canvas, snapToGrid } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isPaste = ({ metaKey, key, ctrlKey }: KeyboardEvent) => key === 'v' && (isMac ? metaKey : ctrlKey)

export const paste = async () => {
  const cloned = (await clipboard.object?.clone()) as
    | (FabricObject & {
        canvas?: typeof canvas
        forEachObject?: (fn: (obj: FabricObject) => void) => void
      })
    | null

  await canvas.discardActiveObject()

  if (cloned) {
    const pointer = state.mouse.position
    const currentPoints = snapToGrid({ left: pointer.x - cloned.width / 2, top: pointer.y - cloned.height / 2 })
    // cloned.set({
    //   left: left - cloned.width / 2,
    //   top: top - cloned.height / 2,
    //   evented: true
    // })
    cloned.set(currentPoints)
    if (cloned.type === 'activeSelection') {
      // active selection needs a reference to the canvas.
      const activeSelection = cloned as FabricObject & {
        canvas?: typeof canvas
        forEachObject?: (fn: (obj: FabricObject) => void) => void
      }
      activeSelection.canvas = canvas
      activeSelection.forEachObject?.(function (obj: FabricObject) {
        canvas.add(obj)
      })
      // this should solve the unselectability
      cloned.setCoords()
    } else {
      canvas.add(cloned)
    }

    canvas.shouldRender = true
    canvas.requestRenderAll()
    canvas.history.push({ type: 'add', item: cloned })
    await canvas.setActiveObject(cloned)
  }
}

export const keyCombination = { key: 'v', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'v'] : ['ctrl', 'v']]
