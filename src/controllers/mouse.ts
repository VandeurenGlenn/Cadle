import state from "../state.js"
import { canvasContainer } from "../utils.js"


canvasContainer.addEventListener('mousemove', (event) =>
  state.mouse.position = { x: event.clientX, y: event.clientY }
)