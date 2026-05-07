// ResourceDetailDrawer 의 유틸 + 상수 + 작은 sub-component (HelmReleaseBadge).
// ResourceDetailDrawer.tsx 에서 추출 (Phase 3.3.a).
//
// 모두 순수 / 표현 컴포넌트라 instance state 없음. drawer 본체에서 import.
//
// 분류:
// - 상수: WORKLOAD_KINDS / NETWORK_KINDS / CONFIG_STORAGE_KINDS / SELF_LOADING_KINDS / UNRESOLVABLE_KINDS
// - 매핑: kindToPlural (Kind → API 복수형) / kindIcon (Kind → 이모지)
// - Helm: extractHelmRelease / HelmReleaseBadge (drawer 헤더에 Helm release 배지)
// - Secret: decodeSecretYaml / encodeSecretYaml (data ↔ stringData base64 변환)

import { Link } from 'react-router-dom'
import { Package, ArrowUpRight } from 'lucide-react'

export type TabId = 'info' | 'yaml'

export const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'])
export const NETWORK_KINDS = new Set(['Ingress', 'IngressClass', 'NetworkPolicy', 'Endpoints', 'EndpointSlice'])
export const CONFIG_STORAGE_KINDS = new Set(['PersistentVolume', 'PersistentVolumeClaim', 'StorageClass', 'VolumeAttachment'])

// Kinds whose info components fetch their own data and don't need injected rawJson.
export const SELF_LOADING_KINDS = new Set(['Node', 'Namespace'])
// CustomResourceInstance needs crd_name in rawJson and cannot be resolved via kindToPlural.
export const UNRESOLVABLE_KINDS = new Set(['CustomResourceInstance'])

// extractHelmRelease returns the owning Helm release coordinates
// (namespace, name) if the given raw resource JSON carries the
// meta.helm.sh annotations. The managed-by label is an extra signal
// but we do not require it — Helm sets the annotations even when a
// chart intentionally omits the label.
export function extractHelmRelease(
  rawJson: Record<string, unknown> | null | undefined,
): { namespace: string; name: string } | null {
  const metadata = (rawJson?.metadata ?? {}) as Record<string, unknown>
  const annotations = (metadata?.annotations ?? {}) as Record<string, string>
  const name = annotations['meta.helm.sh/release-name']
  const ns = annotations['meta.helm.sh/release-namespace']
  if (typeof name !== 'string' || !name) return null
  if (typeof ns !== 'string' || !ns) return null
  return { namespace: ns, name }
}

// HelmReleaseBadge surfaces the owning Helm release on any resource
// that was installed via Helm. Placed in the drawer header so users
// can jump from "why is this pod here?" to the Helm detail page in
// one click.
export function HelmReleaseBadge({ rawJson }: { rawJson: Record<string, unknown> | null | undefined }) {
  const rel = extractHelmRelease(rawJson)
  if (!rel) return null
  const to = `/helm/releases/${encodeURIComponent(rel.namespace)}/${encodeURIComponent(rel.name)}`
  return (
    <Link
      to={to}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-primary-500/40 bg-primary-500/10 px-2 py-0.5 text-xs text-primary-200 hover:bg-primary-500/20"
      title={`Helm release ${rel.namespace}/${rel.name}`}
    >
      <Package className="w-3 h-3" />
      <span className="font-medium">{rel.name}</span>
      <span className="text-primary-400/80">·</span>
      <span className="text-primary-300/90">{rel.namespace}</span>
      <ArrowUpRight className="w-3 h-3" />
    </Link>
  )
}

export function decodeSecretYaml(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  let inDataBlock = false
  let dataIndent = -1
  for (const line of lines) {
    if (/^data:\s*$/.test(line)) {
      result.push('stringData:')
      inDataBlock = true
      dataIndent = -1
      continue
    }
    if (inDataBlock) {
      const match = line.match(/^(\s+)(\S+?):\s*(.+)$/)
      if (match) {
        const [, indent, key, value] = match
        if (dataIndent < 0) dataIndent = indent.length
        if (indent.length === dataIndent) {
          const trimmed = value.trim()
          try {
            const decoded = atob(trimmed)
            if (!/[\x00-\x08\x0E-\x1F]/.test(decoded)) {
              const needsQuote = decoded.includes(':') || decoded.includes('#') || decoded.includes('\n') || decoded.includes('"') || decoded.includes("'") || decoded.startsWith(' ') || decoded.endsWith(' ')
              result.push(`${indent}${key}: ${needsQuote ? JSON.stringify(decoded) : decoded}`)
              continue
            }
          } catch { /* not valid base64, keep as-is */ }
          result.push(line)
          continue
        }
      }
      if (line.length > 0 && !line.startsWith(' ')) {
        inDataBlock = false
      }
    }
    result.push(line)
  }
  return result.join('\n')
}

