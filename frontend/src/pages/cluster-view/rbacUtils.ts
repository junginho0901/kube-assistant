// Pod RBAC 분석 helper. ClusterView.tsx 에서 추출 (Phase 3.1.d).
//
// `isAuthenticatedOnlyGrant`: binding 이 system:authenticated 그룹만으로 부여
// 됐는지 — UI 가 "인증된 사용자 전체" 부여를 noise 로 필터하는 데 사용.
//
// `buildRbacPermissionSummary`: 모든 role/cluster role binding 의 rules 를
// 평탄화 + 중복 제거 + 정렬해서 (resource, verbs) 표 형태로 가공.
// 가장 복잡한 로직 (~100줄) 인데 tr / React 의존 X 라 순수 함수로 추출.

export const isAuthenticatedOnlyGrant = (binding: any): boolean => {
  const matchedBy = binding?.matched_by
  if (Array.isArray(matchedBy) && matchedBy.length > 0) {
    return matchedBy.every((m: any) => m?.reason === 'group:system:authenticated')
  }
  return Boolean(binding?.is_broad)
}

export interface RbacPermissionItem {
  kind: 'resource' | 'nonResourceURL'
  apiGroup?: string
  resource?: string
  resourceNames?: string[]
  nonResourceURL?: string
  verbs: Set<string>
  verbsList: string[]
}

export interface RbacPermissionSummary {
  resourceItems: RbacPermissionItem[]
  nonResourceItems: RbacPermissionItem[]
}

export const buildRbacPermissionSummary = (rbac: any): RbacPermissionSummary => {
  const items: Array<{
    kind: 'resource' | 'nonResourceURL'
    apiGroup?: string
    resource?: string
    resourceNames?: string[]
    nonResourceURL?: string
    verbs: Set<string>
  }> = []

  const resourceIndex = new Map<string, number>()
  const nonResourceIndex = new Map<string, number>()

  const addResource = (apiGroup: string, resource: string, resourceNames: string[] | undefined, verbs: string[]) => {
    const namesKey = (resourceNames || []).slice().sort().join(',')
    const key = `${apiGroup}::${resource}::${namesKey}`
    const existingIndex = resourceIndex.get(key)
    if (existingIndex !== undefined) {
      for (const v of verbs) items[existingIndex].verbs.add(v)
      return
    }
    const idx = items.length
    resourceIndex.set(key, idx)
    items.push({
      kind: 'resource',
      apiGroup,
      resource,
      resourceNames: resourceNames && resourceNames.length ? resourceNames.slice().sort() : undefined,
      verbs: new Set(verbs || []),
    })
  }

  const addNonResource = (url: string, verbs: string[]) => {
    const key = url
    const existingIndex = nonResourceIndex.get(key)
    if (existingIndex !== undefined) {
      for (const v of verbs) items[existingIndex].verbs.add(v)
      return
    }
    const idx = items.length
    nonResourceIndex.set(key, idx)
    items.push({
      kind: 'nonResourceURL',
      nonResourceURL: url,
      verbs: new Set(verbs || []),
    })
  }

  const bindings = [
    ...((rbac?.role_bindings || []) as any[]),
    ...((rbac?.cluster_role_bindings || []) as any[]),
  ]

  for (const b of bindings) {
    const rules = b?.resolved_role?.rules
    if (!Array.isArray(rules)) continue
    for (const rule of rules) {
      const verbs: string[] = Array.isArray(rule?.verbs) ? rule.verbs : []

      const nonResourceURLs: string[] = Array.isArray(rule?.non_resource_urls) ? rule.non_resource_urls : []
      if (nonResourceURLs.length > 0) {
        for (const url of nonResourceURLs) {
          if (typeof url === 'string' && url.trim()) addNonResource(url, verbs)
        }
        continue
      }

      const apiGroups: string[] = Array.isArray(rule?.api_groups) && rule.api_groups.length ? rule.api_groups : ['']
      const resources: string[] = Array.isArray(rule?.resources) ? rule.resources : []
      const resourceNames: string[] | undefined = Array.isArray(rule?.resource_names) ? rule.resource_names : undefined

      for (const ag of apiGroups) {
        const apiGroup = ag === '' ? '(core)' : ag
        for (const res of resources) {
          if (typeof res === 'string' && res.trim()) addResource(apiGroup, res, resourceNames, verbs)
        }
      }
    }
  }

  const resourceItems = items
    .filter((i) => i.kind === 'resource')
    .map((i) => ({
      ...i,
      verbsList: Array.from(i.verbs).sort(),
    }))
    .sort((a, b) => {
      const ag = (a.apiGroup || '').localeCompare(b.apiGroup || '')
      if (ag !== 0) return ag
      const r = (a.resource || '').localeCompare(b.resource || '')
      if (r !== 0) return r
      const an = (a.resourceNames || []).join(',').localeCompare((b.resourceNames || []).join(','))
      return an
    })

  const nonResourceItems = items
    .filter((i) => i.kind === 'nonResourceURL')
    .map((i) => ({
      ...i,
      verbsList: Array.from(i.verbs).sort(),
    }))
    .sort((a, b) => (a.nonResourceURL || '').localeCompare(b.nonResourceURL || ''))

  return { resourceItems, nonResourceItems }
}
