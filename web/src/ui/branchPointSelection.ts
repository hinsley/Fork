export type BranchPointSelection = {
  branchId: string
  pointIndex: number
} | null

export type OrbitPointSelection = {
  orbitId: string
  pointIndex: number
  hitIndex?: number | null
  time?: number | null
  state?: number[] | null
} | null

export type LimitCyclePointSelection = {
  limitCycleId: string
  pointIndex: number
} | null
