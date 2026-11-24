type Pair = readonly [number, number]

/** Choose mutually compatible lead variants while leaving unrelated circuits
 * in place. A single-circuit sweep can strand two neighbours which both need
 * to move before their common lane clears. */
export const selectHeatingLanePairs = (pairs: readonly Pair[][],
  clash: (circuit: number, a: Pair, other: number, b: Pair) => boolean,
  checkpoint: () => void = () => {}): Pair[] => {
  const chosen = pairs.map((): Pair => [0, 0])
  const conflicts = (circuit: number, option: Pair, omit = -1) =>
    chosen.reduce((count, choice, other) => count +
      Number(other !== circuit && other !== omit && clash(circuit, option, other, choice)), 0)
  for (let pass = 0; pass < 5; pass++) {
    let changed = false
    for (let i = 0; i < pairs.length; i++) {
      const circuit = pass % 2 ? pairs.length - 1 - i : i
      let best = conflicts(circuit, chosen[circuit])
      if (!best) continue
      for (const option of pairs[circuit]) {
        checkpoint()
        const cost = conflicts(circuit, option)
        if (cost < best) { best = cost; chosen[circuit] = option; changed = true }
        if (!best) break
      }
    }
    // Rank each side without its conflicting neighbour. Retain alternatives
    // which respect other routes before testing the two edits together.
    let repairs = 0
    for (let a = 0; a < pairs.length && repairs < 8; a++) for (let b = a + 1; b < pairs.length && repairs < 8; b++) {
      if (!clash(a, chosen[a], b, chosen[b])) continue
      checkpoint()
      const shortlist = (circuit: number, omit: number) => pairs[circuit].map((option) => {
        checkpoint()
        return { option, cost: conflicts(circuit, option, omit) }
      }).sort((x, y) => x.cost - y.cost).slice(0, 12)
      const left = shortlist(a, b), right = shortlist(b, a)
      let best = conflicts(a, chosen[a], b) + conflicts(b, chosen[b], a) + 1
      let replacement: [Pair, Pair] | undefined
      for (const x of left) for (const y of right) {
        checkpoint()
        if (x.cost + y.cost >= best || clash(a, x.option, b, y.option)) continue
        best = x.cost + y.cost
        replacement = [x.option, y.option]
      }
      if (replacement) {
        ;[chosen[a], chosen[b]] = replacement
        changed = true
        repairs++
      }
    }
    if (!changed) break
  }
  return chosen
}
