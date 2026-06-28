import type { Tool } from '../native-draw/types.js'

export type NativeEscapeAction =
  | 'cancel-symbol'
  | 'cancel-wall-chain'
  | 'cancel-onewire-panel'
  | 'clear-interaction'
  | null

export interface NativeEscapeState {
  tool: Tool
  hasPendingCatalogSymbol: boolean
  hasSymbolPreviewPoint: boolean
  hasWallChain: boolean
  hasDraft: boolean
  hasDrag: boolean
  selectedId: string | null
  selectedCount: number
  hasBandStart: boolean
  hasOneWireAnchor: boolean
}

export const resolveNativeEscapeAction = (state: NativeEscapeState): NativeEscapeAction => {
  if (state.tool === 'symbol' && (state.hasPendingCatalogSymbol || state.hasSymbolPreviewPoint)) {
    return 'cancel-symbol'
  }
  if (state.hasWallChain) return 'cancel-wall-chain'
  if (state.tool === 'onewire' && state.hasOneWireAnchor) return 'cancel-onewire-panel'
  if (state.hasDraft || state.hasDrag || state.selectedId || state.selectedCount > 0 || state.hasBandStart) {
    return 'clear-interaction'
  }
  return null
}
