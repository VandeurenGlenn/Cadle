import state from "../state.js"
import { incrementLetter, incrementSocket, positionObject } from "../utils.js"

export default () => {
  const { left, top } = positionObject()

  if (state.text.type === 'normal') return
  const textMatch = state.text.current.match(/\D/g)

  if (state.text.type === 'alphabet') return state.text.current = incrementLetter(textMatch)

  const match = state.text.current.match(/\d+/g)
  
  if (match?.length > 0) {
    const number = Number(match.join(''))
    
    if (number && number === state.text.lastNumber) {
      state.text.lastNumber += 1
      if (state.text.lastNumber === 9 && state.text.type === 'socket') incrementSocket()
      else state.text.current = state.text.current.replace(/\d+/g, String(state.text.lastNumber))
    }
  }
  
  // @ts-ignore
  canvas.add(new Textbox(state.text.current, { 
    fontFamily: 'system-ui',
    fontSize: 12,
    fontStyle: 'normal',
    fontWeight: 'normal',
    controls: false,
    left,
    top
  }))
}