export function encodeSecretYaml(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  let inStringDataBlock = false
  let blockIndent = -1
  for (const line of lines) {
    if (/^stringData:\s*$/.test(line)) {
      result.push('data:')
      inStringDataBlock = true
      blockIndent = -1
      continue
    }
    if (inStringDataBlock) {
      const match = line.match(/^(\s+)(\S+?):\s*(.+)$/)
      if (match) {
        const [, indent, key, value] = match
        if (blockIndent < 0) blockIndent = indent.length
        if (indent.length === blockIndent) {
          let raw = value.trim()
          if (raw.startsWith('"') && raw.endsWith('"')) {
            try { raw = JSON.parse(raw) } catch { /* keep as-is */ }
          }
          result.push(`${indent}${key}: ${btoa(raw)}`)
          continue
        }
      }
      if (line.length > 0 && !line.startsWith(' ')) {
        inStringDataBlock = false
      }
    }
    result.push(line)
  }
  return result.join('\n')
}

export function kindToPlural(kind: string): string {
  const map: Record<string, string> = {
    Pod: 'pod', Node: 'node', Namespace: 'namespace', Service: 'service',
    Deployment: 'deployment', ReplicaSet: 'replicaset', StatefulSet: 'statefulset',
    DaemonSet: 'daemonset', Job: 'job', CronJob: 'cronjob',
    ConfigMap: 'configmap', Secret: 'secret', Ingress: 'ingress',
    NetworkPolicy: 'networkpolicy', PersistentVolumeClaim: 'persistentvolumeclaim',
    PersistentVolume: 'persistentvolume', HorizontalPodAutoscaler: 'horizontalpodautoscaler',
    VerticalPodAutoscaler: 'verticalpodautoscaler',
    Endpoints: 'endpoints', EndpointSlice: 'endpointslice',
    IngressClass: 'ingressclass',
    Gateway: 'gateway',
    GatewayClass: 'gatewayclass',
    HTTPRoute: 'httproute',
    GRPCRoute: 'grpcroute',
    ReferenceGrant: 'referencegrant',
    BackendTLSPolicy: 'backendtlspolicy',
    BackendTrafficPolicy: 'backendtrafficpolicy',
    DeviceClass: 'deviceclass',
    ResourceClaim: 'resourceclaim',
    ResourceClaimTemplate: 'resourceclaimtemplate',
    ResourceSlice: 'resourceslice',
    StorageClass: 'storageclass',
    VolumeAttachment: 'volumeattachment',
    ServiceAccount: 'serviceaccount',
    Role: 'role',
    RoleBinding: 'rolebinding',
    ClusterRole: 'clusterrole',
    ClusterRoleBinding: 'clusterrolebinding',
    PodDisruptionBudget: 'poddisruptionbudget',
    PriorityClass: 'priorityclass',
    RuntimeClass: 'runtimeclass',
    Lease: 'lease',
    ResourceQuota: 'resourcequota',
    LimitRange: 'limitrange',
    MutatingWebhookConfiguration: 'mutatingwebhookconfiguration',
    ValidatingWebhookConfiguration: 'validatingwebhookconfiguration',
    CustomResourceDefinition: 'customresourcedefinition',
    CustomResourceInstance: 'customresourceinstance',
  }
  return map[kind] ?? kind.toLowerCase()
}

export function kindIcon(kind: string): string {
  const map: Record<string, string> = {
    Node: '🖥️', Namespace: '📦', Pod: '🔵', Deployment: '🚀', StatefulSet: '📊',
    DaemonSet: '👾', ReplicaSet: '📋', Job: '⚡', CronJob: '⏰',
    Service: '🌐', Ingress: '🔀', NetworkPolicy: '🛡️',
    IngressClass: '🧩',
    EndpointSlice: '🧩',
    Gateway: '🚪',
    GatewayClass: '🚏',
    HTTPRoute: '🧭',
    GRPCRoute: '📡',
    ReferenceGrant: '🔗',
    BackendTLSPolicy: '🔒',
    BackendTrafficPolicy: '🚦',
    DeviceClass: '🎮',
    ResourceClaim: '📋',
    ResourceClaimTemplate: '📄',
    ResourceSlice: '🧩',
    ServiceAccount: '👤', Role: '🔐', RoleBinding: '🔗', ClusterRole: '🔐', ClusterRoleBinding: '🔗',
    ConfigMap: '📝', Secret: '🔑', PersistentVolume: '💾', PersistentVolumeClaim: '💿',
    StorageClass: '🗄️', VolumeAttachment: '🔗', HorizontalPodAutoscaler: '📈', VerticalPodAutoscaler: '📊',
    PodDisruptionBudget: '🛡️',
    PriorityClass: '⚡',
    RuntimeClass: '🔧',
    Lease: '🤝',
    ResourceQuota: '📊',
    LimitRange: '📏',
    MutatingWebhookConfiguration: '🔄',
    ValidatingWebhookConfiguration: '✅',
    CustomResourceDefinition: '🧩',
    CustomResourceInstance: '📦',
  }
  return map[kind] ?? '📄'
}
