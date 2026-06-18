import {
  defaultWireSectionForGroupMembers,
  normalizeWireSection,
  wireSectionToBreakerAmperage,
  type WireSection
} from '../../helpers/wire-section.js'
import type { Canvas } from '../../fabric-imports.js'
import type { FabricObject } from 'fabric'
import type { BindingOverlay } from './binding-overlay.js'
import type { JsonValue } from '../../types.js'

type BindingObject = FabricObject & {
  kind?: string
  bindingId?: string
  bindingRole?: string
  bindingGroupWireSectionOverride?: boolean
  bindingGroupWireSection?: string
  bindingLabel?: string
  bindingLabelOffset?: { dx: number; dy: number }
  symbolName?: string
  symbolPath?: string
  situationElementType?: string
  situationMetadata?: JsonValue
  uuid?: string
  index?: number
}

type PresetGroupMetadata = {
  presetType: 'one-wire-group'
  switches: number
  loads: number
  neutral?: number
  wireSection?: string
  label?: string
}

export const normalizeBindingId = (value: string | number | null | undefined) => {
  if (typeof value !== 'string') return ''
  return value.trim().toUpperCase()
}

export const isValidBindingId = (value: string) => /^[A-Z]\d+$/.test(value)

export const inferBindingRole = (obj: BindingObject): 'switch' | 'load' | 'neutral' => {
  const explicitRole = String(obj?.bindingRole ?? '').toLowerCase()
  if (explicitRole === 'socket') return 'load'
  if (explicitRole === 'switch' || explicitRole === 'load') return explicitRole

  const haystack = `${obj?.symbolPath ?? ''} ${obj?.symbolName ?? ''} ${obj?.kind ?? ''}`.toLowerCase()
  if (haystack.includes('/switches/') || haystack.includes(' switch')) return 'switch'
  if (
    haystack.includes('/consumption appliances/') ||
    haystack.includes('/electrical devices/') ||
    haystack.includes('/socket outlets/') ||
    haystack.includes('socket outlet') ||
    haystack.includes('socket') ||
    haystack.includes('light') ||
    haystack.includes('lamp')
  ) {
    return 'load'
  }
  return 'neutral'
}

export const displayTypeForObject = (obj: BindingObject) => {
  if (typeof obj?.situationElementType === 'string') return obj.situationElementType
  if (typeof obj?.type === 'string' && obj.type.startsWith('Cadle')) return obj.type.replace('Cadle', '').toLowerCase()
  return String(obj?.type ?? 'symbol')
}

