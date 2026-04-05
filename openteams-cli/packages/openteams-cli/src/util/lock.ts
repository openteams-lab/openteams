export namespace Lock {
  type Waiter = {
    active: boolean
    grant: () => void
  }

  type State = {
    readers: number
    writer: boolean
    waitingReaders: Waiter[]
    waitingWriters: Waiter[]
  }

  type Options = {
    timeout?: number
  }

  const locks = new Map<string, State>()

  function get(key: string) {
    if (!locks.has(key)) {
      locks.set(key, {
        readers: 0,
        writer: false,
        waitingReaders: [],
        waitingWriters: [],
      })
    }
    return locks.get(key)!
  }

  function cleanup(key: string, lock: State) {
    if (lock.readers === 0 && !lock.writer && lock.waitingReaders.length === 0 && lock.waitingWriters.length === 0) {
      locks.delete(key)
    }
  }

  function process(key: string) {
    const lock = locks.get(key)
    if (!lock || lock.writer || lock.readers > 0) return

    while (lock.waitingWriters.length > 0) {
      const nextWriter = lock.waitingWriters.shift()!
      if (!nextWriter.active) continue
      nextWriter.grant()
      return
    }

    while (lock.waitingReaders.length > 0) {
      const nextReader = lock.waitingReaders.shift()!
      if (!nextReader.active) continue
      nextReader.grant()
    }

    cleanup(key, lock)
  }

  function createDisposable(input: { key: string; lock: State; type: "reader" | "writer" }): Disposable {
    return {
      [Symbol.dispose]: () => {
        if (input.type === "reader") input.lock.readers--
        else input.lock.writer = false
        process(input.key)
      },
    }
  }

  function timeoutError(ms: number) {
    return new Error(`Lock timed out after ${ms}ms`)
  }

  function waitForLock(
    input: {
      key: string
      lock: State
      queue: Waiter[]
      grant: () => Disposable
    } & Options,
  ) {
    return new Promise<Disposable>((resolve, reject) => {
      const timeout = input.timeout
      const waiter: Waiter = {
        active: true,
        grant: () => {
          if (!waiter.active) return
          waiter.active = false
          if (timer) clearTimeout(timer)
          resolve(input.grant())
        },
      }
      const timer =
        timeout === undefined
          ? undefined
          : setTimeout(() => {
              if (!waiter.active) return
              waiter.active = false
              reject(timeoutError(timeout))
              process(input.key)
            }, timeout)
      input.queue.push(waiter)
    })
  }

  export async function read(key: string, opts?: Options): Promise<Disposable> {
    const lock = get(key)

    if (!lock.writer && lock.waitingWriters.length === 0) {
      lock.readers++
      return createDisposable({ key, lock, type: "reader" })
    }

    return waitForLock({
      key,
      lock,
      queue: lock.waitingReaders,
      timeout: opts?.timeout,
      grant: () => {
        lock.readers++
        return createDisposable({ key, lock, type: "reader" })
      },
    })
  }

  export async function write(key: string, opts?: Options): Promise<Disposable> {
    const lock = get(key)

    if (!lock.writer && lock.readers === 0) {
      lock.writer = true
      return createDisposable({ key, lock, type: "writer" })
    }

    return waitForLock({
      key,
      lock,
      queue: lock.waitingWriters,
      timeout: opts?.timeout,
      grant: () => {
        lock.writer = true
        return createDisposable({ key, lock, type: "writer" })
      },
    })
  }
}
