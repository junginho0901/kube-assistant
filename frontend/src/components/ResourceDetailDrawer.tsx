import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, Info, FileCode } from 'lucide-react'
import { useResourceDetail } from './ResourceDetailContext'
import { api } from '@/services/api'
import YamlEditor from './YamlEditor'

import NodeInfo from './resource-detail/NodeInfo'
import NamespaceInfo from './resource-detail/NamespaceInfo'
import PodInfo from './resource-detail/PodInfo'
import WorkloadInfo from './resource-detail/WorkloadInfo'
import NetworkInfo from './resource-detail/NetworkInfo'
import ConfigStorageInfo from './resource-detail/ConfigStorageInfo'
import GenericInfo from './resource-detail/GenericInfo'

type TabId = 'info' | 'yaml'

const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'])
const NETWORK_KINDS = new Set(['Service', 'Ingress', 'NetworkPolicy', 'Endpoints', 'EndpointSlice'])
const CONFIG_STORAGE_KINDS = new Set(['ConfigMap', 'Secret', 'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass', 'HorizontalPodAutoscaler'])

function kindToPlural(kind: string): string {
  const map: Record<string, string> = {
    Pod: 'pod', Node: 'node', Namespace: 'namespace', Service: 'service',
    Deployment: 'deployment', ReplicaSet: 'replicaset', StatefulSet: 'statefulset',
    DaemonSet: 'daemonset', Job: 'job', CronJob: 'cronjob',
    ConfigMap: 'configmap', Secret: 'secret', Ingress: 'ingress',
    NetworkPolicy: 'networkpolicy', PersistentVolumeClaim: 'persistentvolumeclaim',
    PersistentVolume: 'persistentvolume', HorizontalPodAutoscaler: 'horizontalpodautoscaler',
    Endpoints: 'endpoints', EndpointSlice: 'endpointslice',
    StorageClass: 'storageclass',
  }
  return map[kind] ?? kind.toLowerCase()
}

function kindIcon(kind: string): string {
  const map: Record<string, string> = {
    Node: '🖥️', Namespace: '📦', Pod: '🔵', Deployment: '🚀', StatefulSet: '📊',
    DaemonSet: '👾', ReplicaSet: '📋', Job: '⚡', CronJob: '⏰',
    Service: '🌐', Ingress: '🔀', NetworkPolicy: '🛡️',
    ConfigMap: '📝', Secret: '🔑', PersistentVolume: '💾', PersistentVolumeClaim: '💿',
    StorageClass: '🗄️', HorizontalPodAutoscaler: '📈',
  }
  return map[kind] ?? '📄'
}

