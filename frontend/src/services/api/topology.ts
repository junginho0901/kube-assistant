// Topology API — namespace / storage topology, dependency graph
// (legacy), resource graph (upgraded), and the per-namespace /
// per-resource event timeline.

import { client } from './client'
import type { ResourceGraphResponse, TimelineResult, TopologyGraph } from './types'

export const topologyApi = {
  // Topology (graph)
  getNamespaceTopology: async (namespace: string): Promise<TopologyGraph> => {
    const { data } = await client.get(`/topology/namespace/${namespace}`)
    return data
  },

  getStorageTopology: async (): Promise<TopologyGraph> => {
    const { data } = await client.get('/topology/storage')
    return data
  },

  // Timeline
  getNamespaceTimeline: async (namespace: string, hours: number = 24, limit: number = 500): Promise<TimelineResult> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/timeline`, {
      params: { hours, limit },
    })
    return data
  },

  getResourceTimeline: async (namespace: string, kind: string, name: string, hours: number = 24, limit: number = 500): Promise<TimelineResult> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/timeline/${kind}/${name}`, {
      params: { hours, limit },
    })
    return data
  },

  // Dependency Graph (legacy)
  getDependencyGraph: async (namespace: string): Promise<{
    nodes: Array<{
      id: string
      kind: string
      name: string
      namespace: string
      status: string
      ready?: string
      labels?: Record<string, string>
    }>
    edges: Array<{
      source: string
      target: string
      type: 'owns' | 'selects' | 'mounts' | 'routes' | 'binds'
    }>
  }> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/dependency-graph`)
    return data
  },

  // Resource Graph (upgraded)
  getResourceGraph: async (namespaces?: string[]): Promise<ResourceGraphResponse> => {
    const params = namespaces?.length ? `?namespaces=${namespaces.join(',')}` : ''
    const { data } = await client.get(`/resource-graph${params}`)
    return data
  },

  getNamespaceResourceGraph: async (namespace: string): Promise<ResourceGraphResponse> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/resource-graph`)
    return data
  },
}
