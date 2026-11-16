import type { DraftShape } from '../../editor/model/types.js'

export type PointerUpPhase = 'pan' | 'band' | 'draft' | 'drag' | 'none'

export const resolvePointerUpPhase = (state: {
  isPanning: boolean
  hasBand: boolean
  hasDraft: boolean
  hasDrag: boolean
}): PointerUpPhase => {
  if (state.isPanning) return 'pan'
  if (state.hasBand) return 'band'
  if (state.hasDraft) return 'draft'
  if (state.hasDrag) return 'drag'
  return 'none'
}

export const canCommitDraft = (draft: DraftShape, minDistance = 2): boolean => {
  if (draft.kind === 'rect' && (draft.variant === 'roof-left' || draft.variant === 'roof-straight' || draft.variant === 'roof-right')) {
    return (
      Math.abs(draft.end.x - draft.start.x) >= minDistance &&
      Math.abs(draft.end.y - draft.start.y) >= minDistance
    )
  }
  const distance = Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y)
  return distance >= minDistance
}