const buildBoundSymbolPath = (bindingId: string, role: string, type: string) => {
  const roleLabel = role === 'neutral' ? '' : ` ${role.toUpperCase()}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44" viewBox="0 0 120 44"><rect x="1" y="1" width="118" height="42" rx="6" fill="#fff" stroke="#444" stroke-width="1.5"/><text x="10" y="19" font-family="Arial, sans-serif" font-size="11" fill="#222">${bindingId}${roleLabel}</text><text x="10" y="34" font-family="Arial, sans-serif" font-size="10" fill="#666">${type}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const buildBindingGroupCardPath = (
  letter: string,
  circuits: Array<{ bindingId: string; switches: number; loads: number; ready: boolean }>,
  wireSection: string,
  breakerAmperage: number
) => {
  const COL_W = 240
  const HEADER_H = 44
  const ROW_H = 30
  const total = HEADER_H + Math.max(1, circuits.length) * ROW_H + 8
  const rowsSvg = circuits
    .map((c, i) => {
      const y = HEADER_H + i * ROW_H + 6
      const status = c.ready ? '#1f6a38' : '#8a5b00'
      return (
        `<text x="14" y="${y + 14}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#2f241d">${c.bindingId}</text>` +
        `<text x="60" y="${y + 14}" font-family="Arial, sans-serif" font-size="11" fill="#5f4c3d">${c.switches} sw · ${c.loads} load</text>` +
        `<circle cx="${COL_W - 16}" cy="${y + 10}" r="5" fill="${status}"/>`
      )
    })
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COL_W}" height="${total}" viewBox="0 0 ${COL_W} ${total}">` +
    `<rect x="1" y="1" width="${COL_W - 2}" height="${total - 2}" rx="8" ry="8" fill="#faf6f3" stroke="#d5c3b5" stroke-width="1"/>` +
    `<rect x="1" y="1" width="${COL_W - 2}" height="${HEADER_H}" rx="8" ry="8" fill="#a85427"/>` +
    `<rect x="1" y="${HEADER_H / 2 + 1}" width="${COL_W - 2}" height="${HEADER_H / 2}" fill="#a85427"/>` +
    `<text x="14" y="20" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">Group ${letter}</text>` +
    `<text x="14" y="36" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#ffe0cc">${wireSection} · ${breakerAmperage} A</text>` +
    rowsSvg +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const buildPresetOneWireGroupPath = (title: string, subtitle: string, sockets: number, breakerLabel: string) => {
  const width = 240
  const height = 128
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="10" fill="#fffaf6" stroke="#d9c8bb"/><rect x="1" y="1" width="${width - 2}" height="40" rx="10" fill="#a85427"/><rect x="1" y="20" width="${width - 2}" height="20" fill="#a85427"/><text x="14" y="24" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#fff">${title}</text><text x="14" y="36" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#ffe0cc">${subtitle}</text><rect x="14" y="54" width="56" height="28" rx="5" fill="#fff3e0" stroke="#a85427" stroke-width="1.5"/><text x="23" y="72" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#7d3f1c">${breakerLabel}</text><circle cx="118" cy="68" r="16" fill="#e8f5e9" stroke="#1f6a38" stroke-width="1.5"/><text x="108" y="73" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#1f6a38">${sockets}</text><text x="141" y="73" font-family="Arial, sans-serif" font-size="11" fill="#5f4c3d">sockets</text><text x="14" y="104" font-family="Arial, sans-serif" font-size="10" fill="#8a7060">Preset group. Assign a binding ID after placement.</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const readPresetGroupMetadata = (obj: BindingObject): PresetGroupMetadata | null => {
  const raw = obj?.situationMetadata
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, JsonValue>
  if (candidate.presetType !== 'one-wire-group') return null

  const switches = Number(candidate.switches ?? 0)
  const loads = Number(candidate.loads ?? 0)
  const neutral = Number(candidate.neutral ?? 0)
  if (!Number.isFinite(switches) || !Number.isFinite(loads) || switches < 0 || loads < 0) return null
  return {
    presetType: 'one-wire-group',
    switches: Math.round(switches),
    loads: Math.round(loads),
    neutral: Number.isFinite(neutral) && neutral > 0 ? Math.round(neutral) : 0,
    wireSection: typeof candidate.wireSection === 'string' ? candidate.wireSection : undefined,
    label: typeof candidate.label === 'string' ? candidate.label : undefined
  }
}

export type BindingGroup = {
  bindingId: string
  letter: string
  number: number
  switches: number
  loads: number
  neutral: number
  objects: BindingObject[]
  validId: boolean
  ready: boolean
  wireSection: WireSection
  breakerAmperage: number
  wireSectionOverride: boolean
}

export type BindingReport = {
  generatedAt: number
  totalGroups: number
  readyGroups: number
  errorCount: number
  warningCount: number
  issues: Array<{ bindingId: string; severity: 'error' | 'warn'; code: string; message: string }>
  groups: BindingGroup[]
  valid: boolean
}

export const getBindingGroups = (bindingOverlay: BindingOverlay, canvas: Canvas): BindingGroup[] => {
  bindingOverlay.refreshLookup(canvas)
  const groups: BindingGroup[] = []

  for (const [bindingId, objects] of bindingOverlay.getLookup().entries()) {
    let switches = 0
    let loads = 0
    let neutral = 0

    const memberDescriptors: Array<{ role: string; symbolPath?: string; symbolName?: string }> = []
    for (const obj of objects) {
      const preset = readPresetGroupMetadata(obj)
      if (preset) {
        switches += preset.switches
        loads += preset.loads
        neutral += preset.neutral ?? 0
        for (let index = 0; index < preset.switches; index += 1) memberDescriptors.push({ role: 'switch' })
        for (let index = 0; index < preset.loads; index += 1) memberDescriptors.push({ role: 'load' })
        for (let index = 0; index < (preset.neutral ?? 0); index += 1) memberDescriptors.push({ role: 'neutral' })
        continue
      }

      const role = inferBindingRole(obj)
      if (role === 'switch') switches += 1
      else if (role === 'load') loads += 1
      else neutral += 1
      memberDescriptors.push({ role, symbolPath: obj?.symbolPath, symbolName: obj?.symbolName })
    }

    const validId = isValidBindingId(bindingId)
    const ready = validId && switches > 0 && loads > 0
    const overrideMember = objects.find((o) => !!(o as BindingObject).bindingGroupWireSectionOverride)
    const explicitSection = (objects.find((o) => !!(o as BindingObject).bindingGroupWireSection) as BindingObject)
      ?.bindingGroupWireSection
    const wireSectionOverride = !!overrideMember
    const wireSection: WireSection = wireSectionOverride
      ? (normalizeWireSection(explicitSection).section as WireSection)
      : explicitSection
        ? (normalizeWireSection(explicitSection).section as WireSection)
        : defaultWireSectionForGroupMembers(memberDescriptors)
    const breakerAmperage = wireSectionToBreakerAmperage(wireSection)
    const match = bindingId.match(/^([A-Z]+)(\d+)$/)
    const letter = match?.[1] ?? '?'
    const number = match ? parseInt(match[2], 10) : 0

    groups.push({
      bindingId,
      letter,
      number,
      switches,
      loads,
      neutral,
      objects,
      validId,
      ready,
      wireSection,
      breakerAmperage,
      wireSectionOverride
    })
  }

  groups.sort((a, b) => a.bindingId.localeCompare(b.bindingId, undefined, { numeric: true }))
  return groups
}

export const getBindingValidationReport = (groups: BindingGroup[]): BindingReport => {
  const issues: BindingReport['issues'] = []
  for (const group of groups) {
    if (!group.validId) {
      issues.push({
        bindingId: group.bindingId,
        severity: 'error',
        code: 'invalid-id',
        message: `Binding ID ${group.bindingId} should match pattern A1, B2, C10.`
      })
    }

    if (group.switches === 0) {
      issues.push({
        bindingId: group.bindingId,
        severity: 'warn',
        code: 'missing-switch',
        message: `No switch linked to ${group.bindingId}.`
      })
    }

    if (group.loads === 0) {
      issues.push({
        bindingId: group.bindingId,
        severity: 'warn',
        code: 'missing-load',
        message: `No load or socket linked to ${group.bindingId}.`
      })
    }

    if (group.neutral > 0) {
      issues.push({
        bindingId: group.bindingId,
        severity: 'warn',
        code: 'unclassified',
        message: `${group.neutral} linked object${group.neutral === 1 ? '' : 's'} could not be classified as switch/load.`
      })
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warn').length
  const readyGroups = groups.filter((group) => group.ready).length
  return {
    generatedAt: Date.now(),
    totalGroups: groups.length,
    readyGroups,
    errorCount,
    warningCount,
    issues,
    groups,
    valid: errorCount === 0
  }
}

export const buildAutoOneWireSchema = (report: BindingReport, canvas: Canvas, gridSize = 10) => {
  const now = new Date(report.generatedAt)
  const version = (canvas as unknown as { version?: string })?.version ?? '6.0.0'
  const objects: Array<Record<string, JsonValue>> = []

  const safeGrid = Number.isFinite(gridSize) && gridSize > 0 ? Math.max(6, Math.round(gridSize)) : 10
  const snap = (value: number) => Math.round(value / safeGrid) * safeGrid
  const wireThickness = Math.max(2, Math.round(safeGrid / 4))
  const canvasMetrics = canvas as unknown as { width?: number; getWidth?: () => number }
  const canvasWidth = Number(canvasMetrics.getWidth?.() ?? canvasMetrics.width ?? 1800)

  objects.push({
    type: 'i-text',
    left: snap(6 * safeGrid),
    top: snap(3 * safeGrid),
    text: 'One-Wire Diagram',
    fontSize: 26,
    fontWeight: '700',
    fill: '#2f241d',
    selectable: false,
    evented: false
  })

  objects.push({
    type: 'i-text',
    left: snap(6 * safeGrid),
    top: snap(6 * safeGrid),
    text: `${report.readyGroups}/${report.totalGroups} circuits ready  ·  ${report.errorCount} errors  ·  ${report.warningCount} warnings  ·  ${now.toLocaleString()}`,
    fontSize: 12,
    fontWeight: '500',
    fill: '#5f4c3d',
    selectable: false,
    evented: false
  })

  type CircuitEntry = { number: number; group: BindingGroup }
  const letterMap = new Map<string, CircuitEntry[]>()

  for (const group of report.groups) {
    const match = group.bindingId.match(/^([A-Z]+)(\d+)$/)
    if (!match) {
      const bucket = letterMap.get('?') ?? []
      bucket.push({ number: 0, group })
      letterMap.set('?', bucket)
      continue
    }

    const letter = match[1]
    const number = parseInt(match[2], 10)
    const bucket = letterMap.get(letter) ?? []
    bucket.push({ number, group })
    letterMap.set(letter, bucket)
  }

  const sortedLetters = [...letterMap.keys()].sort()
  for (const letter of sortedLetters) {
    letterMap.get(letter)!.sort((a, b) => a.number - b.number)
  }

  if (sortedLetters.length === 0) {
    objects.push({
      type: 'i-text',
      left: snap(6 * safeGrid),
      top: snap(12 * safeGrid),
      text: 'No binding groups found. Assign IDs like A1 to switches and loads/sockets first.',
      fontSize: 16,
      fontWeight: '500',
      fill: '#6a5446',
      selectable: false,
      evented: false
    })
    return { version, objects }
  }

  const marginX = snap(6 * safeGrid)
  const baseY = snap(10 * safeGrid)
  const columnGap = snap(4 * safeGrid)
  const rowGap = snap(5 * safeGrid)
  const laneHeight = snap(8 * safeGrid)
  const headerHeight = snap(6 * safeGrid)
  const minColumnWidth = snap(38 * safeGrid)

  const usableWidth = Math.max(minColumnWidth, canvasWidth - marginX * 2)
  const columnsPerRow = Math.max(1, Math.floor((usableWidth + columnGap) / (minColumnWidth + columnGap)))
  const columnWidth = snap((usableWidth - (columnsPerRow - 1) * columnGap) / columnsPerRow)
  const totalRows = Math.ceil(sortedLetters.length / columnsPerRow)
  const rowHeights: number[] = []

  for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
    const firstIdx = rowIndex * columnsPerRow
    const rowLetters = sortedLetters.slice(firstIdx, firstIdx + columnsPerRow)
    let maxHeight = headerHeight + laneHeight + snap(3 * safeGrid)
    for (const letter of rowLetters) {
      const circuits = letterMap.get(letter) ?? []
      const groupHeight = headerHeight + circuits.length * laneHeight + snap(3 * safeGrid)
      if (groupHeight > maxHeight) maxHeight = groupHeight
    }

    rowHeights.push(maxHeight)
  }

  const rowStartY: number[] = []
  let currentY = baseY

  for (let rowIndex = 0; rowIndex < rowHeights.length; rowIndex += 1) {
    rowStartY.push(currentY)
    currentY = snap(currentY + rowHeights[rowIndex] + rowGap)
  }

  for (let groupIndex = 0; groupIndex < sortedLetters.length; groupIndex += 1) {
    const letter = sortedLetters[groupIndex]
    const circuits = letterMap.get(letter) ?? []
    const rowIndex = Math.floor(groupIndex / columnsPerRow)
    const columnIndex = groupIndex % columnsPerRow
    const groupLeft = snap(marginX + columnIndex * (columnWidth + columnGap))
    const groupTop = rowStartY[rowIndex]
    const groupHeight = headerHeight + circuits.length * laneHeight + snap(3 * safeGrid)

    const trunkX = snap(groupLeft + 14 * safeGrid)
    const breakerLeft = snap(groupLeft + 3 * safeGrid)
    const breakerWidth = snap(7 * safeGrid)
    const switchLeft = snap(groupLeft + 17 * safeGrid)
    const switchSize = snap(4 * safeGrid)
    const loadLeft = snap(groupLeft + 27 * safeGrid)
    const loadSize = snap(4 * safeGrid)
    const statusLeft = snap(groupLeft + columnWidth - 9 * safeGrid)

    let columnSection: WireSection = '2.5 mm²'
    let columnAmps = 20
    for (const { group } of circuits) {
      if (group.breakerAmperage > columnAmps) {
        columnAmps = group.breakerAmperage
        columnSection = group.wireSection
      } else if (columnAmps === 20 && circuits.length === 1) {
        columnAmps = group.breakerAmperage
        columnSection = group.wireSection
      }
    }

    objects.push({
      type: 'rect',
      left: groupLeft,
      top: groupTop,
      width: columnWidth,
      height: groupHeight,
      rx: 8,
      ry: 8,
      fill: '#faf6f3',
      stroke: '#d5c3b5',
      strokeWidth: 1,
      selectable: false,
      evented: false
    })

    objects.push({
      type: 'rect',
      left: groupLeft,
      top: groupTop,
      width: columnWidth,
      height: headerHeight,
      rx: 8,
      ry: 8,
      fill: '#a85427',
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false
    })
    objects.push({
      type: 'rect',
      left: groupLeft,
      top: snap(groupTop + headerHeight / 2),
      width: columnWidth,
      height: snap(headerHeight / 2),
      fill: '#a85427',
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false
    })

    objects.push({
      type: 'i-text',
      left: snap(groupLeft + 2 * safeGrid),
      top: snap(groupTop + safeGrid),
      text: `Group ${letter}`,
      fontSize: 15,
      fontWeight: '700',
      fill: '#ffffff',
      selectable: false,
      evented: false
    })
    objects.push({
      type: 'i-text',
      left: snap(groupLeft + 2 * safeGrid),
      top: snap(groupTop + 3 * safeGrid),
      text: `${columnSection} · ${columnAmps} A`,
      fontSize: 11,
      fontWeight: '600',
      fill: '#ffe0cc',
      selectable: false,
      evented: false
    })
    objects.push({
      type: 'i-text',
      left: snap(groupLeft + columnWidth - 12 * safeGrid),
      top: snap(groupTop + 2 * safeGrid),
      text: `${circuits.length} circuit${circuits.length === 1 ? '' : 's'}`,
      fontSize: 11,
      fontWeight: '500',
      fill: '#ffe0cc',
      selectable: false,
      evented: false
    })

    const trunkTop = snap(groupTop + headerHeight + safeGrid)
    const trunkBottom = snap(groupTop + groupHeight - safeGrid)
    objects.push({
      type: 'rect',
      left: snap(trunkX - wireThickness / 2),
      top: trunkTop,
      width: wireThickness,
      height: Math.max(wireThickness, trunkBottom - trunkTop),
      fill: '#a85427',
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false
    })

    for (let rowIdx = 0; rowIdx < circuits.length; rowIdx += 1) {
      const { group } = circuits[rowIdx]
      const rowTop = snap(groupTop + headerHeight + rowIdx * laneHeight)
      const laneY = snap(rowTop + laneHeight / 2)
      const isReady = group.ready
      const wireColor = isReady ? '#a85427' : '#c8bcb3'
      const statusColor = isReady ? '#1f6a38' : '#8a5b00'
      const statusBg = isReady ? '#d8f5e6' : '#fff0c2'

      if (rowIdx > 0) {
        objects.push({
          type: 'rect',
          left: snap(groupLeft + safeGrid),
          top: rowTop,
          width: snap(columnWidth - 2 * safeGrid),
          height: 1,
          fill: '#e8d9cc',
          stroke: 'transparent',
          strokeWidth: 0,
          selectable: false,
          evented: false
        })
      }

      objects.push({
        type: 'i-text',
        left: breakerLeft,
        top: snap(rowTop + safeGrid),
        text: group.bindingId,
        fontSize: 14,
        fontWeight: '700',
        fill: '#2f241d',
        selectable: false,
        evented: false
      })

      const breakerTop = snap(laneY - (5 * safeGrid) / 2)
      objects.push({
        type: 'rect',
        left: breakerLeft,
        top: breakerTop,
        width: breakerWidth,
        height: snap(5 * safeGrid),
        rx: 4,
        ry: 4,
        fill: '#fff3e0',
        stroke: '#a85427',
        strokeWidth: 1.5,
        oneWireNodeRole: 'breaker',
        oneWireSnap: true,
        oneWireSnapPorts: 'left,right',
        selectable: false,
        evented: false
      })
      objects.push({
        type: 'i-text',
        left: snap(breakerLeft + safeGrid),
        top: snap(breakerTop + safeGrid),
        text: `${group.breakerAmperage}A`,
        fontSize: 10,
        fontWeight: '700',
        fill: '#7d3f1c',
        selectable: false,
        evented: false
      })

      const switchTop = snap(laneY - switchSize / 2)
      objects.push({
        type: 'rect',
        left: switchLeft,
        top: switchTop,
        width: switchSize,
        height: switchSize,
        rx: 3,
        ry: 3,
        fill: group.switches > 0 ? '#fff3e0' : '#f0f0f0',
        stroke: group.switches > 0 ? '#a85427' : '#bbbbbb',
        strokeWidth: 1.5,
        oneWireNodeRole: 'switch',
        oneWireSnap: true,
        oneWireSnapPorts: 'left,right',
        selectable: false,
        evented: false
      })
      objects.push({
        type: 'i-text',
        left: snap(switchLeft + safeGrid),
        top: snap(switchTop + safeGrid),
        text: 'SW',
        fontSize: 9,
        fontWeight: '700',
        fill: group.switches > 0 ? '#a85427' : '#aaaaaa',
        selectable: false,
        evented: false
      })

      const loadTop = snap(laneY - loadSize / 2)
      objects.push({
        type: 'rect',
        left: loadLeft,
        top: loadTop,
        width: loadSize,
        height: loadSize,
        rx: snap(loadSize / 2),
        ry: snap(loadSize / 2),
        fill: group.loads > 0 ? '#e8f5e9' : '#f0f0f0',
        stroke: group.loads > 0 ? '#1f6a38' : '#bbbbbb',
        strokeWidth: 1.5,
        oneWireNodeRole: 'load',
        oneWireSnap: true,
        oneWireSnapPorts: 'left,right',
        selectable: false,
        evented: false
      })

      const breakerOutX = snap(breakerLeft + breakerWidth)
      const switchCenterX = snap(switchLeft + switchSize / 2)
      const loadCenterX = snap(loadLeft + loadSize / 2)

      objects.push({
        type: 'rect',
        left: breakerOutX,
        top: snap(laneY - wireThickness / 2),
        width: Math.max(wireThickness, trunkX - breakerOutX),
        height: wireThickness,
        fill: wireColor,
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false
      })
      objects.push({
        type: 'rect',
        left: trunkX,
        top: snap(laneY - wireThickness / 2),
        width: Math.max(wireThickness, switchCenterX - trunkX),
        height: wireThickness,
        fill: wireColor,
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false
      })
      objects.push({
        type: 'rect',
        left: switchCenterX,
        top: snap(laneY - wireThickness / 2),
        width: Math.max(wireThickness, loadCenterX - switchCenterX),
        height: wireThickness,
        fill: wireColor,
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false
      })

      objects.push({
        type: 'rect',
        left: snap(trunkX - safeGrid / 2),
        top: snap(laneY - safeGrid / 2),
        width: safeGrid,
        height: safeGrid,
        rx: snap(safeGrid / 2),
        ry: snap(safeGrid / 2),
        fill: '#a85427',
        stroke: 'transparent',
        strokeWidth: 0,
        oneWireNodeRole: 'junction',
        oneWireSnap: true,
        oneWireSnapPorts: 'center',
        selectable: false,
        evented: false
      })

      objects.push({
        type: 'rect',
        left: statusLeft,
        top: snap(laneY - safeGrid),
        width: snap(7 * safeGrid),
        height: snap(2 * safeGrid),
        rx: snap(safeGrid),
        ry: snap(safeGrid),
        fill: statusBg,
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false
      })
      objects.push({
        type: 'i-text',
        left: snap(statusLeft + safeGrid),
        top: snap(laneY - safeGrid + 4),
        text: isReady ? 'READY' : 'OPEN',
        fontSize: 9,
        fontWeight: '700',
        fill: statusColor,
        selectable: false,
        evented: false
      })

      objects.push({
        type: 'i-text',
        left: snap(loadLeft + loadSize + safeGrid),
        top: snap(rowTop + safeGrid),
        text: `${group.switches} sw · ${group.loads} load · ${group.wireSection}${group.wireSectionOverride ? ' (override)' : ''}`,
        fontSize: 10,
        fontWeight: '400',
        fill: '#8a7060',
        selectable: false,
        evented: false
      })
    }
  }
  return { version, objects }
}

export const getBoundOneLineCatalogSymbols = (bindingLookup: Map<string, BindingObject[]>) => {
  const symbols: Array<{ kind: string; name: string; path: string; metadata: Record<string, JsonValue> }> = []
  for (const [bindingId, objects] of bindingLookup.entries()) {
    for (const obj of objects) {
      const role = inferBindingRole(obj)
      const type = displayTypeForObject(obj)
      const uniqueId = obj?.uuid ?? `${obj?.type ?? 'symbol'}-${obj?.index ?? Math.random().toString(36).slice(2)}`
      symbols.push({
        kind: 'bound-situation-element',
        name: `${bindingId} - ${type}`,
        path: buildBoundSymbolPath(bindingId, role, type),
        metadata: {
          bindingId,
          bindingRole: role,
          situationElementType: type,
          sourceObjectUuid: uniqueId,
          oneLineEligible: true,
          sourceType: 'situation-binding'
        }
      })
    }
  }
  return symbols
}

export const getBindingGroupCatalogSymbols = (bindingOverlay: BindingOverlay, canvas: Canvas) => {
  const groups = getBindingGroups(bindingOverlay, canvas)
  const byLetter = new Map<
    string,
    {
      letter: string
      circuits: typeof groups
      wireSection: WireSection
      breakerAmperage: number
      memberCount: number
    }
  >()

  for (const group of groups) {
    const bucket = byLetter.get(group.letter)
    if (bucket) {
      bucket.circuits.push(group)
      bucket.memberCount += group.objects.length
    } else {
      byLetter.set(group.letter, {
        letter: group.letter,
        circuits: [group],
        wireSection: group.wireSection,
        breakerAmperage: group.breakerAmperage,
        memberCount: group.objects.length
      })
    }
  }

  const symbols: Array<{ kind: string; name: string; path: string; metadata: Record<string, JsonValue> }> = []

  symbols.push({
    kind: 'binding-preset',
    name: 'Preset · 8 sockets + C20A',
    path: buildPresetOneWireGroupPath('Preset Group', '8 sockets + C20A', 8, 'C20A'),
    metadata: {
      bindingRole: 'neutral',
      oneLineEligible: true,
      situationElementType: 'preset-group',
      situationMetadata: {
        presetType: 'one-wire-group',
        switches: 1,
        loads: 8,
        neutral: 0,
        wireSection: '2.5 mm²',
        label: '8 sockets + C20A'
      },
      sourceType: 'binding-preset'
    }
  })

  for (const bucket of byLetter.values()) {
    let aggregateSection: WireSection = bucket.wireSection
    let aggregateAmps = bucket.breakerAmperage
    for (const circuit of bucket.circuits) {
      if (circuit.breakerAmperage > aggregateAmps) {
        aggregateAmps = circuit.breakerAmperage
        aggregateSection = circuit.wireSection
      }
    }

    bucket.circuits.sort((a, b) => a.number - b.number)
    symbols.push({
      kind: 'binding-group',
      name: `Group ${bucket.letter} · ${bucket.wireSection} · ${bucket.breakerAmperage} A`,
      path: buildBindingGroupCardPath(bucket.letter, bucket.circuits, aggregateSection, aggregateAmps),
      metadata: {
        bindingGroup: bucket.letter,
        bindingGroupWireSection: aggregateSection,
        bindingGroupBreakerAmperage: aggregateAmps,
        bindingGroupMemberCount: bucket.memberCount,
        bindingGroupCircuitCount: bucket.circuits.length,
        oneLineEligible: true,
        sourceType: 'binding-group'
      }
    })
  }

  symbols.sort((a, b) => String(a.metadata.bindingGroup).localeCompare(String(b.metadata.bindingGroup)))
  return symbols
}
