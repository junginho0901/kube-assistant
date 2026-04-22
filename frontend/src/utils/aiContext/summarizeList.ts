/**
 * 리소스 목록 페이지(Pods, Deployments, Nodes 등) 의 화면 데이터를
 * LLM 이 이해하기 쉬운 형태로 요약.
 *
 * - `pagination`: 현재 페이지 메타 (전체 건수, 보이는 건수 등)
 * - `visible_items`: 현재 페이지에서 보이는 상위 N 개 (slim 필드만)
 * - `problematic_items`: filterProblematic 콜백이 true 반환한 항목 상위 N 개
 * - `interpretations`: Headlamp 패턴 — "⚠️ 3개 Pod 이 CrashLoopBackOff" 같이
 *   이미 해석된 자연어 문장. LLM 이 재계산하지 않고 그대로 인용 가능
 * - `visible_items[*]._link`: 각 항목의 `kubest://` URI (MarkdownLink 클릭 시 Drawer 자동 오픈)
 */

export interface SummarizeListOptions<T> {
  total?: number
  currentPage?: number
  pageSize?: number
  topN?: number
  pickFields?: (keyof T)[]
  filterProblematic?: (item: T) => boolean
  /** 해석된 자연어 문장들. ⚠️ 이모지로 문제 강조 가능 */
  interpret?: (items: T[]) => string[]
  /** 각 item 의 `kubest://` 링크 생성 (utils/resourceLink.ts#buildResourceLink) */
  linkBuilder?: (item: T) => string | null
}

export interface SummarizeListResult<T> {
  pagination: {
    current_page: number
    total_pages: number
    page_size: number
    total_count: number
    showing_count: number
  }
  visible_items: Array<Partial<T> & { _link?: string }>
  problematic_items?: Array<Partial<T> & { _link?: string }>
  interpretations?: string[]
}

export function summarizeList<T extends Record<string, unknown>>(
  items: T[],
  options: SummarizeListOptions<T> = {},
): SummarizeListResult<T> {
  const pageSize = options.pageSize ?? (items.length || 1)
  const currentPage = options.currentPage ?? 1
  const total = options.total ?? items.length
  const topN = options.topN ?? 10

  const slim = (item: T): Partial<T> & { _link?: string } => {
    const base: Partial<T> & { _link?: string } = options.pickFields
      ? options.pickFields.reduce<Partial<T>>((acc, field) => {
          acc[field] = item[field]
          return acc
        }, {})
      : { ...item }
    if (options.linkBuilder) {
      const link = options.linkBuilder(item)
      if (link) base._link = link
    }
    return base
  }

  const visibleItems = items.slice(0, topN).map(slim)

  const problematicItems = options.filterProblematic
    ? items.filter(options.filterProblematic).slice(0, topN).map(slim)
    : undefined

  const interpretations = options.interpret
    ? options.interpret(items).filter(Boolean)
    : undefined

  const result: SummarizeListResult<T> = {
    pagination: {
      current_page: currentPage,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      page_size: pageSize,
      total_count: total,
      showing_count: Math.min(items.length, topN),
    },
    visible_items: visibleItems,
  }

  if (problematicItems && problematicItems.length > 0) {
    result.problematic_items = problematicItems
  }
  if (interpretations && interpretations.length > 0) {
    result.interpretations = interpretations
  }

  return result
}
