import state from '../state.js'
import pubsub from '../pubsub.js'
import { canvas, canvasContainer } from '../utils.js'

canvasContainer().addEventListener('mousemove', (event) => {
  const scenePoint = (
    canvas as unknown as { getScenePoint?: (event: MouseEvent) => { x: number; y: number } }
  )?.getScenePoint?.(event)
  const point = scenePoint ? { x: scenePoint.x, y: scenePoint.y } : { x: event.clientX, y: event.clientY }
  state.mouse.position = point
  pubsub.publish('shell.pointer', point)
})
