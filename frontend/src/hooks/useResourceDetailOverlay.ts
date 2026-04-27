import { useMemo } from 'react'

import { useAIContext } from './useAIContext'
import { buildResourceLink } from '@/utils/resourceLink'

/**
 * ResourceDetailDrawer 의 InfoXxx 컴포넌트들이 공통으로 사용하는 overlay 헬퍼.
 *
 * 대부분의 InfoXxx 는:
 *   1. `describe<Resource>` 1회 fetch (events 포함, raw 보다 풍부)
 *   2. 옵션으로 추가 fetch (관련 리소스 등)
 *
 * 이 훅을 호출하면 자동으로:
 *   - source = `${kind}Info`
 *   - summary = `${kind} ${name}${ns ? ` (${ns})` : ''} 상세`
 *   - data = { kind, name, namespace, _link, ...describe, ...extras }
 *
 * 8KB 토큰 한도는 useAIContext 가 자동 적용. raw 와 중복되는 부분이 있어도 무해.
 */
export function useResourceDetailOverlay(params: {
  kind: string
  name: string
  namespace?: string
  describe?: Record<string, unknown> | unknown
  extras?: Record<string, unknown>
  /** 기본 summary 를 덮어쓰고 싶을 때 */
  summary?: string
}) {
  const { kind, name, namespace, describe, extras, summary: customSummary } = params

  const snapshot = useMemo(() => {
    if (!name || !kind) return null
    const desc = (typeof describe === 'object' && describe !== null
      ? (describe as Record<string, unknown>)
      : undefined)
    const link = buildResourceLink(kind, namespace, name)
    const summary = customSummary ?? `${kind} ${name}${namespace ? ` (${namespace})` : ''} 상세`
    return {
      source: `${kind}Info`,
      summary,
      data: {
        kind,
        name,
        namespace,
        ...(link ? { _link: link } : {}),
        ...(desc ?? {}),
        ...(extras ?? {}),
      },
    }
  }, [kind, name, namespace, describe, extras, customSummary])

  useAIContext(snapshot, [snapshot])
}
