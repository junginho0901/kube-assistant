/**
 * 가벼운 leading+trailing throttle 구현.
 *
 * `useAIContext` 에서 watch 기반 초당 수십 번 갱신을 억제하기 위해 사용.
 * lodash 를 도입하지 않기 위해 직접 구현 (~20줄).
 */

export interface ThrottledFunction<Args extends unknown[]> {
  (...args: Args): void
  cancel: () => void
}

export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): ThrottledFunction<Args> {
  let lastCall = 0
  let pendingArgs: Args | null = null
  let timer: number | null = null

  const invoke = (args: Args) => {
    lastCall = Date.now()
    fn(...args)
  }

  const throttled = (...args: Args) => {
    const now = Date.now()
    const remaining = waitMs - (now - lastCall)
    if (remaining <= 0) {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      invoke(args)
    } else {
      pendingArgs = args
      if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null
          if (pendingArgs) {
            const a = pendingArgs
            pendingArgs = null
            invoke(a)
          }
        }, remaining)
      }
    }
  }

  throttled.cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    pendingArgs = null
    lastCall = 0
  }

  return throttled as ThrottledFunction<Args>
}
