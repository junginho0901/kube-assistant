import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/services/api'
import type { PodInfo } from '@/services/api'
import { getAuthHeaders, handleUnauthorized } from '@/services/auth'
import { useKubeWatchList } from '@/services/useKubeWatchList'
import { useAIContext } from '@/hooks/useAIContext'
import { usePermission } from '@/hooks/usePermission'
import { ModalOverlay } from '@/components/ModalOverlay'
import PodExecTerminal from '@/components/PodExecTerminal'
import { PodContextMenu } from './cluster-view/PodContextMenu'
import { PodDeleteModal } from './cluster-view/PodDeleteModal'
import { PodSummaryTab } from './cluster-view/PodSummaryTab'
import { PodDescribeTab } from './cluster-view/PodDescribeTab'
import { PodLogsTab } from './cluster-view/PodLogsTab'
import { PodRbacTab } from './cluster-view/PodRbacTab'
import { getPodHealth, getHealthIcon } from './cluster-view/podHealth'
import { 
  Server, 
  Box,
  CheckCircle,
  RefreshCw,
  Loader2,
  X,
  FileCode,
  Terminal,
  ChevronDown,
  Search,
  Shield
} from 'lucide-react'

interface PodDetail {
  name: string
  namespace: string
  node: string
  status: string
  phase: string
  restart_count: number
  created_at: string
  containers: Array<{
    name: string
    image: string
    ready: boolean
    state: {
      waiting?: { reason?: string | null; message?: string | null }
      terminated?: { reason?: string | null; message?: string | null; exit_code?: number | null }
      running?: { started_at?: string | null }
    } | null
    restart_count: number
  }>
}

