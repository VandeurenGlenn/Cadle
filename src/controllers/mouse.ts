import state from '../state.js'
import pubsub from '../pubsub.js'
import { canvas, canvasContainer } from '../utils.js'

canvasContainer().addEventListener('mousemove', (event) => {
  const pointer = (canvas as unknown as { getPointer?: (event: MouseEvent) => { x: number; y: number } })?.getPointer?.(
    event
  )
  const point = pointer ? { x: pointer.x, y: pointer.y } : { x: event.clientX, y: event.clientY }
  state.mouse.position = point
  pubsub.publish('shell.pointer', point)
})
