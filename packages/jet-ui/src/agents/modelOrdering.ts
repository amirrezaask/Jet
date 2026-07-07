import type { ProviderInstanceId } from "./t3contracts.js"

export interface ModelSlugItem {
  readonly slug: string
}

export interface ProviderModelItem extends ModelSlugItem {
  readonly instanceId: ProviderInstanceId
}

export function providerModelKey(instanceId: ProviderInstanceId, slug: string): string {
  return `${instanceId}:${slug}`
}

function rankByValue(values: ReadonlyArray<string>): ReadonlyMap<string, number> {
  return new Map(values.map((value, index) => [value, index] as const))
}

function toSet(
  values: ReadonlySet<string> | ReadonlyArray<string> | undefined,
): ReadonlySet<string> {
  return values instanceof Set ? values : new Set(values ?? [])
}

function compareByOptionalRank<T>(
  left: T,
  right: T,
  rank: (item: T) => number | undefined,
): number {
  const leftRank = rank(left) ?? Number.POSITIVE_INFINITY
  const rightRank = rank(right) ?? Number.POSITIVE_INFINITY
  return leftRank - rightRank
}

function compareByTrueFirst<T>(left: T, right: T, predicate: (item: T) => boolean): number {
  const leftVal = predicate(left) ? 0 : 1
  const rightVal = predicate(right) ? 0 : 1
  return leftVal - rightVal
}

function sortWithOrders<T>(items: ReadonlyArray<T>, orders: Array<(a: T, b: T) => number>): T[] {
  return [...items].sort((left, right) => {
    for (const order of orders) {
      const result = order(left, right)
      if (result !== 0) return result
    }
    return 0
  })
}

export function sortModelsForProviderInstance<T extends ModelSlugItem>(
  models: ReadonlyArray<T>,
  options?: {
    readonly modelOrder?: ReadonlyArray<string>
    readonly favoriteModels?: ReadonlySet<string> | ReadonlyArray<string>
    readonly groupFavorites?: boolean
  },
): T[] {
  const modelOrder = options?.modelOrder ?? []
  const favoriteModels = toSet(options?.favoriteModels)
  const orderBySlug = rankByValue(modelOrder)
  const originalOrder = rankByValue(models.map(model => model.slug))
  const orders: Array<(a: T, b: T) => number> = [
    ...(options?.groupFavorites === true
      ? [(a: T, b: T) => compareByTrueFirst(a, b, model => favoriteModels.has(model.slug))]
      : []),
    (a, b) => compareByOptionalRank(a, b, model => orderBySlug.get(model.slug)),
    (a, b) => compareByOptionalRank(a, b, model => originalOrder.get(model.slug)),
  ]
  return sortWithOrders(models, orders)
}

export function sortProviderModelItems<T extends ProviderModelItem>(
  items: ReadonlyArray<T>,
  options?: {
    readonly favoriteModelKeys?: ReadonlySet<string> | ReadonlyArray<string>
    readonly groupFavorites?: boolean
    readonly instanceOrder?: ReadonlyArray<ProviderInstanceId>
  },
): T[] {
  const favoriteModelKeys = toSet(options?.favoriteModelKeys)
  const instanceOrder = new Map(
    (options?.instanceOrder ?? []).map((instanceId, index) => [instanceId, index] as const),
  )
  const originalOrder = rankByValue(
    items.map(item => providerModelKey(item.instanceId, item.slug)),
  )
  const orders: Array<(a: T, b: T) => number> = [
    ...(options?.groupFavorites === true
      ? [
          (a: T, b: T) =>
            compareByTrueFirst(a, b, item =>
              favoriteModelKeys.has(providerModelKey(item.instanceId, item.slug)),
            ),
        ]
      : []),
    (a, b) => compareByOptionalRank(a, b, item => instanceOrder.get(item.instanceId)),
    (a, b) =>
      compareByOptionalRank(a, b, item =>
        originalOrder.get(providerModelKey(item.instanceId, item.slug)),
      ),
  ]
  return sortWithOrders(items, orders)
}
