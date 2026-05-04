// Pure helpers extracted from Dashboard.tsx. Stateless and self
// contained — kept in this file so the main page does not have 50
// lines of utility prelude before the component body.

/**
 * unwrapOuterMarkdownFence — if the streamed answer is wrapped in a
 * ``` fence (LLMs sometimes do this for the entire response), strip
 * the outer fence so ReactMarkdown renders normally.
 */
export function unwrapOuterMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/i)
  return match ? match[1] : text
}

/**
 * makeStreamingMarkdownRenderFriendly — close any half-open markdown
 * tokens (``` / ** / `) so a partial-streamed message still renders
 * correctly mid-stream. Mirrors what GitHub Copilot's preview UI does.
 */
export function makeStreamingMarkdownRenderFriendly(markdown: string): string {
  if (!markdown) return markdown

  const lines = markdown.split('\n')
  let inFence = false
  let doubleAsteriskCount = 0
  let backtickCount = 0

  for (const line of lines) {
    const trimmedStart = line.trimStart()
    if (trimmedStart.startsWith('```')) {
      inFence = !inFence
      continue
    }

    if (inFence) continue

    let idx = 0
    for (;;) {
      const next = line.indexOf('**', idx)
      if (next === -1) break
      doubleAsteriskCount += 1
      idx = next + 2
    }

    for (let i = 0; i < line.length; i++) {
      if (line[i] === '`') backtickCount += 1
    }
  }

  let out = markdown
  if (inFence) out += '\n```'
  if (doubleAsteriskCount % 2 === 1) out += '**'
  if (backtickCount % 2 === 1) out += '`'
  if (out.endsWith('*') && !out.endsWith('**')) out += '*'
  return out
}

/**
 * parseReady — turn a "1/3" style ready string into structured counts.
 * Returns null for inputs that don't match the expected pattern.
 */
export function parseReady(ready: unknown): { ready: number; total: number } | null {
  if (typeof ready !== 'string') return null
  const match = ready.match(/^(\d+)\/(\d+)$/)
  if (!match) return null
  const readyCount = Number(match[1])
  const totalCount = Number(match[2])
  if (!Number.isFinite(readyCount) || !Number.isFinite(totalCount)) return null
  return { ready: readyCount, total: totalCount }
}

/**
 * formatAge — short human-readable elapsed duration ("3h ago").
 * Caller passes (now - then) in milliseconds.
 */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return `${seconds}s ago`
}
