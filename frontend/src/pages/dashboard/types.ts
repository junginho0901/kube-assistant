// Shared types for the Dashboard page sub-components.
//
// Kept in one file rather than colocated because the issue derivation
// logic spans pods, nodes, deployments, PVCs, and metrics — splitting
// the union into per-resource files would just spread the same export
// list across five files.

export type ResourceType =
  | 'namespaces'
  | 'pods'
  | 'services'
  | 'deployments'
  | 'pvcs'
  | 'nodes'

export type IssueSeverity = 'critical' | 'warning' | 'info'

export type IssueKind = 'Pod' | 'Node' | 'Deployment' | 'PVC' | 'Metrics'

export interface IssueItem {
  id: string
  kind: IssueKind
  severity: IssueSeverity
  title: string
  subtitle?: string
  namespace?: string
  name?: string
}

export interface OptimizationUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface OptimizationMeta {
  finish_reason?: string | null
  max_tokens?: number | null
}
