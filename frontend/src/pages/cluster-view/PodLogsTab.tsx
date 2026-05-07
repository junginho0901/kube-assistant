// Pod 상세 모달의 Logs 탭. ClusterView.tsx 에서 추출 (Phase 3.1.c).
//
// WebSocket 으로 logs streaming + container/tailLines dropdown + 다운로드 기능.
// 모든 logs 관련 state/ref/effect/handler 자체 소유 — 부모는 selectedContainer
// (Summary 의 container 검색과 공유라 부모 유지) + container 검색 query 만
// 전달. unmount 시 WebSocket cleanup 자동.

import { useEffect, useRef, useState } from 'react'
import { Search, X, ChevronDown, CheckCircle, Download } from 'lucide-react'
import { api } from '@/services/api'
import { handleUnauthorized } from '@/services/auth'

interface PodLike {
  name: string
  namespace: string
  containers: Array<{ name: string }>
}

interface Props {
  pod: PodLike
  selectedContainer: string
  onSelectContainer: (name: string) => void
  containerSearchQuery: string
  onContainerSearchChange: (q: string) => void
  tr: (key: string, fallback: string, options?: Record<string, any>) => string
}

export function PodLogsTab({
  pod,
  selectedContainer,
  onSelectContainer,
  containerSearchQuery,
  onContainerSearchChange,
  tr,
}: Props) {
  const [logs, setLogs] = useState<string>('')
  const [isStreamingLogs, setIsStreamingLogs] = useState(false)
  const [isContainerDropdownOpen, setIsContainerDropdownOpen] = useState(false)
  const [isTailLinesDropdownOpen, setIsTailLinesDropdownOpen] = useState(false)
  const [downloadTailLines, setDownloadTailLines] = useState<number>(1000)
  const [isDownloading, setIsDownloading] = useState(false)

  const logsEndRef = useRef<HTMLDivElement>(null)
  const containerDropdownRef = useRef<HTMLDivElement>(null)
  const tailLinesDropdownRef = useRef<HTMLDivElement>(null)

  // 로그 스트리밍 (WebSocket).
  //
  // ArgoCD 의 pod-logs-viewer 는 rxjs 의 retryWhen(delay(500)) 으로 끊기면
  // 자동 재연결. 우리는 native WebSocket 이라 같은 동작을 직접 구현.
  //
  // 모든 effect-life 상태 (cancelled, currentWs, retryTimer, attempt) 를
  // closure-local 로 둠 — useRef 로 두면 이전 effect 의 retry callback 이
  // 새 effect 의 ref 를 덮어쓰며 race 가 발생해서, "한 번 No logs available
  // 뜨면 다른 pod 도 다 No logs" 같은 stuck 상태가 생겼었음.
  useEffect(() => {
    if (!selectedContainer) {
      setLogs('')
      setIsStreamingLogs(false)
      return
    }

    setIsStreamingLogs(true)
    setLogs('')

    let cancelled = false
    let currentWs: WebSocket | null = null
    let retryTimer: number | null = null
    let attempt = 0

    const detachAndClose = (ws: WebSocket | null) => {
      if (!ws) return
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch (e) {
        console.error('Error closing WebSocket:', e)
      }
    }

    const scheduleRetry = () => {
      if (cancelled) return
      if (retryTimer != null) return
      // exponential backoff: 500ms → 1s → 2s → 5s (max).
      const delay = Math.min(500 * Math.pow(2, attempt), 5000)
      attempt += 1
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        if (cancelled) return
        connect()
      }, delay)
    }

    const connect = () => {
      if (cancelled) return
      try {
        detachAndClose(currentWs)
        currentWs = null

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const rawWsBase = (import.meta.env.VITE_WS_URL || '').trim()
        let wsBase = rawWsBase
        if (wsBase && wsBase.startsWith('http')) {
          wsBase = wsBase.replace(/^http/, 'ws')
        }
        if (!wsBase) {
          wsBase = `${protocol}//${window.location.host}`
        }
        wsBase = wsBase.replace(/\/$/, '')
        const wsUrl = `${wsBase}/api/v1/cluster/namespaces/${pod.namespace}/pods/${pod.name}/logs/ws?container=${selectedContainer}&tail_lines=100`

        const ws = new WebSocket(wsUrl)
        currentWs = ws
        setIsStreamingLogs(true)

        ws.onopen = () => {
          if (cancelled) return
          // 연결 성공 — backoff 리셋해서 다음 끊김 시 다시 빠르게 재시도.
          attempt = 0
        }

        ws.onmessage = (event) => {
          if (cancelled) return
          if (typeof event.data === 'string') {
            setLogs((prev) => prev + event.data)
          } else {
            const reader = new FileReader()
            reader.onload = () => {
              if (cancelled) return
              const text = reader.result as string
              setLogs((prev) => prev + text)
            }
            reader.readAsText(event.data)
          }
        }

        ws.onerror = (error) => {
          // onerror 는 onclose 가 따라오므로 retry 결정은 거기서. logs 에는
          // 끼워 넣지 않음 (정상 로그와 섞임).
          console.warn('Pod logs WS error:', error)
        }

        ws.onclose = (event) => {
          if (cancelled) return
          if (event.code === 1008) {
            handleUnauthorized()
            return
          }
          // 끊겼지만 effect 가 살아있다 → 재연결 시도.
          scheduleRetry()
        }
      } catch (error: any) {
        console.error('Error creating WebSocket:', error)
        scheduleRetry()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer != null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
      detachAndClose(currentWs)
      currentWs = null
      setIsStreamingLogs(false)
    }
  }, [pod, selectedContainer, tr])

  // 자동 스크롤
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
  }, [logs])

  // 컨테이너 드롭다운 외부 클릭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerDropdownRef.current &&
        !containerDropdownRef.current.contains(event.target as Node)
      ) {
        setIsContainerDropdownOpen(false)
      }
    }
    if (isContainerDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isContainerDropdownOpen])

  // 줄 수 드롭다운 외부 클릭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tailLinesDropdownRef.current &&
        !tailLinesDropdownRef.current.contains(event.target as Node)
      ) {
        setIsTailLinesDropdownOpen(false)
      }
    }
    if (isTailLinesDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isTailLinesDropdownOpen])

  const handleDownloadLogs = async () => {
    if (!selectedContainer) return
    setIsDownloading(true)
    try {
      const downloadedLogs = await api.getPodLogs(
        pod.namespace,
        pod.name,
        selectedContainer,
        downloadTailLines,
      )
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      const seconds = String(now.getSeconds()).padStart(2, '0')
      const dateTime = `${year}${month}${day}-${hours}${minutes}${seconds}`

      const blob = new Blob([downloadedLogs], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${pod.name}-${selectedContainer}-logs-${dateTime}.txt`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Log download failed:', error)
      alert(tr('clusterView.logs.downloadError', 'Failed to download logs.'))
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 컨테이너 선택 및 다운로드 - 고정 */}
      <div className="flex items-end gap-4 pb-4 flex-shrink-0 border-b border-slate-700">
        {/* 컨테이너 선택 - 커스텀 드롭다운 */}
        <div className="flex-1 relative" ref={containerDropdownRef}>
          <label className="text-sm text-slate-400 mb-2 block">
            {tr('clusterView.logs.containerLabel', 'Container')}
          </label>
          <button
            onClick={() => setIsContainerDropdownOpen(!isContainerDropdownOpen)}
            className="w-full h-10 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-primary-500 transition-colors flex items-center gap-2 justify-between"
          >
            <span className="text-sm font-medium">
              {selectedContainer || tr('clusterView.logs.selectContainer', 'Select container')}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                isContainerDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isContainerDropdownOpen && (
            <div className="absolute top-full left-0 mt-2 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50 max-h-[300px] overflow-y-auto">
              {/* 컨테이너 드롭다운 검색창 */}
              <div className="p-2 border-b border-slate-600 sticky top-0 bg-slate-700">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder={tr('clusterView.logs.containerSearchPlaceholder', 'Search containers...')}
                    value={containerSearchQuery}
                    onChange={(e) => onContainerSearchChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-8 pl-8 pr-8 bg-slate-600 text-white rounded text-sm border border-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                  />
                  {containerSearchQuery && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onContainerSearchChange('')
                      }}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 p-0.5 hover:bg-slate-500 rounded transition-colors"
                    >
                      <X className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                </div>
              </div>
              {pod.containers &&
              pod.containers.filter((container) => {
                if (!containerSearchQuery.trim()) return true
                const query = containerSearchQuery.toLowerCase()
                return container.name.toLowerCase().includes(query)
              }).length > 0 ? (
                pod.containers
                  .filter((container) => {
                    if (!containerSearchQuery.trim()) return true
                    const query = containerSearchQuery.toLowerCase()
                    return container.name.toLowerCase().includes(query)
                  })
                  .map((container) => (
                    <button
                      key={container.name}
                      onClick={() => {
                        onSelectContainer(container.name)
                        setIsContainerDropdownOpen(false)
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-slate-600 transition-colors flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
                    >
                      {selectedContainer === container.name && (
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                      )}
                      <span className={selectedContainer === container.name ? 'font-medium' : ''}>
                        {container.name}
                      </span>
                    </button>
                  ))
              ) : (
                <div className="p-4 text-center text-sm text-slate-400">
                  {containerSearchQuery
                    ? tr('clusterView.logs.noSearchResults', 'No results found')
                    : tr('clusterView.logs.noContainers', 'No containers')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 다운로드 줄 수 선택 - 커스텀 드롭다운 */}
        <div className="relative" ref={tailLinesDropdownRef}>
          <label className="text-sm text-slate-400 mb-2 block">
            {tr('clusterView.logs.downloadLines', 'Log download lines')}
          </label>
          <button
            onClick={() => setIsTailLinesDropdownOpen(!isTailLinesDropdownOpen)}
            className="h-10 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-primary-500 transition-colors flex items-center gap-2 justify-between min-w-[150px]"
          >
            <span className="text-sm font-medium">
              {tr('clusterView.logs.linesCount', '{{count}} lines', { count: downloadTailLines })}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                isTailLinesDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isTailLinesDropdownOpen && (
            <div className="absolute top-full left-0 mt-2 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50">
              {[100, 500, 1000, 5000, 10000].map((lines) => (
                <button
                  key={lines}
                  onClick={() => {
                    setDownloadTailLines(lines)
                    setIsTailLinesDropdownOpen(false)
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-slate-600 transition-colors flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
                >
                  {downloadTailLines === lines && (
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  )}
                  <span className={downloadTailLines === lines ? 'font-medium' : ''}>
                    {tr('clusterView.logs.linesCount', '{{count}} lines', { count: lines })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 다운로드 버튼 */}
        <div>
          <label className="text-sm text-slate-400 mb-2 block invisible">
            {tr('clusterView.logs.download', 'Download')}
          </label>
          <button
            onClick={handleDownloadLogs}
            disabled={isDownloading}
            className="h-10 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg border border-primary-500 focus:outline-none focus:border-primary-400 transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {isDownloading
              ? tr('clusterView.logs.downloading', 'Downloading...')
              : tr('clusterView.logs.download', 'Download')}
          </button>
        </div>
      </div>

      {/* 로그 - 스크롤 가능 */}
      <div className="flex-1 bg-slate-900 rounded-lg p-4 mt-4 font-mono text-sm text-slate-300 overflow-x-auto overflow-y-auto">
        <pre className="whitespace-pre-wrap break-words">
          {logs
            ? logs
            : isStreamingLogs
              ? tr('clusterView.logs.loading', 'Loading logs...')
              : tr('clusterView.logs.empty', 'No logs available.')}
        </pre>
        <div ref={logsEndRef} />
      </div>
    </div>
  )
}
