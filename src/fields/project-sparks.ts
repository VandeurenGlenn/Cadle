export type ProjectSpark = Readonly<{
  setup: string
  punchline: string
}>

export const PROJECT_SPARKS: readonly ProjectSpark[] = [
  { setup: 'Why did the circuit break up with the wire?', punchline: 'Too much resistance.' },
  { setup: 'What did the socket say to the plug?', punchline: 'You complete my circuit.' },
  { setup: 'Why was the one-wire diagram so calm?', punchline: 'Everything was well grounded.' },
  { setup: 'Why did the breaker leave the meeting?', punchline: 'The discussion was overloaded.' },
  { setup: 'An electrician opened the newspaper.', punchline: 'He only read the current events.' },
  { setup: 'Why are good schematics trustworthy?', punchline: 'They never cross their wires.' },
  { setup: 'The lamp passed inspection.', punchline: 'Its future looked bright.' },
  { setup: 'What did L1 say to neutral?', punchline: 'Thanks for bringing me back.' },
  { setup: 'The cable changed careers.', punchline: 'It wanted better connections.' },
  { setup: 'Why was the cabinet so organised?', punchline: 'It had everything under control.' },
  { setup: 'What makes a CAD plan laugh?', punchline: 'A perfectly timed snap.' },
  { setup: 'The electrician hated surprises.', punchline: 'So he kept everything transparent.' },
  { setup: 'Why did the symbol join the wall?', punchline: 'It felt an instant connection.' },
  { setup: 'The fuse applied for early retirement.', punchline: 'It was burned out.' },
  { setup: 'Why did the drawing pass first time?', punchline: 'It had no loose ends.' },
  { setup: 'The volt and amp walked into a bar.', punchline: 'The atmosphere had real power.' },
  { setup: 'Why was the multimeter so popular?', punchline: 'It knew how everyone felt.' },
  { setup: 'A phase walked into the wrong room.', punchline: 'The atmosphere shifted.' },
  { setup: 'Why did the wire avoid drama?', punchline: 'It preferred a direct connection.' },
  { setup: 'The floor plan challenged the one-wire.', punchline: 'Meet me on neutral ground.' },
  { setup: 'Why did the circuit bring ID?', punchline: 'The inspector checked every connection.' },
  { setup: 'The switch finally made a decision.', punchline: 'It was a real turning point.' },
  { setup: 'Why did the plan use grid snapping?', punchline: 'It liked keeping things in line.' },
  { setup: 'The resistor joined the debate.', punchline: 'It opposed every current idea.' }
]

export const chooseProjectSparkIndex = (previousIndex: number | null, random: () => number = Math.random): number => {
  if (PROJECT_SPARKS.length < 2) return 0
  const previous =
    previousIndex != null && previousIndex >= 0 && previousIndex < PROJECT_SPARKS.length ? previousIndex : null
  const available = PROJECT_SPARKS.length - (previous == null ? 0 : 1)
  let index = Math.min(available - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * available))
  if (previous != null && index >= previous) index += 1
  return index
}
