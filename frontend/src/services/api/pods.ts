// Pods API — list / describe / logs / delete / RBAC.
// Pod exec / logs WS streams are not in this file (they go through
// the dedicated WebSocket multiplexer in /api/v1/ws).

import { client } from './client'
import type { PodInfo, PodRbacResponse } from './types'

export const podsApi = {
  getPods: async (namespace: string, labelSelector?: string, forceRefresh = false): Promise<PodInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/pods`, {
      params: { label_selector: labelSelector, force_refresh: forceRefresh },
    })
    return data
  },

  getAllPods: async (forceRefresh: boolean = false): Promise<PodInfo[]> => {
    const { data } = await client.get('/cluster/pods/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describePod: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/pods/${name}/describe`)
    return data
  },

  getPodLogs: async (
    namespace: string,
    podName: string,
    container?: string,
    tailLines: number = 100,
  ): Promise<string> => {
    const { data } = await client.get(
      `/cluster/namespaces/${namespace}/pods/${podName}/logs`,
      {
        params: { container, tail_lines: tailLines },
      },
    )
    return typeof data === 'string' ? data : (data.logs ?? data.data ?? '')
  },

  deletePod: async (namespace: string, podName: string, force: boolean = false): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/pods/${podName}`, {
      params: { force },
    })
  },

  getPodRbac: async (
    namespace: string,
    podName: string,
    params?: { include_authenticated?: boolean },
  ): Promise<PodRbacResponse> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/pods/${podName}/rbac`, { params })
    return data
  },
}
