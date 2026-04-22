/**
 * `kubest://` 커스텀 스킴으로 리소스 상세 드로어 링크를 직렬화/파싱.
 *
 * AI 답변에 포함된 마크다운 링크가 클릭되면 `MarkdownLink` 가 `kubest://`
 * 만 가로채 `useResourceDetail.open(...)` 을 호출 → Drawer 자동 오픈.
 *
 * App.tsx 에 리소스 상세 URL 라우트가 없는 구조 때문에 (전부 Drawer 기반)
 * 일반 `/workloads/pods/:name` 같은 라우터 경로 대신 커스텀 스킴을 쓴다.
 *
 * XSS 방어: 리소스 이름 / 네임스페이스는 k8s DNS-1123 규격으로 검증.
 */

// DNS-1123 label (namespace, 단순 리소스 이름)
const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
// DNS-1123 subdomain (일부 리소스 이름은 dot 포함)
const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/

const KIND_LABEL = /^[A-Za-z][A-Za-z0-9]*$/

export interface ResourceLinkParts {
  kind: string
  name: string
  namespace?: string
}

/**
 * `kubest://pod?ns=default&name=nginx-abc` 같은 URI 를 생성.
 *
 * 입력값이 유효하지 않으면 `null` 반환 → 호출부가 링크 렌더 자체를 포기.
 */
export function buildResourceLink(
  kind: string,
  namespace: string | undefined,
  name: string,
): string | null {
  if (!KIND_LABEL.test(kind)) return null
  if (!DNS1123_SUBDOMAIN.test(name)) return null
  if (namespace !== undefined && namespace !== null && namespace !== '') {
    if (!DNS1123_LABEL.test(namespace)) return null
  }

  const kindLower = kind.toLowerCase()
  const params = new URLSearchParams()
  if (namespace) params.set('ns', namespace)
  params.set('name', name)
  return `kubest://${kindLower}?${params.toString()}`
}

/**
 * `kubest://` URI 를 안전하게 파싱. 포맷이 다르거나 이름이 규격 위반이면 null.
 *
 * URL 파서가 `kubest://` 의 host 를 파싱하지 않는 브라우저가 있어
 * 수동 파싱으로 안전하게 처리.
 */
export function parseResourceLink(href: string): ResourceLinkParts | null {
  if (!href.startsWith('kubest://')) return null

  const after = href.slice('kubest://'.length)
  const qIdx = after.indexOf('?')
  if (qIdx < 0) return null

  const kindLower = after.slice(0, qIdx)
  if (!/^[a-z][a-z0-9]*$/.test(kindLower)) return null

  let params: URLSearchParams
  try {
    params = new URLSearchParams(after.slice(qIdx + 1))
  } catch {
    return null
  }

  const name = params.get('name')
  const namespace = params.get('ns') || undefined
  if (!name || !DNS1123_SUBDOMAIN.test(name)) return null
  if (namespace && !DNS1123_LABEL.test(namespace)) return null

  // 표준 CamelCase Kind 로 복원 — 단순히 첫 글자 대문자.
  // (실제 리소스 kind 는 다양하지만 Drawer 는 kind 문자열을 그대로 사용)
  const kind = kindLower.charAt(0).toUpperCase() + kindLower.slice(1)

  return { kind, name, namespace }
}
