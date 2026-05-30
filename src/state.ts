import { Color } from './symbols/default-options.js'

export declare type Text = {
  current: string
  lastNumber: number
  type: 'normal' | 'alphabet' | 'socket' | 'switch'
}

export declare type DesignMode = 'free' | 'situation-first' | 'one-line-first'

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
  designMode: DesignMode
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
    fill: '#000',
    stroke: '#000'
  },
  freeDraw: false,
  gridSize: 10,
  designMode: 'free'
}

export const { text } = state

export default state
