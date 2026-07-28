import type { OneWireTopologyPlan } from '../../types.js'
import type { LineShape, Shape, SymbolShape, TextShape } from '../model/types.js'

const KWH_PATH = 'symbols/Consumption appliances/kWh meter.svg'
const RCD_PATH = 'symbols/Protection devices/Residual-current circuit breaker.svg'
const INVERTER_PATH = 'symbols/Photovoltaic devices (≠AREI)/Inverter.svg'
const EARTH_PATH = 'symbols/Protection devices/Earth electrode.svg'

type TopologyRail = Pick<LineShape, 'start' | 'end'>

export const buildOneWireTopology = (
  plan: OneWireTopologyPlan,
  rail: TopologyRail,
  nextId: () => string
): Shape[] => {
  const groupId = `onewire-topology-${nextId()}`
  const x = (rail.start.x + rail.end.x) / 2
  const railY = rail.start.y
  const protectionY = railY + 52
  const meterY = railY + 142
  const mainX = x - 135
  const earthX = x
  const residualX = x + 145
  const solarX = x - 285
  const shapes: Shape[] = []

  const link = <T extends Shape>(shape: T, role: string): T => {
    shape.groupId = groupId
    shape.sourceLink = { kind: 'board', id: 'main', role }
    shape.generationKey = `board:main:topology:${role}`
    return shape
  }
  const line = (role: string, x1: number, y1: number, x2: number, y2: number): LineShape =>
    link({
      id: nextId(),
      kind: 'line',
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      stroke: '#000000',
      strokeWidth: 1.25
    }, role)
  const symbol = (role: string, name: string, path: string, sx: number, sy: number, scale: number): SymbolShape =>
    link({
      id: nextId(),
      kind: 'symbol',
      position: { x: sx, y: sy },
      name,
      path,
      scale,
      strokeWidth: 0.65,
      ...(path === RCD_PATH
        ? {
            symbolTextOverrides: {
              poles: '',
              phase: '',
              'rated-current': '',
              'residual-current': ''
            }
          }
        : {})
    }, role)
  const text = (
    role: string,
    value: string,
    tx: number,
    ty: number,
    scale = 0.58,
    rotation?: number
  ): TextShape =>
    link({
      id: nextId(),
      kind: 'text',
      position: { x: tx, y: ty },
      text: value,
      scale,
      fill: '#000000',
      stroke: 'none',
      ...(typeof rotation === 'number' ? { rotation } : {})
    }, role)

  shapes.push(symbol('meter', 'kWh meter', KWH_PATH, mainX, meterY, 2.5))
  shapes.push(symbol('main-differential', 'Main differential', RCD_PATH, mainX, protectionY, 4))
  shapes.push(line('incoming', mainX, meterY - 31, mainX, protectionY + 35))
  shapes.push(line('main-to-rail', mainX, protectionY - 35, mainX, railY))

  if (plan.incomingCable) {
    shapes.push(text(
      'incoming-cable-label',
      `${plan.incomingCable.conductors}x${plan.incomingCable.sectionMm2} mm² ${plan.incomingCable.cableType}`,
      mainX + 30,
      meterY - 25,
      0.62
    ))
  }
  if (plan.mainDifferential) {
    shapes.push(text('main-differential-title', 'Diff', mainX - 43, protectionY + 5, 0.7))
    shapes.push(text(
      'main-differential-label',
      `${plan.mainDifferential.ratedCurrentA} A / ${plan.mainDifferential.sensitivityMa} mA`,
      mainX + 38,
      protectionY + 30,
      0.65,
      -90
    ))
  }

  if (plan.residualBreaker) {
    shapes.push(symbol('residual-breaker', 'Residual-current breaker', RCD_PATH, residualX, protectionY, 2.1))
    shapes.push(line('residual-to-rail', residualX, protectionY - 32, residualX, railY))
    shapes.push(text('residual-breaker-label', 'remautomaat', residualX + 38, protectionY + 24, 0.62))
  }

  shapes.push(line('earth-drop', earthX, railY, earthX, railY + 46))
  shapes.push(symbol('earth', 'Earth electrode', EARTH_PATH, earthX, railY + 76, 1.6))

  if (plan.solar) {
    shapes.push(line('solar-branch', solarX, railY, solarX, protectionY - 28))
    shapes.push(symbol('solar-inverter', 'PV inverter', INVERTER_PATH, solarX, protectionY, 2.3))
    shapes.push(text('solar-label', 'zonnepanelen', solarX - 43, protectionY + 38, 0.62))
  }

  return shapes
}
