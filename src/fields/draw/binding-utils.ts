import {
  defaultWireSectionForGroupMembers,
  normalizeWireSection,
  wireSectionToBreakerAmperage,
  type WireSection
} from '../../helpers/wire-section.js'

export const normalizeBindingId = (value: unknown) => {
  if (typeof value !== 'string') return ''
  return value.trim().toUpperCase()
}

export const isValidBindingId = (value: string) => /^[A-Z]\d+$/.test(value)

export const inferBindingRole = (obj: any): 'switch' | 'load' | 'neutral' => {
  const explicitRole = String(obj?.bindingRole ?? '').toLowerCase()
  if (explicitRole === 'socket') return 'load'
  if (explicitRole === 'switch' || explicitRole === 'load') return explicitRole

  const haystack = `${obj?.symbolPath ?? ''} ${obj?.symbolName ?? ''}`.toLowerCase()
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

export const displayTypeForObject = (obj: any) => {
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

export type BindingGroup = {
  bindingId: string
  letter: string
  number: number
  switches: number
  loads: number
  neutral: number
  objects: any[]
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

export const getBindingGroups = (bindingOverlay: any, canvas: any): BindingGroup[] => {
  bindingOverlay.refreshLookup(canvas)
  const groups: BindingGroup[] = []

  for (const [bindingId, objects] of bindingOverlay.getLookup().entries()) {
    let switches = 0
    let loads = 0
    let neutral = 0

    const memberDescriptors: Array<{ role: string; symbolPath?: string; symbolName?: string }> = []
    for (const obj of objects) {
      const role = inferBindingRole(obj)
      if (role === 'switch') switches += 1
      else if (role === 'load') loads += 1
      else neutral += 1
      memberDescriptors.push({ role, symbolPath: obj?.symbolPath, symbolName: obj?.symbolName })
    }

    const validId = isValidBindingId(bindingId)
    const ready = validId && switches > 0 && loads > 0
    const overrideMember = objects.find((o: any) => !!o?.bindingGroupWireSectionOverride)
    const explicitSection = objects.find((o: any) => !!o?.bindingGroupWireSection)?.bindingGroupWireSection
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

export const buildAutoOneWireSchema = (report: BindingReport, canvas: any) => {
  const now = new Date(report.generatedAt)
  const version = canvas?.version ?? '6.0.0'
  const objects: any[] = []

  objects.push({
    type: 'i-text',
    left: 60,
    top: 28,
    text: 'One-Wire Diagram',
    fontSize: 26,
    fontWeight: '700',
    fill: '#2f241d',
    selectable: false,
    evented: false
  })

  objects.push({
    type: 'i-text',
    left: 60,
    top: 64,
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

  const COL_WIDTH = 300
  const COL_GAP = 24
  const ROW_H = 62
  const HEADER_H = 40
  const START_X = 60
  const START_Y = 100

  if (sortedLetters.length === 0) {
    objects.push({
      type: 'i-text',
      left: 60,
      top: 120,
      text: 'No binding groups found. Assign IDs like A1 to switches and loads/sockets first.',
      fontSize: 16,
      fontWeight: '500',
      fill: '#6a5446',
      selectable: false,
      evented: false
    })
    return { version, objects }
  }

  for (let colIdx = 0; colIdx < sortedLetters.length; colIdx++) {
    const letter = sortedLetters[colIdx]
    const circuits = letterMap.get(letter)!
    const colX = START_X + colIdx * (COL_WIDTH + COL_GAP)
    const colH = HEADER_H + circuits.length * ROW_H

    objects.push({
      type: 'rect',
      left: colX,
      top: START_Y,
      width: COL_WIDTH,
      height: colH,
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
      left: colX,
      top: START_Y,
      width: COL_WIDTH,
      height: HEADER_H,
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
      left: colX,
      top: START_Y + HEADER_H / 2,
      width: COL_WIDTH,
      height: HEADER_H / 2,
      fill: '#a85427',
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false
    })

    objects.push({
      type: 'i-text',
      left: colX + 14,
      top: START_Y + 6,
      text: `Group ${letter}`,
      fontSize: 15,
      fontWeight: '700',
      fill: '#ffffff',
      selectable: false,
      evented: false
    })

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
      type: 'i-text',
      left: colX + 14,
      top: START_Y + 24,
      text: `${columnSection} · ${columnAmps} A`,
      fontSize: 11,
      fontWeight: '600',
      fill: '#ffe0cc',
      selectable: false,
      evented: false
    })

    objects.push({
      type: 'i-text',
      left: colX + COL_WIDTH - 68,
      top: START_Y + 13,
      text: `${circuits.length} circuit${circuits.length === 1 ? '' : 's'}`,
      fontSize: 11,
      fontWeight: '500',
      fill: '#ffe0cc',
      selectable: false,
      evented: false
    })

    for (let rowIdx = 0; rowIdx < circuits.length; rowIdx++) {
      const { group } = circuits[rowIdx]
      const rowTop = START_Y + HEADER_H + rowIdx * ROW_H
      const isReady = group.ready
      const statusColor = isReady ? '#1f6a38' : '#8a5b00'
      const statusBg = isReady ? '#d8f5e6' : '#fff0c2'

      if (rowIdx > 0) {
        objects.push({
          type: 'rect',
          left: colX + 8,
          top: rowTop,
          width: COL_WIDTH - 16,
          height: 1,
          rx: 0,
          ry: 0,
          fill: '#e8d9cc',
          stroke: 'transparent',
          strokeWidth: 0,
          selectable: false,
          evented: false
        })
      }

      objects.push({
        type: 'i-text',
        left: colX + 14,
        top: rowTop + 12,
        text: group.bindingId,
        fontSize: 17,
        fontWeight: '700',
        fill: '#2f241d',
        selectable: false,
        evented: false
      })

      const swX = colX + 60
      const swY = rowTop + 14
      objects.push({
        type: 'rect',
        left: swX,
        top: swY,
        width: 34,
        height: 22,
        rx: 3,
        ry: 3,
        fill: group.switches > 0 ? '#fff3e0' : '#f0f0f0',
        stroke: group.switches > 0 ? '#a85427' : '#bbbbbb',
        strokeWidth: 1.5,
        selectable: false,
        evented: false
      })
      objects.push({
        type: 'i-text',
        left: swX + 5,
        top: swY + 5,
        text: 'SW',
        fontSize: 9,
        fontWeight: '700',
        fill: group.switches > 0 ? '#a85427' : '#aaaaaa',
        selectable: false,
        evented: false
      })

      objects.push({
        type: 'rect',
        left: swX + 34,
        top: swY + 10,
        width: 36,
        height: 2,
        rx: 0,
        ry: 0,
        fill: isReady ? '#a85427' : '#cccccc',
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false
      })

      const ldX = swX + 74
      const ldY = rowTop + 13
      objects.push({
        type: 'rect',
        left: ldX,
        top: ldY,
        width: 24,
        height: 24,
        rx: 12,
        ry: 12,
        fill: group.loads > 0 ? '#e8f5e9' : '#f0f0f0',
        stroke: group.loads > 0 ? '#1f6a38' : '#bbbbbb',
        strokeWidth: 1.5,
        selectable: false,
        evented: false
      })

      const badgeX = colX + COL_WIDTH - 60
      const badgeY = rowTop + 14
      objects.push({
        type: 'rect',
        left: badgeX,
        top: badgeY,
        width: 48,
        height: 20,
        rx: 10,
        ry: 10,
        fill: statusBg,
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false
      })
      objects.push({
        type: 'i-text',
        left: badgeX + 6,
        top: badgeY + 4,
        text: isReady ? 'READY' : 'OPEN',
        fontSize: 9,
        fontWeight: '700',
        fill: statusColor,
        selectable: false,
        evented: false
      })

      objects.push({
        type: 'i-text',
        left: colX + 14,
        top: rowTop + 36,
        text: `${group.switches} sw · ${group.loads} load · ${group.wireSection} · ${group.breakerAmperage} A${group.wireSectionOverride ? ' (override)' : ''}`,
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

export const getBoundOneLineCatalogSymbols = (bindingLookup: Map<string, any[]>) => {
  const symbols: Array<{ name: string; path: string; metadata: Record<string, unknown> }> = []
  for (const [bindingId, objects] of bindingLookup.entries()) {
    for (const obj of objects) {
      const role = inferBindingRole(obj)
      const type = displayTypeForObject(obj)
      const uniqueId = obj?.uuid ?? `${obj?.type ?? 'symbol'}-${obj?.index ?? Math.random().toString(36).slice(2)}`
      symbols.push({
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

export const getBindingGroupCatalogSymbols = (bindingOverlay: any, canvas: any) => {
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

  const symbols: Array<{ name: string; path: string; metadata: Record<string, unknown> }> = []
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
