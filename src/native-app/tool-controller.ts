import type { Tool } from '../native-draw/types.js'

const ACTION_TO_TOOL: Readonly<Record<string, Tool>> = {
  'draw-wall': 'wall',
  'draw-door': 'door',
  'draw-window': 'window',
  'draw-gate': 'gate',
  'draw-line': 'line',
  'draw-cable': 'line',
  'draw-onewire': 'onewire',
  'draw-square': 'rect',
  'draw-circle': 'circle',
  'draw-arc': 'arc',
  'draw-text': 'text',
  'draw-symbol': 'symbol',
  draw: 'line',
  resize: 'select',
  select: 'select'
}

const TOOL_TO_ACTION: Readonly<Record<Tool, string>> = {
  select: 'select',
  wall: 'draw-wall',
  door: 'draw-door',
  window: 'draw-window',
  gate: 'draw-gate',
  line: 'draw-line',
  onewire: 'draw-onewire',
  rect: 'draw-square',
  circle: 'draw-circle',
  arc: 'draw-arc',
  text: 'draw-text',
  symbol: 'draw-symbol'
}

export class ToolController {
  #current: Tool = 'select'

  get current(): Tool {
    return this.#current
  }

  select(tool: Tool): boolean {
    if (tool === this.#current) return false
    this.#current = tool
    return true
  }

  selectForShellAction(action: string): boolean {
    return this.select(ACTION_TO_TOOL[action] ?? 'select')
  }

  toolForShellAction(action: string): Tool {
    return ACTION_TO_TOOL[action] ?? 'select'
  }

  shellAction(): string {
    return TOOL_TO_ACTION[this.#current]
  }
}
