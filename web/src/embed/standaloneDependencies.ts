export type BundledDependencyPayload = {
  dependenciesGzipBase64: string
}

let dependencyPromise: Promise<BundledDependencyPayload> | null = null

export function loadBundledDependencyPayload(): Promise<BundledDependencyPayload> {
  if (!dependencyPromise) {
    dependencyPromise = import('virtual:standalone-embed-dependencies').catch((error) => {
      dependencyPromise = null
      throw error
    })
  }
  return dependencyPromise
}
