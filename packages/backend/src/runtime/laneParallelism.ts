import type { TaskStatus } from '../domain/board'

export type ExecutionLane = 'in_progress' | 'in_review' | 'merging'

export interface LaneParallelism {
  in_progress: number
  in_review: number
  merging: number
}

export type LaneParallelismInput = Partial<LaneParallelism>

export const DEFAULT_LANE_PARALLELISM: LaneParallelism = {
  in_progress: 3,
  in_review: 1,
  merging: 1,
}

export function normalizeLaneParallelism(
  value?: LaneParallelismInput,
  legacyMaxParallel?: number,
): LaneParallelism {
  const defaults = {
    ...DEFAULT_LANE_PARALLELISM,
    ...(legacyMaxParallel && Number.isFinite(legacyMaxParallel)
      ? { in_progress: normalizeLaneValue(legacyMaxParallel) }
      : {}),
  }

  if (!value) {
    return defaults
  }

  return {
    in_progress: normalizeLaneValue(value.in_progress, defaults.in_progress),
    in_review: normalizeLaneValue(value.in_review, defaults.in_review),
    merging: 1,
  }
}

export function totalLaneParallelism(value: LaneParallelism) {
  return value.in_progress + value.in_review + value.merging
}

export function executionLaneForStatus(status: TaskStatus): ExecutionLane | null {
  if (status === 'planned' || status === 'in_progress') {
    return 'in_progress'
  }
  if (status === 'in_review') {
    return 'in_review'
  }
  if (status === 'merging') {
    return 'merging'
  }
  return null
}

function normalizeLaneValue(value: number | undefined, fallback = 1) {
  if (!value || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}
