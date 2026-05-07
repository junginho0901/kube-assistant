// AI Chat 작은 utility. AIChat.tsx 에서 추출 (Phase 3.2).

/**
 * Optimistic UI 용 임시 세션 ID 판정 — `temp:` prefix.
 * 임시 세션은 useQuery 의 sessionDetail fetch 를 disabled 하고 (아직 DB 없음)
 * welcome 화면도 표시 (실제 세션이 아니므로).
 */
export const isTempSessionId = (id: string | null) =>
  typeof id === 'string' && id.startsWith('temp:')