export default function ClusterView() {
  const { t, i18n } = useTranslation()
  const tr = (key: string, fallback: string, options?: Record<string, any>) => t(key, { defaultValue: fallback, ...options })
  const locale = i18n.language === 'ko' ? 'ko-KR' : 'en-US'
  const na = tr('common.notAvailable', 'N/A')
  const emptyValue = tr('common.empty', '-')
  const { has } = usePermission()
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all')
  const [selectedPod, setSelectedPod] = useState<PodDetail | null>(null)
  const [selectedContainer, setSelectedContainer] = useState<string>('')
  const [showLogs, setShowLogs] = useState(false)
  const [showManifest, setShowManifest] = useState(false)
  const [showDescribe, setShowDescribe] = useState(false)
  const [showRbac, setShowRbac] = useState(false)
  const [showExec, setShowExec] = useState(false)
  const [execContainer, setExecContainer] = useState<string>('')
  const [execCommand, setExecCommand] = useState<string>('/bin/sh')
  const [isExecContainerDropdownOpen, setIsExecContainerDropdownOpen] = useState(false)
  const [isExecShellDropdownOpen, setIsExecShellDropdownOpen] = useState(false)
  const execContainerDropdownRef = useRef<HTMLDivElement>(null)
  const execShellDropdownRef = useRef<HTMLDivElement>(null)
  const [isNamespaceDropdownOpen, setIsNamespaceDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [containerSearchQuery, setContainerSearchQuery] = useState<string>('')
  const [podContextMenu, setPodContextMenu] = useState<{ x: number; y: number; pod: PodInfo } | null>(null)
  const [deleteTargetPod, setDeleteTargetPod] = useState<PodInfo | null>(null)
  const [deleteForce, setDeleteForce] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeletingPod, setIsDeletingPod] = useState(false)
  const [deletingPods, setDeletingPods] = useState<Set<string>>(new Set())
  const namespaceDropdownRef = useRef<HTMLDivElement>(null)



  // ESC 키로 모달/메뉴 닫기
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (podContextMenu) setPodContextMenu(null)
      if (deleteTargetPod) closeDeleteModal()
      if (selectedPod) setSelectedPod(null)
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [selectedPod, podContextMenu, deleteTargetPod])

  useEffect(() => {
    if (!podContextMenu) return
    const handleClose = () => setPodContextMenu(null)
    window.addEventListener('resize', handleClose)
    window.addEventListener('scroll', handleClose, true)
    return () => {
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('scroll', handleClose, true)
    }
  }, [podContextMenu])

  // 네임스페이스 목록
  const { data: namespaces } = useQuery({
    queryKey: ['namespaces'],
    queryFn: () => api.getNamespaces(),
  })

  // 전체 Pod 조회
  const { data: allPods, isLoading } = useQuery({
    queryKey: ['all-pods', selectedNamespace],
    queryFn: async () => {
      const forceRefresh = true // Pod 조회는 항상 강제 갱신
      if (selectedNamespace === 'all') {
        const pods = await Promise.all(
          (namespaces || []).map(ns => api.getPods(ns.name, undefined, forceRefresh))
        )
        return pods.flat()
      } else {
        return await api.getPods(selectedNamespace, undefined, forceRefresh)
      }
    },
    enabled: !!namespaces,
  })

  useKubeWatchList({
    enabled: !!namespaces,
    queryKey: ['all-pods', selectedNamespace],
    path:
      selectedNamespace === 'all'
        ? '/api/v1/pods'
        : `/api/v1/namespaces/${selectedNamespace}/pods`,
    query: 'watch=1',
  })

  // 노드 목록 (정렬용)
  const { data: nodes } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.getNodes(false),
  })

  // 플로팅 AI 위젯용 스냅샷
  const aiSnapshot = useMemo(() => {
    if (!Array.isArray(nodes) || !Array.isArray(allPods)) return null
    const totalNodes = nodes.length
    const totalPods = allPods.length
    const nodeReady = (nodes as Array<{ status: string }>).filter((n) =>
      /ready/i.test(n.status),
    ).length
    const notRunning = (allPods as PodInfo[]).filter((p) => {
      const ph = p.phase || p.status || ''
      return ph !== 'Running' && ph !== 'Succeeded'
    }).length
    const prefix = notRunning > 0 ? '⚠️ ' : ''
    const podsByNode: Record<string, number> = {}
    for (const p of allPods as PodInfo[]) {
      const n = p.node_name || 'unscheduled'
      podsByNode[n] = (podsByNode[n] ?? 0) + 1
    }
    return {
      source: 'base' as const,
      summary: `${prefix}클러스터 뷰 · 노드 ${totalNodes}개 (Ready ${nodeReady}), Pod ${totalPods}개${notRunning ? ` (NotRunning ${notRunning})` : ''}`,
      data: {
        filters: { namespace: selectedNamespace },
        stats: {
          total_nodes: totalNodes,
          ready_nodes: nodeReady,
          total_pods: totalPods,
          not_running_pods: notRunning,
        },
        pods_by_node: Object.fromEntries(
          Object.entries(podsByNode).sort((a, b) => b[1] - a[1]).slice(0, 20),
        ),
      },
    }
  }, [nodes, allPods, selectedNamespace])

  useAIContext(aiSnapshot, [aiSnapshot])

  // 네임스페이스 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        namespaceDropdownRef.current &&
        !namespaceDropdownRef.current.contains(event.target as Node)
      ) {
        setIsNamespaceDropdownOpen(false)
      }
    }

    if (isNamespaceDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isNamespaceDropdownOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (execContainerDropdownRef.current && !execContainerDropdownRef.current.contains(event.target as Node)) {
        setIsExecContainerDropdownOpen(false)
      }
      if (execShellDropdownRef.current && !execShellDropdownRef.current.contains(event.target as Node)) {
        setIsExecShellDropdownOpen(false)
      }
    }
    if (isExecContainerDropdownOpen || isExecShellDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExecContainerDropdownOpen, isExecShellDropdownOpen])

  // Pod YAML 조회
  const { data: manifest } = useQuery({
    queryKey: ['pod-yaml', selectedPod?.namespace, selectedPod?.name],
    queryFn: async () => {
      if (!selectedPod) return ''
      const response = await fetch(
        `/api/v1/cluster/namespaces/${selectedPod.namespace}/pods/${selectedPod.name}/yaml`,
        { headers: { ...getAuthHeaders() } }
      )
      if (response.status === 401) {
        handleUnauthorized()
        throw new Error('Unauthorized')
      }
      const data = await response.json()
      return data.yaml
    },
    enabled: showManifest && !!selectedPod,
  })

  // Describe 조회
  const { data: describeData } = useQuery({
    queryKey: ['pod-describe', selectedPod?.namespace, selectedPod?.name],
    queryFn: async () => {
      if (!selectedPod) return null
      return await api.describePod(selectedPod.namespace, selectedPod.name)
    },
    enabled: showDescribe && !!selectedPod,
  })

  // 검색어로 Pod 필터링
  const filteredPods = allPods?.filter(pod => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return pod.name.toLowerCase().includes(query) || 
           pod.namespace.toLowerCase().includes(query)
  }) || []

  // 노드별로 Pod 그룹화 (필터링된 Pod 기준)
  const podsByNode = filteredPods.reduce((acc, pod) => {
    const nodeName = pod.node_name || 'Unscheduled'
    if (!acc[nodeName]) acc[nodeName] = []
    acc[nodeName].push(pod)
    return acc
  }, {} as Record<string, any[]>)

  // 노드 정렬: control-plane 먼저, 그 다음 워커 노드, 각 그룹 내에서는 이름 순
  const sortedNodeEntries = Object.entries(podsByNode).sort(([nodeA], [nodeB]) => {
    // 노드 정보 찾기
    const nodeInfoA = nodes?.find((n: any) => n.name === nodeA)
    const nodeInfoB = nodes?.find((n: any) => n.name === nodeB)
    
    // Unscheduled는 맨 뒤로
    if (nodeA === 'Unscheduled') return 1
    if (nodeB === 'Unscheduled') return -1
    
    // control-plane 역할 확인
    const isControlPlaneA = nodeInfoA?.roles?.includes('control-plane') || false
    const isControlPlaneB = nodeInfoB?.roles?.includes('control-plane') || false
    
    // control-plane이 먼저
    if (isControlPlaneA && !isControlPlaneB) return -1
    if (!isControlPlaneA && isControlPlaneB) return 1
    
    // 같은 그룹 내에서는 이름 순으로 정렬
    return nodeA.localeCompare(nodeB)
  })

  const isAdmin = has('resource.pod.create')
  const canDeletePod = has('resource.pod.delete')

  const handlePodClick = (pod: any) => {
    // 즉시 모달을 열고 describe 데이터는 useQuery로 비동기 로딩
    setShowLogs(false)
    setShowManifest(false)
    setShowDescribe(false)
    setShowRbac(false)
    setContainerSearchQuery('')
    // 기본 정보로 바로 모달 오픈 (describe는 useQuery로 자동 로딩)
    const containers = pod.containers || []
    const detail: PodDetail = {
      name: pod.name,
      namespace: pod.namespace,
      node: pod.node_name || '',
      status: pod.status || '',
      phase: pod.phase || pod.status || '',
      restart_count: pod.restart_count || 0,
      created_at: pod.created_at || '',
      containers,
    }
    setSelectedPod(detail)

    // 메인 컨테이너 자동 선택
    const podBaseName = pod.name.replace(/-[a-z0-9]{5,10}-[a-z0-9]{5}$/i, '').replace(/-[0-9]+$/i, '')
    let mainContainer = containers.find((c: any) => c.name === podBaseName)
    if (!mainContainer) {
      const sidecarPatterns = ['istio-proxy', 'istio-init', 'envoy', 'linkerd-proxy', 'vault-agent']
      mainContainer = containers.find(
        (c: any) => !sidecarPatterns.some((pattern: string) => c.name.includes(pattern))
      )
    }
    setSelectedContainer(mainContainer?.name || containers[0]?.name || '')

    // 기본값을 Logs 탭으로 설정
    setShowLogs(true)
    setShowManifest(false)
    setShowDescribe(false)
    setShowRbac(false)
    setShowExec(false)
  }

  const handlePodContextMenu = (event: React.MouseEvent, pod: PodInfo) => {
    if (!canDeletePod) return
    event.preventDefault()
    setPodContextMenu({ x: event.clientX, y: event.clientY, pod })
  }

  const handleClosePodContextMenu = () => {
    setPodContextMenu(null)
  }

  const openDeleteModal = (pod: PodInfo) => {
    setDeleteTargetPod(pod)
    setDeleteForce(false)
    setDeleteError(null)
  }

  const closeDeleteModal = () => {
    setDeleteTargetPod(null)
    setDeleteForce(false)
    setDeleteError(null)
    setIsDeletingPod(false)
  }

  const handleDeletePod = async () => {
    if (!deleteTargetPod || isDeletingPod) return
    setIsDeletingPod(true)
    setDeleteError(null)
    const target = deleteTargetPod
    const podKey = `${target.namespace}/${target.name}`
    setDeletingPods(prev => new Set(prev).add(podKey))
    try {
      await api.deletePod(target.namespace, target.name, deleteForce)
      if (selectedPod?.name === target.name && selectedPod?.namespace === target.namespace) {
        setSelectedPod(null)
      }
      closeDeleteModal()
    } catch (error: any) {
      setDeletingPods(prev => {
        const next = new Set(prev)
        next.delete(podKey)
        return next
      })
      setDeleteError(error?.response?.data?.detail || error?.message || '삭제에 실패했습니다.')
    } finally {
      setIsDeletingPod(false)
    }
  }

  useEffect(() => {
    if (!allPods) return
    setDeletingPods(prev => {
      const remaining = new Set<string>()
      const keys = new Set(allPods.map(pod => `${pod.namespace}/${pod.name}`))
      for (const key of prev) {
        if (keys.has(key)) remaining.add(key)
      }
      return remaining
    })
  }, [allPods])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{tr('clusterView.title', 'Cluster view')}</h1>
          <p className="mt-2 text-slate-400">
            {tr('clusterView.subtitle', 'Review pod placement across nodes')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* 파드 이름 검색 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={tr('clusterView.searchPlaceholder', 'Search pod name...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 pl-10 pr-4 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-primary-500 transition-colors w-64"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-slate-600 rounded transition-colors"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            )}
          </div>
          {/* 네임스페이스 선택 - 커스텀 드롭다운 */}
          <div className="relative" ref={namespaceDropdownRef}>
            <button
              onClick={() => setIsNamespaceDropdownOpen(!isNamespaceDropdownOpen)}
              className="h-10 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-primary-500 transition-colors flex items-center gap-2 min-w-[200px] justify-between"
            >
              <span className="text-sm font-medium">
                {selectedNamespace === 'all'
                  ? tr('clusterView.allNamespaces', 'All namespaces')
                  : selectedNamespace}
              </span>
              <ChevronDown 
                className={`w-4 h-4 text-slate-400 transition-transform ${
                  isNamespaceDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            
            {isNamespaceDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50 max-h-[400px] overflow-y-auto">
                <button
                  onClick={() => {
                    setSelectedNamespace('all')
                    setIsNamespaceDropdownOpen(false)
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-slate-600 transition-colors flex items-center gap-2 first:rounded-t-lg"
                >
                  {selectedNamespace === 'all' && (
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  )}
                  <span className={selectedNamespace === 'all' ? 'font-medium' : ''}>
                    {tr('clusterView.allNamespaces', 'All namespaces')}
                  </span>
                </button>
                {Array.isArray(namespaces) && namespaces.map((ns) => (
                  <button
                    key={ns.name}
                    onClick={() => {
                      setSelectedNamespace(ns.name)
                      setIsNamespaceDropdownOpen(false)
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-slate-600 transition-colors flex items-center gap-2 last:rounded-b-lg"
                  >
                    {selectedNamespace === ns.name && (
                      <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    )}
                    <span className={selectedNamespace === ns.name ? 'font-medium' : ''}>
                      {ns.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 새로고침 버튼 숨김 (watch 기반 실시간 갱신) */}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px]">
          <RefreshCw className="w-8 h-8 text-primary-400 animate-spin mb-4" />
          <p className="text-slate-400">{tr('clusterView.loading', 'Loading data...')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 검색 결과 정보 */}
          {searchQuery && (
            <div className="text-sm text-slate-400">
              {tr('clusterView.searchResults', 'Results')}:{' '}
              <span className="text-white font-medium">{filteredPods.length}</span>{' '}
              {tr('clusterView.countSuffix', 'items')}
              {filteredPods.length !== (allPods?.length || 0) && (
                <span className="ml-2">
                  {tr('clusterView.searchResultsTotal', '(out of {{count}})', { count: allPods?.length || 0 })}
                </span>
              )}
            </div>
          )}
          
          {/* 검색 결과가 없을 때 */}
          {searchQuery && filteredPods.length === 0 && (
            <div className="card text-center py-12">
              <Search className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">
                {tr('clusterView.noSearchResults', 'No pods found for "{{query}}"', { query: searchQuery })}
              </p>
            </div>
          )}

          {/* 노드별 Pod 표시 */}
          {sortedNodeEntries.length > 0 ? (
            sortedNodeEntries.map(([nodeName, pods]) => (
            <div key={nodeName} className="card">
              <div className="flex items-center gap-3 mb-4">
                <Server className="w-6 h-6 text-cyan-400" />
                <h2 className="text-xl font-bold text-white">{nodeName}</h2>
                <span className="badge badge-secondary">
                  {tr('clusterView.nodePodsCount', '{{count}} Pods', { count: pods.length })}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {pods.map((pod, idx) => {
                  const podKey = `${pod.namespace}/${pod.name}`
                  const isDeleting = deletingPods.has(podKey)
                  const health = getPodHealth(pod)
                  return (
                    <button
                      key={`${pod.namespace}-${pod.name}-${idx}`}
                      onClick={() => handlePodClick(pod)}
                      onContextMenu={(event) => {
                        if (!isDeleting) handlePodContextMenu(event, pod)
                      }}
                      disabled={isDeleting}
                      className={`p-3 bg-slate-700 rounded-lg transition-colors text-left ${
                        isDeleting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-600'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <Box className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        {isDeleting ? (
                          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                        ) : (
                          getHealthIcon(health.level, health.reason)
                        )}
                      </div>
                      <div className="text-sm font-medium text-white truncate" title={pod.name}>
                        {pod.name}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{pod.namespace}</div>
                      <div className={`text-xs mt-1 min-h-[16px] ${isDeleting ? 'text-amber-400' : 'text-slate-300'}`}>
                        {isDeleting ? tr('clusterView.podDeleting', 'Deleting...') : health.reason}
                      </div>
                      <div className="text-xs text-yellow-400 mt-1 min-h-[16px]">
                        {pod.restart_count > 0 &&
                          tr('clusterView.restarts', 'Restarts: {{count}}', { count: pod.restart_count })}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
            ))
          ) : (
            !searchQuery && !isLoading && allPods !== undefined && (
              <div className="card text-center py-12">
                <Box className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">{tr('clusterView.noPods', 'No pods found')}</p>
              </div>
            )
          )}
        </div>
      )}

      {/* Pod 우클릭 컨텍스트 메뉴 */}
      <PodContextMenu
        menu={podContextMenu}
        isAdmin={isAdmin}
        onClose={handleClosePodContextMenu}
        onExec={(pod) => {
          const detail: PodDetail = {
            name: pod.name,
            namespace: pod.namespace,
            node: pod.node_name || '',
            status: pod.status || '',
            phase: pod.phase || '',
            restart_count: pod.restart_count || 0,
            created_at: pod.created_at || '',
            containers: pod.containers || [],
          }
          setSelectedPod(detail)
          setExecContainer(detail.containers?.[0]?.name || '')
          setShowLogs(false)
          setShowManifest(false)
          setShowDescribe(false)
          setShowRbac(false)
          setShowExec(true)
        }}
        onDelete={openDeleteModal}
      />

      {/* Pod 상세 정보 모달 */}
      {selectedPod && (
        <ModalOverlay onClose={() => setSelectedPod(null)}>
          <div
            className="bg-slate-800 rounded-lg max-w-6xl w-full h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Box className="w-6 h-6 text-primary-400" />
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedPod.name}</h2>
                  <p className="text-sm text-slate-400">{selectedPod.namespace}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPod(null)}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* 탭 */}
            <div className="flex gap-2 px-6 pt-4 border-b border-slate-700">
              <button
                onClick={() => {
                  setShowLogs(false)
                  setShowManifest(false)
                  setShowDescribe(false)
                  setShowRbac(false)
                  setShowExec(false)
                }}
                className={`px-4 py-2 font-medium transition-colors ${
                  !showLogs && !showManifest && !showDescribe && !showRbac && !showExec
                    ? 'text-primary-400 border-b-2 border-primary-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tr('clusterView.tabs.summary', 'Summary')}
              </button>
              <button
                onClick={() => {
                  // 메인 컨테이너 찾기
                  // 1. Pod 이름에서 해시값 제거
                  const podBaseName = selectedPod.name?.replace(/-[a-z0-9]{5,10}-[a-z0-9]{5}$/i, '').replace(/-[0-9]+$/i, '')
                  
                  // 2. Pod 베이스 이름과 일치하는 컨테이너 찾기
                  let mainContainer = selectedPod.containers?.find((c: any) => c.name === podBaseName)
                  
                  // 3. 못 찾으면 사이드카 패턴 제외하고 찾기
                  if (!mainContainer) {
                    const sidecarPatterns = ['istio-proxy', 'istio-init', 'envoy', 'linkerd-proxy', 'vault-agent']
                    mainContainer = selectedPod.containers?.find(
                      (c: any) => !sidecarPatterns.some(pattern => c.name.includes(pattern))
                    )
                  }
                  
                  // 메인 컨테이너로 전환
                  if (mainContainer) {
                    setSelectedContainer(mainContainer.name)
                  }
                  
                  setShowLogs(true)
                  setShowManifest(false)
                  setShowDescribe(false)
                  setShowRbac(false)
                  setShowExec(false)
                }}
                className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
                  showLogs
                    ? 'text-primary-400 border-b-2 border-primary-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Terminal className="w-4 h-4" />
                {tr('clusterView.tabs.logs', 'Logs')}
              </button>
              <button
                onClick={() => {
                  setShowLogs(false)
                  setShowManifest(false)
                  setShowDescribe(true)
                  setShowRbac(false)
                  setShowExec(false)
                }}
                className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
                  showDescribe
                    ? 'text-primary-400 border-b-2 border-primary-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileCode className="w-4 h-4" />
                {tr('clusterView.tabs.describe', 'Describe')}
              </button>
              <button
                onClick={() => {
                  setShowLogs(false)
                  setShowManifest(false)
                  setShowDescribe(false)
                  setShowRbac(true)
                  setShowExec(false)
                }}
                className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
                  showRbac
                    ? 'text-primary-400 border-b-2 border-primary-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Shield className="w-4 h-4" />
                {tr('clusterView.tabs.rbac', 'RBAC')}
              </button>
              <button
                onClick={() => {
                  setShowLogs(false)
                  setShowManifest(true)
                  setShowDescribe(false)
                  setShowRbac(false)
                  setShowExec(false)
                }}
                className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
                  showManifest
                    ? 'text-primary-400 border-b-2 border-primary-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileCode className="w-4 h-4" />
                {tr('clusterView.tabs.manifest', 'Manifest')}
              </button>
              {isAdmin && (
                <button
                  onClick={() => {
                    const mainContainer = selectedPod.containers?.[0]?.name || ''
                    setExecContainer(mainContainer)
                    setShowLogs(false)
                    setShowManifest(false)
                    setShowDescribe(false)
                    setShowRbac(false)
                    setShowExec(true)
                  }}
                  className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
                    showExec
                      ? 'text-primary-400 border-b-2 border-primary-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                  {tr('clusterView.tabs.exec', 'Exec')}
                </button>
              )}
            </div>

            {/* 모달 내용 */}
            <div className={`flex-1 p-6 ${showExec ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {!showLogs && !showManifest && !showDescribe && !showRbac && !showExec && (
                <PodSummaryTab
                  pod={selectedPod}
                  containerSearchQuery={containerSearchQuery}
                  onContainerSearchChange={setContainerSearchQuery}
                  locale={locale}
                  na={na}
                  emptyValue={emptyValue}
                  tr={tr}
                />
              )}

              {showLogs && (
                <PodLogsTab
                  pod={selectedPod}
                  selectedContainer={selectedContainer}
                  onSelectContainer={setSelectedContainer}
                  containerSearchQuery={containerSearchQuery}
                  onContainerSearchChange={setContainerSearchQuery}
                  tr={tr}
                />
              )}

              {showDescribe && describeData && (
                <PodDescribeTab
                  data={describeData}
                  locale={locale}
                  na={na}
                  tr={tr}
                />
              )}

              {showRbac && selectedPod && (
                <PodRbacTab pod={selectedPod} tr={tr} />
              )}

              {showManifest && (
                <div className="h-full bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 overflow-x-auto overflow-y-auto">
                  <pre>{manifest || tr('clusterView.manifest.loading', 'Loading...')}</pre>
                </div>
              )}
              {showExec && selectedPod && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center gap-3 mb-2">
                    {/* Container 커스텀 드롭다운 */}
                    <div className="relative" ref={execContainerDropdownRef}>
                      <button
                        onClick={() => { setIsExecContainerDropdownOpen(!isExecContainerDropdownOpen); setIsExecShellDropdownOpen(false) }}
                        className="h-8 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-primary-500 transition-colors flex items-center gap-2 min-w-[160px] justify-between"
                      >
                        <span className="text-xs font-medium truncate">{execContainer || '-'}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExecContainerDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isExecContainerDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50 max-h-[200px] overflow-y-auto">
                          {selectedPod.containers?.map((c: any) => (
                            <button
                              key={c.name}
                              onClick={() => { setExecContainer(c.name); setIsExecContainerDropdownOpen(false) }}
                              className="w-full px-3 py-2 text-left text-xs text-white hover:bg-slate-600 transition-colors flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
                            >
                              {execContainer === c.name && <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                              <span className={execContainer === c.name ? 'font-medium' : ''}>{c.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Shell 커스텀 드롭다운 */}
                    <div className="relative" ref={execShellDropdownRef}>
                      <button
                        onClick={() => { setIsExecShellDropdownOpen(!isExecShellDropdownOpen); setIsExecContainerDropdownOpen(false) }}
                        className="h-8 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-primary-500 transition-colors flex items-center gap-2 min-w-[120px] justify-between"
                      >
                        <span className="text-xs font-medium">{execCommand}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExecShellDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isExecShellDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50">
                          {['/bin/sh', '/bin/bash', '/bin/ash', 'sh'].map((sh) => (
                            <button
                              key={sh}
                              onClick={() => { setExecCommand(sh); setIsExecShellDropdownOpen(false) }}
                              className="w-full px-3 py-2 text-left text-xs text-white hover:bg-slate-600 transition-colors flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
                            >
                              {execCommand === sh && <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                              <span className={execCommand === sh ? 'font-medium' : ''}>{sh}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-h-[400px] rounded-lg overflow-hidden border border-slate-700">
                    <PodExecTerminal
                      key={`${selectedPod.namespace}-${selectedPod.name}-${execContainer}-${execCommand}`}
                      podName={selectedPod.name}
                      namespace={selectedPod.namespace}
                      container={execContainer}
                      command={execCommand}
                      onClose={() => setShowExec(false)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}

      <PodDeleteModal
        pod={deleteTargetPod}
        force={deleteForce}
        error={deleteError}
        isDeleting={isDeletingPod}
        onForceChange={setDeleteForce}
        onClose={closeDeleteModal}
        onConfirm={handleDeletePod}
      />
    </div>
  )
}
