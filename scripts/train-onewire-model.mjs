import { readFile, writeFile } from 'node:fs/promises'

const outputPath = new URL('../src/assets/onewire-intent-model.v1.json', import.meta.url)
const userDataPath = new URL('../training/onewire-user-examples.jsonl', import.meta.url)

const bootstrap = [
  ['zonnepanelen staan naast de hoofddifferentieel', false, true, false],
  ['pv omvormer rechtstreeks na de diff', false, true, false],
  ['fotovoltaïsche installatie op de hoofdbus', false, true, false],
  ['geen zonnepanelen aanwezig', false, false, false],
  ['installatie zonder pv', false, false, false],
  ['remautomaat voedt alle verbruikers', true, false, true],
  ['differentieelautomaat voor de kringen', true, false, true],
  ['rcbo gaat naar de groepen', true, false, true],
  ['enkel een hoofddifferentieel en verbruikers', false, false, true],
  ['geen remautomaat, rechtstreeks naar de kringen', false, false, true],
  ['zonnepanelen parallel en remautomaat naar verbruikers', true, true, true],
  ['pv aan de hoofddiff, rcbo voor alle groepen', true, true, true],
  ['omvormer naast differentieelautomaat richting kringen', true, true, true],
  ['alleen kwh meter en hoofddifferentieel', false, false, false],
  ['voeding gaat naar stopcontact- en lichtkringen', false, false, true],
  ['na de diff vertrekken de verbruikersgroepen', false, false, true]
].map(([prompt, residualBreaker, solar, consumers]) => ({
  prompt,
  topology: { residualBreaker, solar, consumers }
}))

const tokenize = (text) =>
  text.toLocaleLowerCase('nl-BE')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .match(/[\p{L}\p{N}]+/gu) ?? []

const loadUserExamples = async () => {
  try {
    const content = await readFile(userDataPath, 'utf8')
    return content.split(/\r?\n/).filter(Boolean).map((line) => {
      const example = JSON.parse(line)
      return { prompt: example.prompt, topology: example.acceptedTopology }
    })
  } catch {
    return []
  }
}

const examples = [...bootstrap, ...await loadUserExamples()]
const labels = ['residualBreaker', 'solar', 'consumers']
const vocabulary = [...new Set(examples.flatMap((example) => tokenize(example.prompt)))].sort()

const trainLabel = (label) => {
  const classes = [false, true]
  const trained = {}
  for (const classValue of classes) {
    const rows = examples.filter((example) => Boolean(example.topology[label]) === classValue)
    const counts = new Map(vocabulary.map((token) => [token, 0]))
    let total = 0
    for (const row of rows) {
      for (const token of tokenize(row.prompt)) {
        counts.set(token, (counts.get(token) ?? 0) + 1)
        total += 1
      }
    }
    const denominator = total + vocabulary.length
    trained[String(classValue)] = {
      logPrior: Math.log((rows.length + 1) / (examples.length + 2)),
      unknownLogProbability: Math.log(1 / denominator),
      tokenLogProbabilities: Object.fromEntries(
        vocabulary.map((token) => [token, Math.log(((counts.get(token) ?? 0) + 1) / denominator)])
      )
    }
  }
  return trained
}

const trainedLabels = Object.fromEntries(labels.map((label) => [label, trainLabel(label)]))
const predict = (label, prompt) => {
  const tokens = tokenize(prompt)
  const scores = ['false', 'true'].map((className) => {
    const trained = trainedLabels[label][className]
    return trained.logPrior + tokens.reduce(
      (score, token) => score + (trained.tokenLogProbabilities[token] ?? trained.unknownLogProbability),
      0
    )
  })
  return scores[1] >= scores[0]
}
const labelAccuracy = Object.fromEntries(labels.map((label) => [
  label,
  examples.filter((example) => predict(label, example.prompt) === Boolean(example.topology[label])).length / examples.length
]))
const exactMatchAccuracy = examples.filter((example) =>
  labels.every((label) => predict(label, example.prompt) === Boolean(example.topology[label]))
).length / examples.length

const model = {
  version: 1,
  kind: 'multinomial-naive-bayes',
  locale: 'nl-BE',
  createdAt: new Date().toISOString(),
  exampleCount: examples.length,
  metrics: { trainingAccuracy: labelAccuracy, exactMatchAccuracy },
  labels: trainedLabels
}

await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`)
console.log(`Trained one-wire intent model with ${examples.length} examples → ${outputPath.pathname}`)
console.log(`Training exact-match accuracy: ${(exactMatchAccuracy * 100).toFixed(1)}%`)
