// AI Chat 메시지 텍스트 가공 유틸.
//
// chatStreamManager.ts 가 streaming 중 message.content 에 다음 형태로 tool 호출
// 메타정보를 박는다 (UI 에서 <details> 로 접힘):
//
//   <details><summary>🔧 toolName</summary>
//     <details><summary>📋 Arguments</summary>...</details>
//     <details><summary>📊 Results</summary>...</details>
//   </details>
//
//   여기부터 진짜 답변 markdown ...
//
// 사용자가 "Copy" 버튼을 누르면 message.content 가 그대로 clipboard 로 가서
// HTML 태그 + JSON args + tool 결과가 다 섞여 복사됨. 답변만 가져오고 싶을 때
// 이 유틸로 outer <details> block 들을 제거한다.

/**
 * `<details><summary>🔧 ...</summary>...</details>` outer block 들을 모두 제거.
 *
 * Nested `<details>` 안전 처리를 위해 depth counting 으로 outer 의 닫는 태그를
 * 정확히 매칭한다 (정규식 non-greedy 만으로는 inner 의 첫 `</details>` 에 잘못
 * 매칭됨).
 *
 * 🔧 마커가 없는 일반 `<details>` 는 건드리지 않는다 — 답변 본문에 사용자가
 * 의도적으로 넣은 details 가 있을 수 있음.
 */
export function stripToolDetails(text: string): string {
  if (!text) return text
  const OPEN = '<details>'
  const CLOSE = '</details>'

  let result = ''
  let i = 0
  while (i < text.length) {
    // outer 시작 패턴: `<details>` + (whitespace) + `<summary>🔧`
    const m = text.slice(i).match(/^<details>\s*<summary>🔧/)
    if (!m) {
      result += text[i]
      i++
      continue
    }

    // depth counting 으로 outer 닫는 위치 찾기
    let depth = 0
    let j = i
    while (j < text.length) {
      if (text.startsWith(OPEN, j)) {
        depth++
        j += OPEN.length
      } else if (text.startsWith(CLOSE, j)) {
        depth--
        j += CLOSE.length
        if (depth === 0) break
      } else {
        j++
      }
    }

    // outer 영역 (i ~ j) skip + 직후 trailing 공백·개행 skip (block 사이 \n\n
    // 가 chatStreamManager 에서 추가됨 — 답변 시작 전 공백 정리)
    i = j
    while (i < text.length && (text[i] === '\n' || text[i] === '\r' || text[i] === ' ' || text[i] === '\t')) {
      i++
    }
  }

  return result
}
