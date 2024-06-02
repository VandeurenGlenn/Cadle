import { Color } from './symbols/default-options.js'

export declare type Text = {
  current: string
  lastNumber: number
  type: 'normal' | 'alphabet' | 'socket' | 'switch'
}

export declare type State = {
  text: Text
  move: {
    amount: number
  }
  mouse: {
    position: {
      x: number | undefined
      y: number | undefined
    }
  }
  styling: {
    fill: Color
    stroke: Color
  }
  freeDraw: boolean
  gridSize: number
}

const state: State = {
  text: {
    current: 'A1',
    lastNumber: 0,
    type: 'normal'
  },
  move: {
    amount: 0.5
  },
  mouse: {
    position: {
      x: undefined,
      y: undefined
    }
  },
  styling: {
    fill: '#ffffff',
    stroke: '#000'
  },
  freeDraw: false,
  gridSize: 10
}

export const { text } = state

export default state
