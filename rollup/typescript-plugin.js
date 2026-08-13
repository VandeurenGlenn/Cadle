// @rollup/plugin-typescript 12.3.0 currently contains two unconditional debug
// console.log calls that dump the complete TypeScript API during config load.
// Keep build output useful until the upstream package removes those statements.
const originalLog = console.log
let typescript
try {
  console.log = () => {}
  ;({ default: typescript } = await import('@rollup/plugin-typescript'))
} finally {
  console.log = originalLog
}

export default typescript
