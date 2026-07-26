import { parseOneWirePrompt, type OneWirePromptModel } from './onewire-prompt.js'

type ModelClass = {
  logPrior: number
  unknownLogProbability: number
  tokenLogProbabilities: Record<string, number>
}

type IntentModel = {
  version: 1
  labels: Record<'residualBreaker' | 'solar' | 'consumers', Record<'false' | 'true', ModelClass>>
}

const tokenize = (text: string): string[] =>
  text.toLocaleLowerCase('nl-BE')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .match(/[\p{L}\p{N}]+/gu) ?? []

const probability = (model: IntentModel, label: keyof IntentModel['labels'], prompt: string): number => {
  const tokens = tokenize(prompt)
  const scores = (['false', 'true'] as const).map((className) => {
    const trained = model.labels[label][className]
    return trained.logPrior + tokens.reduce(
      (score, token) => score + (trained.tokenLogProbabilities[token] ?? trained.unknownLogProbability),
      0
    )
  })
  const max = Math.max(...scores)
  const normalized = scores.map((score) => Math.exp(score - max))
  return normalized[1] / (normalized[0] + normalized[1])
}

let modelPromise: Promise<IntentModel> | null = null

export const loadOneWireLocalModel = async (): Promise<OneWirePromptModel> => {
  modelPromise ??= fetch('assets/onewire-intent-model.v1.json').then(async (response) => {
    if (!response.ok) throw new Error(`Unable to load local one-wire model (${response.status}).`)
    return await response.json() as IntentModel
  })
  const model = await modelPromise
  return {
    infer: async (prompt) => {
      const plan = parseOneWirePrompt(prompt).plan
      for (const label of ['residualBreaker', 'solar', 'consumers'] as const) {
        const confidence = probability(model, label, prompt)
        if (confidence >= 0.68) plan[label] = true
        else if (confidence <= 0.32) plan[label] = false
      }
      if (plan.solar) plan.solarPlacement = 'parallel-after-main-differential'
      else delete plan.solarPlacement
      return plan
    }
  }
}
