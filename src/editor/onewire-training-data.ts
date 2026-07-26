import type { OneWireTopologyPlan } from '../types.js'

export type OneWireTrainingExample = {
  version: 1
  id: string
  createdAt: number
  locale: 'nl-BE'
  prompt: string
  parserTopology: OneWireTopologyPlan
  acceptedTopology: OneWireTopologyPlan
  corrected: boolean
}

export const createOneWireTrainingExample = (
  prompt: string,
  parserTopology: OneWireTopologyPlan,
  acceptedTopology: OneWireTopologyPlan,
  id = crypto.randomUUID(),
  createdAt = Date.now()
): OneWireTrainingExample => ({
  version: 1,
  id,
  createdAt,
  locale: 'nl-BE',
  prompt: prompt.trim(),
  parserTopology: structuredClone(parserTopology),
  acceptedTopology: structuredClone(acceptedTopology),
  corrected: JSON.stringify(parserTopology) !== JSON.stringify(acceptedTopology)
})

let storePromise: Promise<{
  put: (key: string, value: string) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
  iterate: () => Promise<AsyncIterable<[string, { getFile: () => Promise<{ text: () => Promise<string> }> }]>>
}> | null = null

const trainingStore = async () => {
  storePromise ??= import('@leofcoin/storage').then(async ({ default: Storage }) => {
    const store = new Storage('onewire-training-examples', 'cadle')
    await store.init()
    return store
  })
  return storePromise
}

export const storeOneWireTrainingExample = async (
  prompt: string,
  parserTopology: OneWireTopologyPlan,
  acceptedTopology: OneWireTopologyPlan
): Promise<OneWireTrainingExample> => {
  const example = createOneWireTrainingExample(prompt, parserTopology, acceptedTopology)
  const store = await trainingStore()
  await store.put(example.id, JSON.stringify(example))
  return example
}

export const getOneWireTrainingExamples = async (): Promise<OneWireTrainingExample[]> => {
  const store = await trainingStore()
  const examples: OneWireTrainingExample[] = []
  for await (const [, entry] of await store.iterate()) {
    try {
      examples.push(JSON.parse(await (await entry.getFile()).text()) as OneWireTrainingExample)
    } catch {
      // Ignore corrupt local samples; they cannot be useful for training.
    }
  }
  return examples.sort((a, b) => b.createdAt - a.createdAt)
}

export const deleteOneWireTrainingExample = async (id: string): Promise<void> => {
  const store = await trainingStore()
  await store.delete(id)
}

export const oneWireTrainingExamplesToJsonl = (
  examples: readonly OneWireTrainingExample[]
): string => examples.map((example) => JSON.stringify(example)).join('\n')