export default function ResourceDetailDrawer() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { target, close } = useResourceDetail()
  const [tab, setTab] = useState<TabId>('info')
  const [yamlRefreshNonce, setYamlRefreshNonce] = useState(0)
  const [isYamlDirty, setIsYamlDirty] = useState(false)
  const [applyToast, setApplyToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const ns = target?.namespace
  const name = target?.name ?? ''
  const kind = target?.kind ?? ''

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 30000, enabled: !!target })
  const isWriteRole = me?.role === 'admin' || me?.role === 'write'
  const canEditYaml = isWriteRole

  const { data: yamlData, isLoading: yamlLoading, isFetching: yamlFetching, isError: yamlError } = useQuery({
    queryKey: ['resource-yaml', kind, ns, name, yamlRefreshNonce],
    queryFn: async () => {
      if (kind === 'Node') return api.getNodeYaml(name, yamlRefreshNonce > 0)
      if (kind === 'Namespace') return api.getNamespaceYaml(name, yamlRefreshNonce > 0)
      return api.getResourceYaml(kindToPlural(kind), name, ns || undefined)
    },
    enabled: !!target && tab === 'yaml',
    staleTime: 10_000,
    retry: 1,
  })

  const handleApplyYaml = async (yaml: string) => {
    if (kind === 'Node') await api.applyNodeYaml(name, yaml)
    else if (kind === 'Namespace') await api.applyNamespaceYaml(name, yaml)
    else await api.applyResourceYaml(kindToPlural(kind), name, yaml, ns || undefined)
  }

  const invalidateAfterApply = useCallback(() => {
    setYamlRefreshNonce(prev => prev + 1)
    queryClient.invalidateQueries({ queryKey: ['resource-yaml'] })
    if (kind === 'Node') {
      queryClient.invalidateQueries({ queryKey: ['cluster', 'nodes'] })
      queryClient.invalidateQueries({ queryKey: ['cluster', 'nodes', 'describe', name] })
      queryClient.invalidateQueries({ queryKey: ['cluster', 'nodes', 'pods', name] })
      queryClient.invalidateQueries({ queryKey: ['cluster', 'node-metrics'] })
    } else if (kind === 'Namespace') {
      queryClient.invalidateQueries({ queryKey: ['namespace-describe', name] })
      queryClient.invalidateQueries({ queryKey: ['namespaces'] })
      queryClient.invalidateQueries({ queryKey: ['namespace-resource-quotas', name] })
      queryClient.invalidateQueries({ queryKey: ['namespace-limit-ranges', name] })
    } else if (kind === 'Pod') {
      queryClient.invalidateQueries({ queryKey: ['pod-describe', ns, name] })
      queryClient.invalidateQueries({ queryKey: ['cluster', 'pods'] })
    } else {
      queryClient.invalidateQueries({ queryKey: ['search-resources'] })
    }
  }, [queryClient, kind, ns, name])

  const confirmDiscardYaml = () => {
    if (!isYamlDirty) return true
    return window.confirm(t('common.yamlUnsaved', { defaultValue: 'You have unsaved YAML changes. Discard them?' }))
  }

  const handleClose = () => {
    if (!confirmDiscardYaml()) return
    close()
    setTab('info')
    setIsYamlDirty(false)
    setApplyToast(null)
    setYamlRefreshNonce(0)
  }

  const handleTabChange = (next: TabId) => {
    if (tab === next) return
    if (tab === 'yaml' && !confirmDiscardYaml()) return
    setTab(next)
  }

  if (!target) return null

  const renderInfoContent = () => {
    if (kind === 'Node') return <NodeInfo name={name} />
    if (kind === 'Namespace') return <NamespaceInfo name={name} />
    if (kind === 'Pod' && ns) return <PodInfo name={name} namespace={ns} rawJson={target.rawJson} />
    if (WORKLOAD_KINDS.has(kind)) return <WorkloadInfo name={name} namespace={ns} kind={kind} rawJson={target.rawJson} />
    if (NETWORK_KINDS.has(kind)) return <NetworkInfo name={name} namespace={ns} kind={kind} rawJson={target.rawJson} />
    if (CONFIG_STORAGE_KINDS.has(kind)) return <ConfigStorageInfo name={name} namespace={ns} kind={kind} rawJson={target.rawJson} />
    return <GenericInfo name={name} namespace={ns} kind={kind} rawJson={target.rawJson} />
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[998]" onClick={handleClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-[740px] bg-slate-900 border-l border-slate-700 z-[999] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{kindIcon(kind)}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-medium">{kind}</span>
              {ns && <span className="text-xs text-slate-500">{ns}</span>}
            </div>
            <h2 className="text-lg font-semibold text-white truncate">{name}</h2>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-800 text-xs shrink-0">
          {([
            { id: 'info' as TabId, label: t('common.info', { defaultValue: 'Info' }), icon: Info },
            { id: 'yaml' as TabId, label: 'YAML', icon: FileCode },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md border transition-colors ${
                tab === id
                  ? 'border-slate-500 bg-slate-800 text-white'
                  : 'border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {tab === 'info' && (
            <div className="p-5 space-y-6 text-sm">
              {renderInfoContent()}
            </div>
          )}

          {tab === 'yaml' && (
            <div className="h-full">
              <YamlEditor
                key={`${kind}-${name}-${ns || ''}`}
                value={yamlData?.yaml || ''}
                canEdit={canEditYaml}
                isLoading={yamlLoading}
                isRefreshing={yamlFetching}
                error={yamlError ? t('common.yamlError', { defaultValue: 'Failed to load YAML.' }) : null}
                onRefresh={() => setYamlRefreshNonce(prev => prev + 1)}
                onApply={canEditYaml ? handleApplyYaml : undefined}
                onApplySuccess={() => { invalidateAfterApply(); setApplyToast({ type: 'success', message: t('common.applied', { defaultValue: 'Applied' }) }) }}
                onApplyError={(msg) => setApplyToast({ type: 'error', message: msg || t('common.applyError', { defaultValue: 'Apply failed.' }) })}
                onDirtyChange={setIsYamlDirty}
                showInlineApplied={false}
                toast={applyToast}
                labels={{
                  title: `${kind}: ${name}`,
                  refresh: t('common.refresh', { defaultValue: 'Refresh' }),
                  copy: t('common.copy', { defaultValue: 'Copy' }),
                  edit: t('common.edit', { defaultValue: 'Edit' }),
                  apply: t('common.apply', { defaultValue: 'Apply' }),
                  applying: t('common.applying', { defaultValue: 'Applying...' }),
                  cancel: t('common.cancel', { defaultValue: 'Cancel' }),
                  loading: t('common.loading', { defaultValue: 'Loading...' }),
                  error: t('common.error', { defaultValue: 'Error' }),
                  readonly: t('common.readonly', { defaultValue: 'Read-only' }),
                  editHint: t('common.editHint', { defaultValue: 'Edit YAML' }),
                  applied: t('common.applied', { defaultValue: 'Applied' }),
                  refreshing: t('common.refreshing', { defaultValue: 'Refreshing...' }),
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
