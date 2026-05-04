// Workloads API — deployments / replicasets / statefulsets / daemonsets
// / jobs / cronjobs / hpa / vpa / pdb. Pod / podlogs / podrbac live in
// pods.ts.

import { client } from './client'
import type {
  CronJobInfo,
  DaemonSetInfo,
  DeploymentInfo,
  HPAInfo,
  JobInfo,
  PDBInfo,
  ReplicaSetInfo,
  StatefulSetInfo,
  VPAInfo,
} from './types'

export const workloadsApi = {
  // Deployments
  getDeployments: async (namespace: string, forceRefresh = false): Promise<DeploymentInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/deployments`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllDeployments: async (forceRefresh = false): Promise<DeploymentInfo[]> => {
    const { data } = await client.get('/cluster/deployments/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeDeployment: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/deployments/${name}/describe`)
    return data
  },

  deleteDeployment: async (namespace: string, deploymentName: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/deployments/${deploymentName}`)
  },

  // StatefulSets
  getStatefulSets: async (namespace: string, forceRefresh = false): Promise<StatefulSetInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/statefulsets`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllStatefulSets: async (forceRefresh = false): Promise<StatefulSetInfo[]> => {
    const { data } = await client.get('/cluster/statefulsets/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeStatefulSet: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/statefulsets/${name}/describe`)
    return data
  },

  deleteStatefulSet: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/statefulsets/${name}`)
  },

  // DaemonSets
  getDaemonSets: async (namespace: string, forceRefresh = false): Promise<DaemonSetInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/daemonsets`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllDaemonSets: async (forceRefresh = false): Promise<DaemonSetInfo[]> => {
    const { data } = await client.get('/cluster/daemonsets/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeDaemonSet: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/daemonsets/${name}/describe`)
    return data
  },

  deleteDaemonSet: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/daemonsets/${name}`)
  },

  // Jobs
  getJobs: async (namespace: string, forceRefresh = false): Promise<JobInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/jobs`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllJobs: async (forceRefresh = false): Promise<JobInfo[]> => {
    const { data } = await client.get('/cluster/jobs/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeJob: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/jobs/${name}/describe`)
    return data
  },

  deleteJob: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/jobs/${name}`)
  },

  // CronJobs
  getCronJobs: async (namespace: string, forceRefresh = false): Promise<CronJobInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/cronjobs`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllCronJobs: async (forceRefresh = false): Promise<CronJobInfo[]> => {
    const { data } = await client.get('/cluster/cronjobs/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeCronJob: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/cronjobs/${name}/describe`)
    return data
  },

  deleteCronJob: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/cronjobs/${name}`)
  },

  suspendCronJob: async (namespace: string, name: string, suspend: boolean): Promise<void> => {
    await client.patch(`/cluster/namespaces/${namespace}/cronjobs/${name}/suspend`, { suspend })
  },

  triggerCronJob: async (namespace: string, name: string): Promise<{ job_name: string }> => {
    const { data } = await client.post(`/cluster/namespaces/${namespace}/cronjobs/${name}/trigger`)
    return data
  },

  getCronJobOwnedJobs: async (namespace: string, name: string): Promise<any[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/cronjobs/${name}/jobs`)
    return data
  },

  // ReplicaSets
  getReplicaSets: async (namespace: string, forceRefresh = false): Promise<ReplicaSetInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/replicasets`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllReplicaSets: async (forceRefresh = false): Promise<ReplicaSetInfo[]> => {
    const { data } = await client.get('/cluster/replicasets/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeReplicaSet: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/replicasets/${name}/describe`)
    return data
  },

  deleteReplicaSet: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/replicasets/${name}`)
  },

  // Workload revisions / rollback (Deployment / DaemonSet / StatefulSet)
  getWorkloadRevisions: async (namespace: string, name: string, kind: string): Promise<any[]> => {
    const plural = kind === 'Deployment' ? 'deployments' : kind === 'DaemonSet' ? 'daemonsets' : 'statefulsets'
    const { data } = await client.get(`/cluster/namespaces/${namespace}/${plural}/${name}/revisions`)
    return data
  },

  rollbackWorkload: async (namespace: string, name: string, kind: string, revision: number): Promise<void> => {
    const plural = kind === 'Deployment' ? 'deployments' : kind === 'DaemonSet' ? 'daemonsets' : 'statefulsets'
    await client.post(`/cluster/namespaces/${namespace}/${plural}/${name}/rollback`, { revision })
  },

  // HPA
  getHPAs: async (namespace: string, forceRefresh = false): Promise<HPAInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/hpas`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllHPAs: async (forceRefresh = false): Promise<HPAInfo[]> => {
    const { data } = await client.get('/cluster/hpas/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeHPA: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/hpas/${name}/describe`)
    return data
  },

  deleteHPA: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/hpas/${name}`)
  },

  // VPA
  getVPAs: async (namespace: string, forceRefresh = false): Promise<VPAInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/vpas`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllVPAs: async (forceRefresh = false): Promise<VPAInfo[]> => {
    const { data } = await client.get('/cluster/vpas/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describeVPA: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/vpas/${name}/describe`)
    return data
  },

  deleteVPA: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/vpas/${name}`)
  },

  // PDB
  getPDBs: async (namespace: string, forceRefresh = false): Promise<PDBInfo[]> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/pdbs`, {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  getAllPDBs: async (forceRefresh = false): Promise<PDBInfo[]> => {
    const { data } = await client.get('/cluster/pdbs/all', {
      params: { force_refresh: forceRefresh },
    })
    return data
  },

  describePDB: async (namespace: string, name: string): Promise<any> => {
    const { data } = await client.get(`/cluster/namespaces/${namespace}/pdbs/${name}/describe`)
    return data
  },

  deletePDB: async (namespace: string, name: string): Promise<void> => {
    await client.delete(`/cluster/namespaces/${namespace}/pdbs/${name}`)
  },
}
