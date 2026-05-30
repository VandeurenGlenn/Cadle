import state from '../state.js'
import pubsub from '../pubsub.js'
import { canvasContainer } from '../utils.js'

canvasContainer().addEventListener('mousemove', (event) => {
  const point = { x: event.clientX, y: event.clientY }
  state.mouse.position = point
  pubsub.publish('shell.pointer', point)
})
