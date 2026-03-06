import PubSub from '@vandeurenglenn/little-pubsub'
globalThis.pubsub = globalThis.pubsub || new PubSub()
export default globalThis.pubsub
