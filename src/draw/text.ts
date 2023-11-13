import { Textbox } from "fabric"
import state from "../state.js"
import { canvas, incrementLetter, incrementSocket, positionObject } from "../utils.js"

export default () => {
  const { left, top } = positionObject()

  
  if (state.text.type === 'normal') state.text.current = 'type here'
  else if (state.text.type === 'alphabet') state.text.current = incrementLetter(state.text.current.match(/\D/g))
  else if (state.text.type === 'socket' || state.text.type === 'switch') {
    const match = state.text.current.match(/\d+/g)
  
    if (match?.length > 0) {
      const number = Number(match.join(''))
      
      if (number && number === state.text.lastNumber) {
        state.text.lastNumber += 1
        if (state.text.lastNumber === 9 && state.text.type === 'socket') incrementSocket()
        else state.text.current = state.text.current.replace(/\d+/g, String(state.text.lastNumber))
      }
    }
  }
  
  console.log('add');
  
  
  // @ts-ignore
  canvas.add(new Textbox(state.text.current, { 
    fontFamily: 'system-ui',
    fontSize: 12,
    fontStyle: 'normal',
    fontWeight: 'normal',
    width: state.text.current.length * 6,
    controls: false,
    left,
    top
  }))
}