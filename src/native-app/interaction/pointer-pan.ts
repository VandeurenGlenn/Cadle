export type PanStartState = { px: number; py: number; panX: number; panY: number }

export const nextPanFromPointer = (panStart: PanStartState, px: number, py: number) => ({
  panX: panStart.panX + (px - panStart.px),
  panY: panStart.panY + (py - panStart.py)
})
