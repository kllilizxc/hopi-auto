import { type CreateMvpRuntimeOptions, type MvpRuntime, createMvpRuntime } from './mvpRuntime'

export interface RuntimeInitializationError {
  at: string
  message: string
}

export interface MvpRuntimeHost {
  current(): Promise<MvpRuntime>
  health(): {
    runtime: MvpRuntime | null
    initializationError: RuntimeInitializationError | null
  }
  reload(mutate: (runtime: MvpRuntime) => Promise<void>): Promise<MvpRuntime>
  withStableRuntime<T>(operation: (runtime: MvpRuntime) => Promise<T>): Promise<T>
  start(): void
  stop(): Promise<void>
}

export function createMvpRuntimeHost(
  options: Omit<CreateMvpRuntimeOptions, 'onProjectTopologyChanged' | 'start'>,
  lifecycle: { startCoordinator: boolean },
): MvpRuntimeHost {
  let topologyReloadScheduled = false
  let observedRuntime: MvpRuntime | null = null
  let runtimeInitializationError: RuntimeInitializationError | null = null
  let runtimeGeneration = 0
  let reloadTail: Promise<void> = Promise.resolve()
  let started = false
  let stopped = false

  const runtimeOptions: CreateMvpRuntimeOptions = {
    ...options,
    onProjectTopologyChanged: scheduleTopologyReload,
    start: false,
  }
  let runtimePromise = createMvpRuntime(runtimeOptions)
  observeRuntime(runtimePromise)

  function observeRuntime(promise: Promise<MvpRuntime>) {
    const generation = ++runtimeGeneration
    observedRuntime = null
    runtimeInitializationError = null
    void promise.then(
      (runtime) => {
        if (generation !== runtimeGeneration) return
        observedRuntime = runtime
      },
      (error) => {
        if (generation !== runtimeGeneration) return
        runtimeInitializationError = {
          at: new Date().toISOString(),
          message: errorMessage(error),
        }
      },
    )
  }

  async function reload(mutate: (runtime: MvpRuntime) => Promise<void>) {
    if (stopped) throw new Error('MVP runtime host is stopped')
    const operation = reloadTail.then(async () => {
      const previous = await runtimePromise
      await previous.coordinator.stop()
      await previous.preview.stopAll()
      try {
        await mutate(previous)
      } catch (error) {
        if (lifecycle.startCoordinator) previous.coordinator.start()
        throw error
      }
      runtimePromise = createMvpRuntime(runtimeOptions)
      observeRuntime(runtimePromise)
      const next = await runtimePromise
      if (lifecycle.startCoordinator) next.coordinator.start()
      return next
    })
    reloadTail = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  async function withStableRuntime<T>(operation: (runtime: MvpRuntime) => Promise<T>) {
    if (stopped) throw new Error('MVP runtime host is stopped')
    const pending = reloadTail.then(async () => operation(await runtimePromise))
    reloadTail = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  function scheduleTopologyReload() {
    if (topologyReloadScheduled || stopped) return
    topologyReloadScheduled = true
    setTimeout(() => {
      if (stopped) {
        topologyReloadScheduled = false
        return
      }
      void reload(async () => undefined)
        .catch((error) => console.error('[mvp runtime reload error]', error))
        .finally(() => {
          topologyReloadScheduled = false
        })
    }, 0)
  }

  return {
    current: () => runtimePromise,
    health: () => ({
      runtime: observedRuntime,
      initializationError: runtimeInitializationError,
    }),
    reload,
    withStableRuntime,
    start() {
      if (started || stopped || !lifecycle.startCoordinator) return
      started = true
      void runtimePromise
        .then((runtime) => runtime.coordinator.start())
        .catch((error) => console.error('[mvp runtime startup error]', error))
    },
    async stop() {
      if (stopped) return
      stopped = true
      await reloadTail
      const runtime = await runtimePromise
      await runtime.coordinator.stop()
      await runtime.preview.stopAll()
    },
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
