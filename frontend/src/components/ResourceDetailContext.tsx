import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'

export interface ResourceDetailTarget {
  kind: string
  name: string
  namespace?: string
  apiVersion?: string
  rawJson?: Record<string, unknown>
}

interface ResourceDetailContextValue {
  target: ResourceDetailTarget | null
  open: (t: ResourceDetailTarget) => void
  close: () => void
  goBack: () => void
  canGoBack: boolean
}

const ResourceDetailContext = createContext<ResourceDetailContextValue>({
  target: null,
  open: () => {},
  close: () => {},
  goBack: () => {},
  canGoBack: false,
})

export function ResourceDetailProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ResourceDetailTarget | null>(null)
  const historyRef = useRef<ResourceDetailTarget[]>([])

  const open = useCallback((t: ResourceDetailTarget) => {
    setTarget(prev => {
      if (prev) historyRef.current.push(prev)
      return t
    })
  }, [])

  const close = useCallback(() => {
    historyRef.current = []
    setTarget(null)
  }, [])

  const goBack = useCallback(() => {
    const prev = historyRef.current.pop()
    setTarget(prev ?? null)
  }, [])

  const canGoBack = historyRef.current.length > 0

  return (
    <ResourceDetailContext.Provider value={{ target, open, close, goBack, canGoBack }}>
      {children}
    </ResourceDetailContext.Provider>
  )
}

export function useResourceDetail() {
  return useContext(ResourceDetailContext)
}
