export type ProjectSpark = Readonly<{
  setup: string
  punchline: string
}>

export const PROJECT_SPARKS: readonly ProjectSpark[] = [
  { setup: 'Why did the circuit break up with the wire?', punchline: 'Too much resistance.' },
  { setup: 'Why did the electrician bring a pencil?', punchline: 'To draw a better current plan.' },
  { setup: 'What did the socket say to the plug?', punchline: 'You complete my circuit.' },
  { setup: 'Why was the one-wire diagram so relaxed?', punchline: 'Everything was well grounded.' },
  { setup: 'Why did the breaker leave the meeting?', punchline: 'The discussion was overloaded.' },
  { setup: 'What is an electrician’s favourite type of news?', punchline: 'Current events.' },
  { setup: 'Why are good schematics easy to trust?', punchline: 'They never cross their wires.' },
  { setup: 'Why did the lamp pass its inspection?', punchline: 'It had a bright future.' },
  { setup: 'What did L1 say to neutral?', punchline: 'Thanks for always bringing me back.' },
  { setup: 'Why did the cable apply for a new job?', punchline: 'It wanted better connections.' },
  { setup: 'Why was the distribution board so organised?', punchline: 'It had everything under control.' },
  { setup: 'What makes a CAD plan laugh?', punchline: 'A perfectly timed snap.' }
]

export const chooseProjectSparkIndex = (
  previousIndex: number | null,
  random: () => number = Math.random
): number => {
  if (PROJECT_SPARKS.length < 2) return 0
  const previous = previousIndex != null && previousIndex >= 0 && previousIndex < PROJECT_SPARKS.length
    ? previousIndex
    : null
  const available = PROJECT_SPARKS.length - (previous == null ? 0 : 1)
  let index = Math.min(available - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * available))
  if (previous != null && index >= previous) index += 1
  return index
}
