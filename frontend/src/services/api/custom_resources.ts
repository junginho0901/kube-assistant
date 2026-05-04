// Custom Resource API — CRDs (CustomResourceDefinitions) and the
// generic instance lookup that dispatches by group/version/plural.

import { client } from './client'
import type { CRDInfo, CustomResourceInstanceInfo } from './types'

export const customResourcesApi = {
  // CRDs
  getCRDs: async (forceRefresh = false): Promise<CRDInfo[]> => {
    const { data } = await client.get('/cluster/crds', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeCRD: async (name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/crds/${name}/describe`)
    return data
  },

  deleteCRD: async (name: string): Promise<void> => {
    await client.delete(`/cluster/crds/${name}`)
  },

  // Instances
  getAllCustomResourceInstances: async (forceRefresh = false): Promise<CustomResourceInstanceInfo[]> => {
    const { data } = await client.get('/cluster/custom-resources/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getCustomResourceInstances: async (group: string, version: string, plural: string): Promise<any[]> => {
    const { data } = await client.get(`/cluster/custom-resources/${group}/${version}/${plural}`)
    return data
  },

  describeCustomResourceInstance: async (group: string, version: string, plural: string, namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/custom-resources/${group}/${version}/${plural}/${namespace}/${name}/describe`)
    return data
  },

  deleteCustomResourceInstance: async (group: string, version: string, plural: string, namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/custom-resources/${group}/${version}/${plural}/${namespace}/${name}`)
  },
}
