import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

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
}

const ResourceDetailContext = createContext<ResourceDetailContextValue>({
  target: null,
  open: () => {},
  close: () => {},
})

export function ResourceDetailProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ResourceDetailTarget | null>(null)
  const open = useCallback((t: ResourceDetailTarget) => setTarget(t), [])
  const close = useCallback(() => setTarget(null), [])

  return (
    <ResourceDetailContext.Provider value={{ target, open, close }}>
      {children}
    </ResourceDetailContext.Provider>
  )
}

export function useResourceDetail() {
  return useContext(ResourceDetailContext)
}
