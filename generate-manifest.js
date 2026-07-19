import { readdir, writeFile } from 'fs/promises'
import { join } from 'path'

const categories = await readdir('./www/symbols')
const manifest = []

const electricalMetadata = (category, symbol) => {
  const searchable = `${category} ${symbol}`.toLowerCase()
  const role = /protection|automaat|breaker|fuse|differential|rcd/.test(searchable)
    ? 'protection'
    : /switch|schakel|drukknop|push.?button|contactor|relais|relay/.test(searchable)
      ? 'switch'
      : /junction|lasdoos|connection box/.test(searchable)
        ? 'junction'
        : /socket|outlet|stopcontact|consumption|lighting|lamp|light|motor|heater|boiler|load|electrical devices/.test(
              searchable
            )
          ? 'load'
          : 'neutral'
  const circuitType = /socket|outlet|stopcontact/.test(searchable)
    ? 'sockets'
    : /motor/.test(searchable)
      ? 'motor'
      : /lighting|lamp|light|spot/.test(searchable)
        ? 'lighting'
        : 'other'
  return {
    role,
    circuitType,
    oneWireEligible: role !== 'neutral'
  }
}

for (const category of categories) {
  if (category !== '.DS_Store' && category !== 'manifest.js') {
    const symbols = (await readdir(join('./www/symbols', category))).map((symbol) => ({
      kind: category,
      name: symbol.replace('.svg', '').toLowerCase(),
      path: join('./symbols', category, symbol),
      metadata: {
        electrical: electricalMetadata(category, symbol)
      }
    }))

    manifest.push({ category, symbols })
  }
}

writeFile('./www/symbols/manifest.js', `export default ${JSON.stringify(manifest, null, '\t')}`)
