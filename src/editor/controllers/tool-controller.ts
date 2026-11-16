import type { Tool } from '../../editor/model/types.js'

const ACTION_TO_TOOL: Readonly<Record<string, Tool>> = {
  'draw-heating-exclusion': 'heating-exclusion',
  'draw-heating-zone': 'heating-zone',
  'draw-heating-pipe': 'heating-pipe',
  'draw-heating-manifold': 'heating-manifold',
  'draw-wall': 'wall',
  'draw-room': 'room',
  'draw-room-label': 'room-label',
  'draw-door': 'door',
  'draw-sliding-door': 'sliding-door',
  'draw-sliding-window': 'sliding-window',
  'draw-built-in-cabinet': 'built-in-cabinet',
  'draw-stairs': 'stairs-straight',
  'draw-stairs-quarter-turn': 'stairs-quarter-turn',
  'draw-stairs-spiral': 'stairs-spiral',
  'draw-access-point': 'symbol',
  'draw-heat-pump': 'symbol',
  'draw-window': 'window',
  'draw-gate': 'gate',
  'draw-line': 'line',
  'draw-cable': 'line',
  'draw-onewire': 'onewire',
  'draw-square': 'rect',
  'draw-circle': 'circle',
  'draw-arc': 'arc',
  'draw-roof-left': 'roof-left',
  'draw-roof-straight': 'roof-straight',
  'draw-roof-right': 'roof-right',
  'draw-text': 'text',
  'draw-symbol': 'symbol',
  draw: 'line',
  resize: 'select',
  select: 'select'
}

const TOOL_TO_ACTION: Readonly<Record<Tool, string>> = {
  'heating-exclusion': 'draw-heating-exclusion',
  'heating-zone': 'draw-heating-zone',
  'heating-pipe': 'draw-heating-pipe',
  'heating-manifold': 'draw-heating-manifold',
  select: 'select',
  wall: 'draw-wall',
  room: 'draw-room',
  'room-label': 'draw-room-label',
  door: 'draw-door',
  'sliding-door': 'draw-sliding-door',
  'sliding-window': 'draw-sliding-window',
  'built-in-cabinet': 'draw-built-in-cabinet',
  'stairs-straight': 'draw-stairs',
  'stairs-quarter-turn': 'draw-stairs-quarter-turn',
  'stairs-spiral': 'draw-stairs-spiral',
  window: 'draw-window',
  gate: 'draw-gate',
  line: 'draw-line',
  onewire: 'draw-onewire',
  rect: 'draw-square',
  circle: 'draw-circle',
  arc: 'draw-arc',
  'roof-left': 'draw-roof-left',
  'roof-straight': 'draw-roof-straight',
  'roof-right': 'draw-roof-right',
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
