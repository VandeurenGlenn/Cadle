export declare type Text = {
  current: string,
  lastNumber: number,
  type: 'normal' | 'alphabet' | 'socket'
}

export declare type State = {
  text: Text,
  move: {
    amount: number
  },
  mouse: {
    position: {
      x: number,
      y: number
    }
  }
}

const state: State = {
  text: {
    current: 'A1',
    lastNumber: 1,
    type: 'normal'
  },
  move: {
    amount: 0.5
  },
  mouse: {
    position: undefined
  }
}




export const { text } = state

export default state