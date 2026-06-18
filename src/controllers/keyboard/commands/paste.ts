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
    const snappedPointer = snapToGrid({ left: pointer.x, top: pointer.y })
    const pasteIndex = Math.max(0, Number(clipboard.pasteCount ?? 0))
    const pasteStep = state.freeDraw ? 10 : Math.max(1, state.gridSize)
    const pasteOffset = pasteIndex * pasteStep
    cloned.setCoords()
    const bounds = cloned.getBoundingRect()
    const centerX = Number(bounds.left ?? 0) + Number(bounds.width ?? 0) / 2
    const centerY = Number(bounds.top ?? 0) + Number(bounds.height ?? 0) / 2
    const targetCenterX = Number(snappedPointer.left ?? pointer.x) + pasteOffset
    const targetCenterY = Number(snappedPointer.top ?? pointer.y) + pasteOffset
    const dx = targetCenterX - centerX
    const dy = targetCenterY - centerY
    cloned.set({
      left: Number(cloned.left ?? 0) + dx,
      top: Number(cloned.top ?? 0) + dy
    })
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
    clipboard.pasteCount = pasteIndex + 1
  }
}

export const keyCombination = { key: 'v', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'v'] : ['ctrl', 'v']]
