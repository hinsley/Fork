import type { ForkCoreClient } from '../compute/ForkCoreClient'

const ALLOWED_METHODS = new Set<PropertyKey>([
  'sampleMap1DFunction',
  'computeEventSeriesFromOrbit',
  'computeEventSeriesFromSamples',
  'computeIsocline',
  'close',
])

export function createReadOnlyEmbedClient(client: ForkCoreClient): ForkCoreClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (ALLOWED_METHODS.has(property)) {
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      }
      if (typeof property === 'symbol') {
        return Reflect.get(target, property, receiver)
      }
      return async () => {
        throw new Error(`Fork embed viewers cannot run ${String(property)}.`)
      }
    },
  })
}
