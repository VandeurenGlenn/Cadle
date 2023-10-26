import state from "../state.js"

addEventListener('mousemove', (event) =>
  state.mouse.position = { x: event.clientX, y: event.clientY }
)