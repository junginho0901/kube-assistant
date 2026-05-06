import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, TopResources, disableMetrics, isMetricsDisabled, isMetricsUnavailableError } from '@/services/api'
import {
  Server,
  Box,
  Database,
  HardDrive,
  TrendingUp,
} from 'lucide-react'
// recharts unused for status charts – kept for potential future use
// import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Customized } from 'recharts'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrometheusQueries } from '@/hooks/usePrometheusQuery'
import { useAIContext } from '@/hooks/useAIContext'
import { useResourceDetail } from '@/components/ResourceDetailContext'
import { DashboardSkeleton } from './dashboard/DashboardSkeleton'
import { DashboardHeader } from './dashboard/DashboardHeader'
import { DashboardQuickActions } from './dashboard/DashboardQuickActions'
import { DashboardTopResources } from './dashboard/DashboardTopResources'
import { DashboardPodNodeStatus } from './dashboard/DashboardPodNodeStatus'
import { DashboardNodeList } from './dashboard/DashboardNodeList'
import { IssuesModal } from './dashboard/modals/IssuesModal'
import { OptimizationModal } from './dashboard/modals/OptimizationModal'
import { ResourceModal } from './dashboard/modals/ResourceModal'
import { StorageModal } from './dashboard/modals/StorageModal'
import type { ResourceType, IssueSeverity, IssueKind, IssueItem } from './dashboard/types'
import {
  unwrapOuterMarkdownFence,
  makeStreamingMarkdownRenderFriendly,
  parseReady,
  formatAge,
} from './dashboard/utils'


export default function Dashboard() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { open: openDetail } = useResourceDetail()
  const tr = (key: string, fallback: string, options?: Record<string, any>) => t(key, { defaultValue: fallback, ...options })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedResourceType, setSelectedResourceType] = useState<ResourceType | null>(null)
  const [modalSearchQuery, setModalSearchQuery] = useState<string>('')
  const [isIssuesModalOpen, setIsIssuesModalOpen] = useState(false)
  const [issuesSearchQuery, setIssuesSearchQuery] = useState<string>('')
  const [includeRestartHistory, setIncludeRestartHistory] = useState(false)
  const [isStorageModalOpen, setIsStorageModalOpen] = useState(false)
  const [storageActiveTab, setStorageActiveTab] = useState<'pvcs' | 'pvs' | 'topology'>('pvcs')
  const [storageSearchQuery, setStorageSearchQuery] = useState<string>('')
  const [storageNamespaceFilter, setStorageNamespaceFilter] = useState<string>('all')
  const [isStorageNamespaceDropdownOpen, setIsStorageNamespaceDropdownOpen] = useState(false)
  const [isOptimizationModalOpen, setIsOptimizationModalOpen] = useState(false)
  const [optimizationNamespace, setOptimizationNamespace] = useState<string>('default')
  const [isOptimizationNamespaceDropdownOpen, setIsOptimizationNamespaceDropdownOpen] = useState(false)
  const optimizationNamespaceDropdownRef = useRef<HTMLDivElement>(null)
  const [optimizationCopied, setOptimizationCopied] = useState(false)
  const optimizationAbortRef = useRef<AbortController | null>(null)
  const [isOptimizationStreaming, setIsOptimizationStreaming] = useState(false)
  const [optimizationObservedContent, setOptimizationObservedContent] = useState('')
  const [optimizationAnswerContent, setOptimizationAnswerContent] = useState('')
  const [optimizationStreamError, setOptimizationStreamError] = useState('')
  const optimizationStreamPendingRef = useRef('')
  const optimizationStreamRafRef = useRef<number | null>(null)
  const optimizationStreamDoneRef = useRef(false)
  // 타자기 큐
  const optimizationCharQueueRef = useRef<string[]>([])
  const optimizationTypewriterRef = useRef<number | null>(null)
  const optimizationMetaReceivedRef = useRef(false)
  const optimizationUsageReceivedRef = useRef(false)
  const [optimizationUsage, setOptimizationUsage] = useState<{
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } | null>(null)
  const [optimizationMeta, setOptimizationMeta] = useState<{
    finish_reason?: string | null
    max_tokens?: number | null
  } | null>(null)
  const [selectedPodStatus, setSelectedPodStatus] = useState<string | null>(null)
  const [selectedNodeStatus, setSelectedNodeStatus] = useState<string | null>(null)
  const [metricsUnavailable, setMetricsUnavailable] = useState(() => isMetricsDisabled())

  const { data: overview, isLoading } = useQuery({
    queryKey: ['cluster-overview'],
    queryFn: () => api.getClusterOverview(false), // 자동 갱신은 캐시 사용
    staleTime: 30000,
    refetchInterval: 60000,
  })

  // 네임스페이스 목록
  const { data: namespaces, isLoading: isLoadingNamespaces } = useQuery({
    queryKey: ['namespaces'],
    queryFn: () => api.getNamespaces(),
    enabled: selectedResourceType === 'namespaces',
  })

  // 전체 Pod 목록
  const { data: allPods, isLoading: isLoadingPods } = useQuery({
    queryKey: ['all-pods'],
    queryFn: () => api.getAllPods(false), // 자동 갱신은 캐시 사용
    enabled: selectedResourceType === 'pods' || selectedPodStatus !== null || isIssuesModalOpen,
  })

  // 전체 Services 목록 (모든 네임스페이스)
  const { data: allNamespaces, isLoading: isLoadingAllNamespaces } = useQuery({
    queryKey: ['all-namespaces'],
    queryFn: () => api.getNamespaces(),
    enabled:
      selectedResourceType === 'services' ||
      selectedResourceType === 'deployments' ||
      isIssuesModalOpen ||
      isStorageModalOpen ||
      isOptimizationModalOpen,
  })

  const { data: allServices, isLoading: isLoadingServices } = useQuery({
    queryKey: ['all-services'],
    queryFn: async () => {
      if (!allNamespaces || !Array.isArray(allNamespaces)) return []
      const services = await Promise.all(
        allNamespaces.map((ns: any) => api.getServices(ns.name))
      )
      return services.flat()
    },
    enabled: selectedResourceType === 'services' && !!allNamespaces,
  })

  // 전체 Deployments 목록
  const { data: allDeployments, isLoading: isLoadingDeployments } = useQuery({
    queryKey: ['all-deployments'],
    queryFn: async () => {
      if (!allNamespaces || !Array.isArray(allNamespaces)) return []
      const deployments = await Promise.all(
        allNamespaces.map((ns: any) => api.getDeployments(ns.name))
      )
      return deployments.flat()
    },
    enabled: (selectedResourceType === 'deployments' || isIssuesModalOpen || isStorageModalOpen) && !!allNamespaces,
  })

  // 전체 PVC 목록
  const { data: allPVCs, isLoading: isLoadingPVCs } = useQuery({
    queryKey: ['all-pvcs'],
    queryFn: () => api.getPVCs(),
    enabled: selectedResourceType === 'pvcs' || isIssuesModalOpen || isStorageModalOpen,
  })

  // 전체 PV 목록 (스토리지 분석용)
  const { data: allPVs, isLoading: isLoadingPVs } = useQuery({
    queryKey: ['all-pvs'],
    queryFn: () => api.getPVs(),
    enabled: isStorageModalOpen,
  })

  // 스토리지 토폴로지 (선택 탭에서만 로드)
  const {
    data: storageTopology,
    isLoading: isLoadingStorageTopology,
    isError: isStorageTopologyError,
    error: storageTopologyError,
  } = useQuery({
    queryKey: ['storage-topology'],
    queryFn: () => api.getStorageTopology(),
    enabled: isStorageModalOpen && storageActiveTab === 'topology',
    retry: false,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  })

  // 노드 목록 (차트 표시용 - 항상 가져오기)
  const { data: nodes } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.getNodes(false), // 자동 갱신은 캐시 사용
    staleTime: 30000,
    refetchInterval: 60000,
  })

  // Top 리소스 사용 파드/노드 (5초마다 갱신)
  const {
    data: topResources,
    isLoading: isLoadingTopResources,
    isError: isTopResourcesError,
    error: topResourcesError
  } = useQuery<TopResources>({
    queryKey: ['top-resources'],
    queryFn: async () => {
      const result = await api.getTopResources(5, 3)
      // 백엔드에서 빈 배열을 반환한 경우(일시적 실패) 이전 데이터 유지를 위해
      // 유효한 데이터가 있는지 확인
      const hasValidData = (result.top_pods && result.top_pods.length > 0) ||
                          (result.top_nodes && result.top_nodes.length > 0)
      
      if (!hasValidData) {
        // 빈 데이터면 에러를 throw하여 React Query가 이전 데이터를 유지하도록
        // placeholderData가 이전 데이터를 반환하도록 함
        throw new Error('No valid metrics data available')
      }
      
      return result
    },
    enabled: !metricsUnavailable && !isMetricsDisabled(),
    staleTime: 5000, // 5초간 fresh 상태 유지
    refetchInterval: () => {
      if (metricsUnavailable || isMetricsDisabled()) return false
      return 5000
    },
    placeholderData: (previousData) => {
      // 이전 데이터가 있고 유효한 경우에만 유지
      // 에러 발생 시에도 이전 데이터를 유지하여 깜빡임 방지
      if (previousData && (
        (previousData.top_pods && previousData.top_pods.length > 0) ||
        (previousData.top_nodes && previousData.top_nodes.length > 0)
      )) {
        return previousData
      }
      return undefined
    },
    retry: (failureCount, error) => {
      if (isMetricsUnavailableError(error)) return false
      return failureCount < 1
    },
    retryDelay: 1000,
    gcTime: 60000,
  })

  useEffect(() => {
    if (isMetricsUnavailableError(topResourcesError)) {
      disableMetrics()
      setMetricsUnavailable(true)
    }
  }, [topResourcesError])

  // 플로팅 AI 위젯용 스냅샷 — 대시보드 요약
  // (topResources / allPods 가 위에서 정의돼야 하므로 useQuery 들 뒤에 위치)
  const aiSnapshot = useMemo(() => {
    if (!overview) return null
    const podStatus = overview.pod_status || {}
    const running = podStatus['Running'] ?? 0
    const total = overview.total_pods ?? 0
    const unhealthy = total - running
    const prefix = unhealthy > 0 ? '⚠️ ' : ''
    const nodeLabel = typeof overview.node_count === 'number'
      ? `노드 ${overview.node_count}개`
      : '노드 정보 없음'
    const summary = `${prefix}클러스터 — ${nodeLabel}, Pod ${running}/${total} Running${unhealthy > 0 ? `, 문제 ${unhealthy}` : ''}`

    const interpretations: string[] = []
    for (const [phase, count] of Object.entries(podStatus)) {
      if (phase !== 'Running' && phase !== 'Succeeded' && (count as number) > 0) {
        interpretations.push(`⚠️ Pod ${count}개가 ${phase} 상태`)
      }
    }

    return {
      source: 'base' as const,
      summary,
      data: {
        cluster: {
          version: overview.cluster_version,
          node_count: overview.node_count,
          total_namespaces: overview.total_namespaces,
          total_pods: overview.total_pods,
          total_services: overview.total_services,
          total_deployments: overview.total_deployments,
          total_pvcs: overview.total_pvcs,
          total_pvs: overview.total_pvs,
        },
        pod_status: podStatus,
        nodes: Array.isArray(nodes)
          ? (nodes as Array<{ name: string; status: string }>).slice(0, 10).map((n) => ({
              name: n.name,
              status: n.status,
            }))
          : undefined,
        // 화면 우측 위젯: Top 5 Pods / Top 3 Nodes (CPU·Memory 사용량 상위)
        top_pods: Array.isArray(topResources?.top_pods)
          ? topResources!.top_pods.slice(0, 5).map((p: any) => ({
              name: p.name,
              namespace: p.namespace,
              cpu: p.cpu,
              memory: p.memory,
              cpu_percent: p.cpu_percent,
              memory_percent: p.memory_percent,
            }))
          : undefined,
        top_nodes: Array.isArray(topResources?.top_nodes)
          ? topResources!.top_nodes.slice(0, 3).map((n: any) => ({
              name: n.name,
              cpu: n.cpu,
              memory: n.memory,
              cpu_percent: n.cpu_percent,
              memory_percent: n.memory_percent,
            }))
          : undefined,
        // 문제 있는 Pod 의 이름·이유 — allPods 가 fetch 된 상태에서만 (lazy)
        failed_pods: Array.isArray(allPods)
          ? (allPods as Array<{ name: string; namespace: string; phase?: string; status?: string; restart_count?: number }>)
              .filter((p) => {
                const ph = p.phase || p.status || ''
                return ph !== 'Running' && ph !== 'Succeeded'
              })
              .slice(0, 10)
              .map((p) => ({
                name: p.name,
                namespace: p.namespace,
                phase: p.phase,
                status: p.status,
                restart_count: p.restart_count,
              }))
          : undefined,
        ...(interpretations.length > 0 ? { interpretations } : {}),
      },
    }
  }, [overview, nodes, topResources, allPods])

  useAIContext(aiSnapshot, [aiSnapshot])

  // Prometheus cluster-wide metrics
  const promCluster = usePrometheusQueries(
    ['cluster-dashboard'],
    [
      { name: 'cpu', promql: '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' },
      { name: 'memory', promql: '(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100' },
      { name: 'disk', promql: '(1 - sum(node_filesystem_avail_bytes{mountpoint="/"}) / sum(node_filesystem_size_bytes{mountpoint="/"})) * 100' },
      { name: 'pod_count', promql: 'count(kube_pod_info)' },
    ],
    { refetchInterval: 30000 },
  )
  const getClusterMetric = (n: string): number | null => {
    const resp = promCluster.data[n]
    if (!resp?.available || !resp.results?.length) return null
    return resp.results[0].value
  }

  useEffect(() => {
    if (metricsUnavailable) {
      queryClient.cancelQueries({ queryKey: ['top-resources'] })
    }
  }, [metricsUnavailable, queryClient])

  // 노드 목록 (모달용)
  const { data: modalNodes, isLoading: isLoadingNodes } = useQuery({
    queryKey: ['modal-nodes'],
    queryFn: () => api.getNodes(false), // 자동 갱신은 캐시 사용
    enabled: selectedResourceType === 'nodes',
  })


  const handleRefresh = async () => {
    console.log('🔄 새로고침 시작...')
    setIsRefreshing(true)
    // 새로고침은 항상 강제 갱신 (force_refresh=true)
    try {
      // 메인 데이터를 직접 호출하고 캐시에 수동으로 업데이트
      console.log('📡 API 호출 중 (force_refresh=true)...')

      // 먼저 네임스페이스 목록을 가져옴 (다른 API 호출에 필요)
      const namespacesData = await api.getNamespaces()

      // 나머지를 병렬로 호출 (네임스페이스별 리소스 조회 포함)
      const [overviewData, nodesData, allPodsData, allServicesData, allDeploymentsData, allPVCsData] = await Promise.all([
        api.getClusterOverview(true),
        api.getNodes(true),
        api.getAllPods(true),
        // 모든 네임스페이스의 Services 조회
        Promise.all(namespacesData.map((ns: any) => api.getServices(ns.name, true))).then(results => results.flat()),
        // 모든 네임스페이스의 Deployments 조회
        Promise.all(namespacesData.map((ns: any) => api.getDeployments(ns.name, true))).then(results => results.flat()),
        // 모든 네임스페이스의 PVCs 조회
        api.getPVCs(undefined, true),
      ])

      console.log('✅ API 응답 받음:', {
        overview: overviewData,
        overviewPods: overviewData?.total_pods,
        namespaces: namespacesData?.length,
        nodes: nodesData?.length,
        pods: allPodsData?.length,
        services: allServicesData?.length,
        deployments: allDeploymentsData?.length,
        pvcs: allPVCsData?.length
      })
      console.log('📊 현재 화면에 표시중인 overview:', overview)

      // 실제 데이터로 overview 보정 (타이밍 이슈 방지)
      const correctedOverview = {
        ...overviewData,
        total_pods: allPodsData.length,
        total_namespaces: namespacesData.length,
        total_services: allServicesData.length,
        total_deployments: allDeploymentsData.length,
        total_pvcs: allPVCsData.length,
      }

      console.log('✏️  보정된 overview:', correctedOverview)

      // 캐시를 완전히 제거하고 새 데이터로 설정 (강제 리렌더링)
      queryClient.removeQueries({ queryKey: ['cluster-overview'] })
      queryClient.removeQueries({ queryKey: ['namespaces'] })
      queryClient.removeQueries({ queryKey: ['all-namespaces'] })
      queryClient.removeQueries({ queryKey: ['nodes'] })
      queryClient.removeQueries({ queryKey: ['modal-nodes'] })
      queryClient.removeQueries({ queryKey: ['all-pods'] })
      queryClient.removeQueries({ queryKey: ['all-services'] })
      queryClient.removeQueries({ queryKey: ['all-deployments'] })
      queryClient.removeQueries({ queryKey: ['all-pvcs'] })

      // 새 데이터로 캐시 설정 (보정된 overview 사용)
      queryClient.setQueryData(['cluster-overview'], correctedOverview)
      queryClient.setQueryData(['namespaces'], namespacesData)
      queryClient.setQueryData(['all-namespaces'], namespacesData)
      queryClient.setQueryData(['nodes'], nodesData)
      queryClient.setQueryData(['modal-nodes'], nodesData)
      queryClient.setQueryData(['all-pods'], allPodsData)
      queryClient.setQueryData(['all-services'], allServicesData)
      queryClient.setQueryData(['all-deployments'], allDeploymentsData)
      queryClient.setQueryData(['all-pvcs'], allPVCsData)

      console.log('💾 React Query 캐시 업데이트 완료')
    } catch (error) {
      console.error('❌ 새로고침 실패:', error)
    }
    setTimeout(() => setIsRefreshing(false), 500)
  }

  const handleStatClick = (type: ResourceType) => {
    setSelectedResourceType(type)
  }

  const handleCloseModal = () => {
    setSelectedResourceType(null)
    setSelectedPodStatus(null)
    setSelectedNodeStatus(null)
    setModalSearchQuery('')
  }

  const handleOpenIssuesModal = () => {
    handleCloseModal()
    setIsStorageModalOpen(false)
    setIsOptimizationModalOpen(false)
    setIsIssuesModalOpen(true)
  }

  const handleOpenStorageModal = () => {
    handleCloseModal()
    setIsIssuesModalOpen(false)
    setIsOptimizationModalOpen(false)
    setStorageActiveTab('pvcs')
    setStorageSearchQuery('')
    setStorageNamespaceFilter('all')
    setIsStorageNamespaceDropdownOpen(false)
    setIsStorageModalOpen(true)
  }

  const handleOpenOptimizationModal = () => {
    handleCloseModal()
    setIsIssuesModalOpen(false)
    setIsStorageModalOpen(false)
    setIsStorageNamespaceDropdownOpen(false)
    setIsOptimizationNamespaceDropdownOpen(false)
    setOptimizationCopied(false)
    optimizationAbortRef.current?.abort()
    optimizationAbortRef.current = null
    if (optimizationStreamRafRef.current) {
      window.cancelAnimationFrame(optimizationStreamRafRef.current)
      optimizationStreamRafRef.current = null
    }
    optimizationStreamPendingRef.current = ''
    optimizationStreamDoneRef.current = false
    setIsOptimizationStreaming(false)
    setOptimizationObservedContent('')
    setOptimizationAnswerContent('')
    setOptimizationStreamError('')

    const namespaceNames = Array.isArray(allNamespaces)
      ? allNamespaces.map((ns: any) => String(ns?.name ?? '')).filter(Boolean)
      : []
    const preferred = namespaceNames.includes('default') ? 'default' : (namespaceNames[0] ?? 'default')
    setOptimizationNamespace(preferred)

    setIsOptimizationModalOpen(true)
  }

  useEffect(() => {
    if (!isIssuesModalOpen) return
    // 모달을 열 때마다 최신 상태(특히 CrashLoopBackOff reason 등)를 다시 가져오도록 강제한다.
    void queryClient.invalidateQueries({ queryKey: ['all-pods'], refetchType: 'active' })
    void queryClient.invalidateQueries({ queryKey: ['all-pvcs'], refetchType: 'active' })
    void queryClient.invalidateQueries({ queryKey: ['all-namespaces'], refetchType: 'active' })
    void queryClient.invalidateQueries({ queryKey: ['all-deployments'], refetchType: 'active' })
    void queryClient.invalidateQueries({ queryKey: ['nodes'], refetchType: 'active' })
  }, [isIssuesModalOpen, queryClient])

  const handleCloseIssuesModal = () => {
    setIsIssuesModalOpen(false)
    setIssuesSearchQuery('')
    setIncludeRestartHistory(false)
  }

  const handleCloseStorageModal = () => {
    setIsStorageModalOpen(false)
    setStorageSearchQuery('')
    setStorageNamespaceFilter('all')
    setIsStorageNamespaceDropdownOpen(false)
  }

  const handleCloseOptimizationModal = () => {
    setIsOptimizationModalOpen(false)
    setIsOptimizationNamespaceDropdownOpen(false)
    setOptimizationCopied(false)
    optimizationAbortRef.current?.abort()
    optimizationAbortRef.current = null
    if (optimizationStreamRafRef.current) {
      window.cancelAnimationFrame(optimizationStreamRafRef.current)
      optimizationStreamRafRef.current = null
    }
    optimizationStreamPendingRef.current = ''
    optimizationStreamDoneRef.current = false
    setIsOptimizationStreaming(false)
    setOptimizationObservedContent('')
    setOptimizationAnswerContent('')
    setOptimizationStreamError('')
  }

  const stopOptimizationTypewriter = () => {
    if (optimizationTypewriterRef.current !== null) {
      clearInterval(optimizationTypewriterRef.current)
      optimizationTypewriterRef.current = null
    }
  }

  const drainOptimizationQueue = () => {
    const queue = optimizationCharQueueRef.current
    if (queue.length === 0) {
      stopOptimizationTypewriter()
      // 큐 소진 + 스트림 종료 → completed
      if (optimizationStreamDoneRef.current) {
        optimizationStreamDoneRef.current = false
        setOptimizationAnswerContent((prev) => unwrapOuterMarkdownFence(prev))
        setIsOptimizationStreaming(false)
      }
      return
    }
    // 적응형 배치: 큐 짧으면 1글자, 길면 많이 (따라잡기)
    const batch = Math.max(1, Math.ceil(queue.length / 8))
    const chars = queue.splice(0, batch).join('')
    setOptimizationAnswerContent((prev) => prev + chars)
  }

  const startOptimizationTypewriter = () => {
    if (optimizationTypewriterRef.current !== null) return
    optimizationTypewriterRef.current = window.setInterval(drainOptimizationQueue, 30)
  }

  const handleRunOptimizationSuggestions = () => {
    if (!optimizationNamespace) return
    setOptimizationCopied(false)
    setIsOptimizationNamespaceDropdownOpen(false)
    optimizationAbortRef.current?.abort()
    const controller = new AbortController()
    optimizationAbortRef.current = controller

    setIsOptimizationStreaming(true)
    setOptimizationObservedContent('')
    setOptimizationAnswerContent('')
    setOptimizationStreamError('')
    setOptimizationUsage(null)
    setOptimizationMeta(null)
    optimizationMetaReceivedRef.current = false
    optimizationUsageReceivedRef.current = false
    optimizationStreamPendingRef.current = ''
    optimizationStreamDoneRef.current = false
    stopOptimizationTypewriter()
    optimizationCharQueueRef.current.length = 0

    void api
      .suggestOptimizationStream(optimizationNamespace, {
        signal: controller.signal,
        onObserved: (content) => {
          // Observed data 표는 한 번에 표시 (타자 효과 적용 X)
          setOptimizationObservedContent((prev) => prev + content)
        },
        onContent: (chunk) => {
          // 타자기 큐에 글자 추가
          for (const ch of chunk) {
            optimizationCharQueueRef.current.push(ch)
          }
          startOptimizationTypewriter()
        },
        onUsage: (usage) => {
          optimizationUsageReceivedRef.current = true
          setOptimizationUsage(usage)
        },
        onMeta: (meta) => {
          optimizationMetaReceivedRef.current = true
          setOptimizationMeta(meta)
        },
        onError: (message) => {
          setOptimizationStreamError(message)
        },
        onDone: () => {
          if (!optimizationMetaReceivedRef.current) {
            setOptimizationStreamError((prev) => prev || tr(
              'dashboard.optimization.missingMeta',
              'Server did not send meta (finish reason). ai-service may not be rebuilt/restarted.',
            ))
          }
          optimizationStreamDoneRef.current = true
          // 큐가 비어있으면 즉시 완료, 아니면 타자기가 소진 후 자동 완료
          if (optimizationCharQueueRef.current.length === 0) {
            drainOptimizationQueue()
          }
          optimizationAbortRef.current = null
        },
      })
      .catch((error) => {
        if ((error as any)?.name === 'AbortError') return
        setOptimizationStreamError(error instanceof Error ? error.message : String(error))
        stopOptimizationTypewriter()
        optimizationCharQueueRef.current.length = 0
        optimizationStreamPendingRef.current = ''
        optimizationStreamDoneRef.current = false
        setIsOptimizationStreaming(false)
        optimizationAbortRef.current = null
      })
  }

  const handleCopyOptimizationSuggestions = async () => {
    const text = `${optimizationObservedContent}${unwrapOuterMarkdownFence(optimizationAnswerContent)}`.trim()
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      setOptimizationCopied(true)
      setTimeout(() => setOptimizationCopied(false), 1500)
    } catch (error) {
      console.error('❌ 클립보드 복사 실패:', error)
      setOptimizationCopied(false)
    }
  }

  const handleStopOptimizationSuggestions = () => {
    optimizationAbortRef.current?.abort()
    optimizationAbortRef.current = null
    stopOptimizationTypewriter()
    // 큐에 남은 글자 즉시 반영
    if (optimizationCharQueueRef.current.length > 0) {
      const remaining = optimizationCharQueueRef.current.join('')
      optimizationCharQueueRef.current.length = 0
      setOptimizationAnswerContent((prev) => prev + remaining)
    }
    optimizationStreamPendingRef.current = ''
    optimizationStreamDoneRef.current = false
    setIsOptimizationStreaming(false)
  }

  // 최적화 제안 네임스페이스 드롭다운 외부 클릭 감지
  useEffect(() => {
    if (!isOptimizationNamespaceDropdownOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (
        optimizationNamespaceDropdownRef.current &&
        !optimizationNamespaceDropdownRef.current.contains(event.target as Node)
      ) {
        setIsOptimizationNamespaceDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOptimizationNamespaceDropdownOpen])

  useEffect(() => {
    if (!isStorageModalOpen) return
    void queryClient.invalidateQueries({ queryKey: ['all-pvcs'], refetchType: 'active' })
    void queryClient.invalidateQueries({ queryKey: ['all-pvs'], refetchType: 'active' })
    void queryClient.invalidateQueries({ queryKey: ['storage-topology'], refetchType: 'active' })
  }, [isStorageModalOpen, queryClient])

  useEffect(() => {
    if (!isOptimizationModalOpen) return
    void queryClient.invalidateQueries({ queryKey: ['all-namespaces'], refetchType: 'active' })
  }, [isOptimizationModalOpen, queryClient])

  useEffect(() => {
    if (!isOptimizationModalOpen) return
    if (!Array.isArray(allNamespaces) || allNamespaces.length === 0) return
    const namespaceNames = allNamespaces.map((ns: any) => String(ns?.name ?? '')).filter(Boolean)
    if (!namespaceNames.includes(optimizationNamespace)) {
      setOptimizationNamespace(namespaceNames.includes('default') ? 'default' : namespaceNames[0])
    }
  }, [isOptimizationModalOpen, allNamespaces, optimizationNamespace])

  const handleNodeClick = (node: any) => {
    openDetail({ kind: 'Node', name: node.name })
  }

  const handlePodStatusClick = (status: string) => {
    setSelectedPodStatus(status)
    setSelectedResourceType('pods')
  }

  const handleNodeStatusClick = (status: string) => {
    setSelectedNodeStatus(status)
    setSelectedResourceType('nodes')
  }

  // ESC 키로 모달 닫기
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isIssuesModalOpen) {
          handleCloseIssuesModal()
        }
        if (isStorageModalOpen) {
          handleCloseStorageModal()
        }
        if (selectedResourceType) {
          setSelectedResourceType(null)
          setSelectedPodStatus(null)
          setSelectedNodeStatus(null)
          setModalSearchQuery('')
        }
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [selectedResourceType, isIssuesModalOpen, isStorageModalOpen])

  // 선택된 리소스 타입에 해당하는 stat 정보 가져오기
  const getSelectedStat = () => {
    return stats.find((s) => s.resourceType === selectedResourceType)
  }

  // 리소스 개수 가져오기
  const getResourceCount = () => {
    if (selectedResourceType === 'namespaces') return Array.isArray(namespaces) ? namespaces.length : 0
    if (selectedResourceType === 'pods') return Array.isArray(allPods) ? allPods.length : 0
    if (selectedResourceType === 'services') return Array.isArray(allServices) ? allServices.length : 0
    if (selectedResourceType === 'deployments') return Array.isArray(allDeployments) ? allDeployments.length : 0
    if (selectedResourceType === 'pvcs') return Array.isArray(allPVCs) ? allPVCs.length : 0
    if (selectedResourceType === 'nodes') return Array.isArray(modalNodes) ? modalNodes.length : 0
    return 0
  }

  // 로딩 상태 확인
  const isLoadingResource = () => {
    if (selectedResourceType === 'namespaces') return isLoadingNamespaces
    if (selectedResourceType === 'pods') return isLoadingPods
    if (selectedResourceType === 'services') return isLoadingAllNamespaces || isLoadingServices
    if (selectedResourceType === 'deployments') return isLoadingAllNamespaces || isLoadingDeployments
    if (selectedResourceType === 'pvcs') return isLoadingPVCs
    if (selectedResourceType === 'nodes') return isLoadingNodes
    return false
  }

  // 검색어로 리소스 필터링
  const getFilteredResources = () => {
    let resources: any[] = []

    // 리소스 타입별 기본 데이터 - 항상 배열 보장
    if (selectedResourceType === 'namespaces') resources = Array.isArray(namespaces) ? namespaces : []
    else if (selectedResourceType === 'pods') resources = Array.isArray(allPods) ? allPods : []
    else if (selectedResourceType === 'services') resources = Array.isArray(allServices) ? allServices : []
    else if (selectedResourceType === 'deployments') resources = Array.isArray(allDeployments) ? allDeployments : []
    else if (selectedResourceType === 'pvcs') resources = Array.isArray(allPVCs) ? allPVCs : []
    else if (selectedResourceType === 'nodes') resources = Array.isArray(modalNodes) ? modalNodes : []

    // Pod 상태 필터링
    if (selectedPodStatus && selectedResourceType === 'pods') {
      resources = resources.filter((pod: any) => pod.phase === selectedPodStatus)
    }

    // Node 상태 필터링
    if (selectedNodeStatus && selectedResourceType === 'nodes') {
      resources = resources.filter((node: any) => node.status === selectedNodeStatus)
    }

    // 검색어 필터링
    if (!modalSearchQuery.trim()) return resources

    const query = modalSearchQuery.toLowerCase()

    if (selectedResourceType === 'namespaces') {
      return resources.filter((ns: any) =>
        ns.name.toLowerCase().includes(query)
      )
    }

    if (selectedResourceType === 'pods') {
      return resources.filter((pod: any) =>
        pod.name.toLowerCase().includes(query) ||
        pod.namespace.toLowerCase().includes(query) ||
        (pod.node_name && pod.node_name.toLowerCase().includes(query))
      )
    }

    if (selectedResourceType === 'services') {
      return resources.filter((svc: any) =>
        svc.name.toLowerCase().includes(query) ||
        svc.namespace.toLowerCase().includes(query) ||
        (svc.type && svc.type.toLowerCase().includes(query)) ||
        (svc.cluster_ip && svc.cluster_ip.toLowerCase().includes(query))
      )
    }

    if (selectedResourceType === 'deployments') {
      return resources.filter((deploy: any) =>
        deploy.name.toLowerCase().includes(query) ||
        deploy.namespace.toLowerCase().includes(query)
      )
    }

    if (selectedResourceType === 'pvcs') {
      return resources.filter(pvc =>
        pvc.name.toLowerCase().includes(query) ||
        pvc.namespace.toLowerCase().includes(query) ||
        (pvc.storage_class && pvc.storage_class.toLowerCase().includes(query))
      )
    }

    if (selectedResourceType === 'nodes') {
      return resources.filter(node =>
        node.name.toLowerCase().includes(query) ||
        (node.version && node.version.toLowerCase().includes(query)) ||
        (node.internal_ip && node.internal_ip.toLowerCase().includes(query)) ||
        (node.roles && node.roles.some((role: string) => role.toLowerCase().includes(query)))
      )
    }

    return []
  }

  const filteredResources = getFilteredResources()

  if (isLoading) {
    return <DashboardSkeleton />
  }

  // Pod/Node 상태는 Kubernetes 스펙상 가능한 값이 제한적이므로
  // 차트에서 항상 전체 상태를 보여주기 위해 고정 목록 사용
  const POD_PHASES = ['Running', 'Succeeded', 'Failed', 'Pending', 'Unknown']
  const NODE_STATUSES = ['Ready', 'NotReady']

  const stats = [
    {
      name: tr('dashboard.stats.namespaces', 'Namespaces'),
      resourceType: 'namespaces' as ResourceType,
      value: overview?.total_namespaces || 0,
      icon: Server,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      name: tr('dashboard.stats.pods', 'Pods'),
      resourceType: 'pods' as ResourceType,
      value: overview?.total_pods || 0,
      icon: Box,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
    },
    {
      name: tr('dashboard.stats.services', 'Services'),
      resourceType: 'services' as ResourceType,
      value: overview?.total_services || 0,
      icon: Database,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
    {
      name: tr('dashboard.stats.deployments', 'Deployments'),
      resourceType: 'deployments' as ResourceType,
      value: overview?.total_deployments || 0,
      icon: TrendingUp,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/10',
    },
    {
      name: tr('dashboard.stats.pvcs', 'PVCs'),
      resourceType: 'pvcs' as ResourceType,
      value: overview?.total_pvcs || 0,
      icon: HardDrive,
      color: 'text-pink-400',
      bgColor: 'bg-pink-500/10',
    },
    {
      name: tr('dashboard.stats.nodes', 'Nodes'),
      resourceType: 'nodes' as ResourceType,
      value: overview?.node_count || 0,
      icon: Server,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
    },
  ]

  // Pod 상태 차트 데이터
  const podStatusData = overview
    ? POD_PHASES.map((phase) => ({
      name: phase,
      value: overview?.pod_status?.[phase] ?? 0,
    }))
    : []

  // 노드 상태 차트 데이터
  const nodeStatusData = nodes && Array.isArray(nodes)
    ? nodes.reduce((acc: Record<string, number>, node) => {
      const status = node.status || 'Unknown'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    : {}

  const nodeStatusChartData = nodes && Array.isArray(nodes)
    ? NODE_STATUSES.map((status) => ({
      name: status,
      value: nodeStatusData[status] ?? 0,
    }))
    : []

  const allPodsArray = Array.isArray(allPods) ? allPods : []
  const allNodesArray = Array.isArray(nodes) ? nodes : []
  const allPVCsArray = Array.isArray(allPVCs) ? allPVCs : []
  const allDeploymentsArray = Array.isArray(allDeployments) ? allDeployments : []

  const issuesFromPods: IssueItem[] = allPodsArray.flatMap((pod: any) => {
    const phase = String(pod?.phase ?? pod?.status ?? '')
    const ready = parseReady(pod?.ready)
    const isRunningNotReady = phase === 'Running' && ready != null && ready.ready < ready.total
    const restartCount = Number(pod?.restart_count ?? 0)

    const reasons: string[] = []
    let severity: IssueSeverity | null = null

    const containers = Array.isArray(pod?.containers) ? pod.containers : []
    const criticalWaitingReasons = new Set([
      'CrashLoopBackOff',
      'ImagePullBackOff',
      'ErrImagePull',
      'CreateContainerConfigError',
      'CreateContainerError',
      'RunContainerError',
    ])

    const waitingReasons: string[] = []
    const terminatedReasons: string[] = []
    let hasCriticalWaitingReason = false
    let hasCriticalTerminatedState = false

    let latestTerminationMs: number | null = null
    let latestTerminationReason: string | null = null

    for (const container of containers) {
      const waitingReason = container?.state?.waiting?.reason
      if (waitingReason) {
        const wr = String(waitingReason)
        waitingReasons.push(wr)
        if (criticalWaitingReasons.has(wr)) hasCriticalWaitingReason = true
      }

      const terminatedReason = container?.state?.terminated?.reason
      if (terminatedReason) {
        terminatedReasons.push(String(terminatedReason))
        hasCriticalTerminatedState = true
      }

      const lastTerminated = container?.last_state?.terminated
      const finishedAt = lastTerminated?.finished_at
      const ms = typeof finishedAt === 'string' ? Date.parse(finishedAt) : NaN
      if (Number.isFinite(ms)) {
        if (latestTerminationMs == null || ms > latestTerminationMs) {
          latestTerminationMs = ms
          latestTerminationReason = lastTerminated?.reason ? String(lastTerminated.reason) : null
        }
      }
    }

    const uniqueReasons = (items: string[]) => Array.from(new Set(items)).slice(0, 3)
    const waitingReasonsUnique = uniqueReasons(waitingReasons)
    const terminatedReasonsUnique = uniqueReasons(terminatedReasons)

    // 1) 현재 진행 중인 상태(reason/state)는 "지금 문제"이므로 우선순위를 높게 둔다.
    if (waitingReasonsUnique.length > 0) {
      reasons.push(`Reason: ${waitingReasonsUnique.join(', ')}${waitingReasons.length > 3 ? '…' : ''}`)
      severity = hasCriticalWaitingReason ? 'critical' : 'warning'
    }
    if (terminatedReasonsUnique.length > 0) {
      reasons.push(`Reason: ${terminatedReasonsUnique.join(', ')}${terminatedReasons.length > 3 ? '…' : ''}`)
      severity = 'critical'
    }

    // 2) Pod phase 기반 판정
    if (['Pending', 'Failed', 'Unknown'].includes(phase)) {
      severity = 'critical'
      reasons.push(`Phase: ${phase}`)
    } else if (isRunningNotReady) {
      if (severity == null) severity = 'warning'
      reasons.push(`Ready: ${pod.ready}`)
    }

    // 3) "과거" 재시작은 기본적으로 숨기되, 옵션/최근 재시작은 표시한다.
    const nowMs = Date.now()
    const restartAgeMs = latestTerminationMs == null ? null : nowMs - latestTerminationMs
    const hasAnyCurrentIssue = hasCriticalWaitingReason || hasCriticalTerminatedState || ['Pending', 'Failed', 'Unknown'].includes(phase) || isRunningNotReady

    const hasRestartEvidence = Number.isFinite(restartCount) && restartCount > 0
    const hasRestartTimestamp =
      restartAgeMs != null &&
      Number.isFinite(restartAgeMs) &&
      restartAgeMs >= 0

    const isRecentRestart =
      hasRestartTimestamp && (restartAgeMs as number) <= 24 * 60 * 60 * 1000

    const shouldSurfaceRestartHistory =
      hasRestartEvidence &&
      phase === 'Running' &&
      !hasAnyCurrentIssue &&
      (includeRestartHistory || isRecentRestart)

    if (shouldSurfaceRestartHistory) {
      if (isRecentRestart) {
        // 최근 재시작은 warning/info로 표시
        if (restartAgeMs != null && restartAgeMs <= 60 * 60 * 1000) severity = 'warning'
        else severity = 'info'
      } else {
        severity = 'info'
      }
      if (latestTerminationReason) reasons.push(`Reason: ${latestTerminationReason}`)
      if (hasRestartTimestamp && restartAgeMs != null) reasons.push(`Last restart: ${formatAge(restartAgeMs)}`)
      reasons.push(`Restarts: ${restartCount}`)
    } else if (hasRestartEvidence && (hasAnyCurrentIssue || hasCriticalWaitingReason || hasCriticalTerminatedState)) {
      // 현재 문제가 있는 경우엔 재시작 횟수는 항상 함께 보여준다.
      reasons.push(`Restarts: ${restartCount}`)
    }

    // 4) 최종 필터: 아무 이유가 없으면 제외
    if (severity == null || reasons.length === 0) return []

    const namespace = String(pod?.namespace ?? '')
    const name = String(pod?.name ?? '')
    return [
      {
        id: `pod:${namespace}:${name}`,
        kind: 'Pod',
        severity,
        title: name,
        subtitle: reasons.join(' · '),
        namespace,
        name,
      },
    ]
  })

  const issuesFromNodes: IssueItem[] = allNodesArray.flatMap((node: any) => {
    const status = String(node?.status ?? '')
    if (!status || status === 'Ready') return []

    const name = String(node?.name ?? '')
    return [
      {
        id: `node:${name}`,
        kind: 'Node',
        severity: 'critical',
        title: name,
        subtitle: `Status: ${status}`,
        name,
      },
    ]
  })

  const issuesFromPVCs: IssueItem[] = allPVCsArray.flatMap((pvc: any) => {
    const status = String(pvc?.status ?? '')
    if (!status || status === 'Bound') return []

    const namespace = String(pvc?.namespace ?? '')
    const name = String(pvc?.name ?? '')
    const severity: IssueSeverity = ['Lost', 'Pending'].includes(status) ? 'critical' : 'warning'

    return [
      {
        id: `pvc:${namespace}:${name}`,
        kind: 'PVC',
        severity,
        title: name,
        subtitle: `Status: ${status}`,
        namespace,
        name,
      },
    ]
  })

  const issuesFromDeployments: IssueItem[] = allDeploymentsArray.flatMap((deploy: any) => {
    const replicas = Number(deploy?.replicas ?? 0)
    const readyReplicas = Number(deploy?.ready_replicas ?? 0)
    const availableReplicas = Number(deploy?.available_replicas ?? 0)

    if (!Number.isFinite(replicas) || replicas <= 0) return []
    if (readyReplicas >= replicas && availableReplicas >= replicas) return []

    const namespace = String(deploy?.namespace ?? '')
    const name = String(deploy?.name ?? '')

    const severity: IssueSeverity = readyReplicas === 0 ? 'critical' : 'warning'
    const subtitle = `Ready: ${readyReplicas}/${replicas} · Available: ${availableReplicas}/${replicas}`

    return [
      {
        id: `deploy:${namespace}:${name}`,
        kind: 'Deployment',
        severity,
        title: name,
        subtitle,
        namespace,
        name,
      },
    ]
  })

  const issuesFromMetrics: IssueItem[] = (() => {
    const items: IssueItem[] = []
    if (topResources?.pod_error) {
      items.push({
        id: 'metrics:pod_error',
        kind: 'Metrics',
        severity: 'info',
        title: tr('dashboard.issues.metricsPodTitle', 'Pod metrics collection failed'),
        subtitle: tr('dashboard.metricsServerHint', 'Check metrics-server status'),
      })
    }
    if (topResources?.node_error) {
      items.push({
        id: 'metrics:node_error',
        kind: 'Metrics',
        severity: 'info',
        title: tr('dashboard.issues.metricsNodeTitle', 'Node metrics collection failed'),
        subtitle: tr('dashboard.metricsServerHint', 'Check metrics-server status'),
      })
    }
    return items
  })()

  const allIssues: IssueItem[] = [
    ...issuesFromNodes,
    ...issuesFromDeployments,
    ...issuesFromPVCs,
    ...issuesFromPods,
    ...issuesFromMetrics,
  ]

  const severityRank: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 }
  const kindRank: Record<IssueKind, number> = { Node: 0, Deployment: 1, PVC: 2, Pod: 3, Metrics: 4 }

  const normalizedIssuesQuery = issuesSearchQuery.trim().toLowerCase()
  const filteredIssues = normalizedIssuesQuery
    ? allIssues.filter((issue) => {
      const haystack = [
        issue.kind,
        issue.severity,
        issue.namespace,
        issue.name,
        issue.title,
        issue.subtitle,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedIssuesQuery)
    })
    : allIssues

  const sortedIssues = [...filteredIssues].sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity]
    if (bySeverity !== 0) return bySeverity
    const byKind = kindRank[a.kind] - kindRank[b.kind]
    if (byKind !== 0) return byKind
    return a.id.localeCompare(b.id)
  })

  const issuesByKind = sortedIssues.reduce<Record<IssueKind, IssueItem[]>>((acc, issue) => {
    acc[issue.kind] = acc[issue.kind] ?? []
    acc[issue.kind].push(issue)
    return acc
  }, {} as Record<IssueKind, IssueItem[]>)

  const issuesSummary = sortedIssues.reduce(
    (acc, issue) => {
      acc.total += 1
      acc[issue.severity] += 1
      return acc
    },
    { total: 0, critical: 0, warning: 0, info: 0 } as { total: number; critical: number; warning: number; info: number }
  )

  const isIssuesLoading =
    isIssuesModalOpen &&
    (isLoadingPods || isLoadingPVCs || isLoadingAllNamespaces || isLoadingDeployments)

  const allPVsArray = Array.isArray(allPVs) ? allPVs : []

  const normalizedStorageQuery = storageSearchQuery.trim().toLowerCase()
  const storageNamespaces = (() => {
    const fromApi = Array.isArray(allNamespaces) ? allNamespaces.map((ns: any) => String(ns?.name ?? '')).filter(Boolean) : []
    const fromPVCs = allPVCsArray.map((pvc: any) => String(pvc?.namespace ?? '')).filter(Boolean)
    return Array.from(new Set([...fromApi, ...fromPVCs])).sort()
  })()

  const filteredPVCsForStorage = allPVCsArray
    .filter((pvc: any) => (storageNamespaceFilter === 'all' ? true : String(pvc?.namespace ?? '') === storageNamespaceFilter))
    .filter((pvc: any) => {
      if (!normalizedStorageQuery) return true
      const haystack = [
        pvc?.name,
        pvc?.namespace,
        pvc?.status,
        pvc?.storage_class,
        pvc?.volume_name,
        pvc?.capacity,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedStorageQuery)
    })

  const filteredPVsForStorage = allPVsArray
    .filter((pv: any) => {
      if (storageNamespaceFilter === 'all') return true
      const claimNs = pv?.claim_ref?.namespace
      return claimNs && String(claimNs) === storageNamespaceFilter
    })
    .filter((pv: any) => {
      if (!normalizedStorageQuery) return true
      const haystack = [
        pv?.name,
        pv?.status,
        pv?.capacity,
        pv?.storage_class,
        pv?.reclaim_policy,
        pv?.claim_ref?.namespace,
        pv?.claim_ref?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedStorageQuery)
    })

  const pvcStatusCounts = filteredPVCsForStorage.reduce<Record<string, number>>((acc, pvc: any) => {
    const status = String(pvc?.status ?? 'Unknown')
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})

  const pvStatusCounts = filteredPVsForStorage.reduce<Record<string, number>>((acc, pv: any) => {
    const status = String(pv?.status ?? 'Unknown')
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})

  const pvcStatusRank: Record<string, number> = { Pending: 0, Lost: 1, Bound: 2 }
  const pvStatusRank: Record<string, number> = { Failed: 0, Released: 1, Available: 2, Bound: 3 }

  const sortedPVCsForStorage = [...filteredPVCsForStorage].sort((a: any, b: any) => {
    const ar = pvcStatusRank[String(a?.status ?? '')] ?? 99
    const br = pvcStatusRank[String(b?.status ?? '')] ?? 99
    if (ar !== br) return ar - br
    const an = `${a?.namespace ?? ''}/${a?.name ?? ''}`
    const bn = `${b?.namespace ?? ''}/${b?.name ?? ''}`
    return an.localeCompare(bn)
  })

  const sortedPVsForStorage = [...filteredPVsForStorage].sort((a: any, b: any) => {
    const ar = pvStatusRank[String(a?.status ?? '')] ?? 99
    const br = pvStatusRank[String(b?.status ?? '')] ?? 99
    if (ar !== br) return ar - br
    const an = String(a?.name ?? '')
    const bn = String(b?.name ?? '')
    return an.localeCompare(bn)
  })

  const isStorageLoading =
    isStorageModalOpen &&
    (isLoadingPVCs || isLoadingPVs || (storageActiveTab === 'topology' && isLoadingStorageTopology))

  const optimizationNamespaces = Array.isArray(allNamespaces)
    ? allNamespaces.map((ns: any) => String(ns?.name ?? '')).filter(Boolean).sort()
    : []

  const optimizationObservedMarkdown = optimizationObservedContent
    .replace(/\n\n---\n\n## 최적화 제안 \(AI\)\n\n\s*$/m, '')
    .trim()
  const optimizationAnswerMarkdown = unwrapOuterMarkdownFence(optimizationAnswerContent).trim()
  const optimizationAnswerMarkdownForStreaming = makeStreamingMarkdownRenderFriendly(optimizationAnswerMarkdown)
  const optimizationMarkdown = `${optimizationObservedContent}${unwrapOuterMarkdownFence(optimizationAnswerContent)}`.trim()
  return (
    <div className="space-y-8">
      <DashboardHeader
        clusterVersion={overview?.cluster_version}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => {
          const resourceType = stat.resourceType

          return (
            <button
              key={stat.name}
              onClick={() => handleStatClick(resourceType)}
              className="card hover:border-primary-500 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400">{stat.name}</p>
                  <p className="mt-2 text-3xl font-bold text-white">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <DashboardPodNodeStatus
        podStatusData={podStatusData}
        nodeStatusChartData={nodeStatusChartData}
        onPodStatusClick={handlePodStatusClick}
        onNodeStatusClick={handleNodeStatusClick}
      />

      {/* Prometheus Cluster Metrics */}
      {promCluster.available && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-xl font-bold text-white">{tr('dashboard.clusterMetrics', 'Cluster Resource Utilization')}</h2>
            <span className="text-xs text-slate-500">Live</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {getClusterMetric('cpu') !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">CPU</span>
                  <span className="font-mono text-slate-300">{Math.round(getClusterMetric('cpu')!)}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all ${getClusterMetric('cpu')! >= 80 ? 'bg-red-500' : getClusterMetric('cpu')! >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(getClusterMetric('cpu')!, 100)}%` }}
                  />
                </div>
              </div>
            )}
            {getClusterMetric('memory') !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Memory</span>
                  <span className="font-mono text-slate-300">{Math.round(getClusterMetric('memory')!)}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all ${getClusterMetric('memory')! >= 80 ? 'bg-red-500' : getClusterMetric('memory')! >= 60 ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(getClusterMetric('memory')!, 100)}%` }}
                  />
                </div>
              </div>
            )}
            {getClusterMetric('disk') !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Disk</span>
                  <span className="font-mono text-slate-300">{Math.round(getClusterMetric('disk')!)}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all ${getClusterMetric('disk')! >= 80 ? 'bg-red-500' : getClusterMetric('disk')! >= 60 ? 'bg-amber-500' : 'bg-violet-500'}`}
                    style={{ width: `${Math.min(getClusterMetric('disk')!, 100)}%` }}
                  />
                </div>
              </div>
            )}
            {getClusterMetric('pod_count') !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Pods</span>
                  <span className="font-mono text-slate-300">{Math.round(getClusterMetric('pod_count')!)}</span>
                </div>
                <div className="text-2xl font-bold text-white">{Math.round(getClusterMetric('pod_count')!)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <DashboardTopResources
        topResources={topResources}
        isLoading={isLoadingTopResources}
        isError={isTopResourcesError}
        metricsUnavailable={metricsUnavailable}
      />

      <DashboardNodeList
        nodes={nodes ?? []}
        onNodeClick={handleNodeClick}
      />

      <DashboardQuickActions
        onOpenIssues={handleOpenIssuesModal}
        onOpenOptimization={handleOpenOptimizationModal}
        onOpenStorage={handleOpenStorageModal}
      />

      <OptimizationModal
        open={isOptimizationModalOpen}
        onClose={handleCloseOptimizationModal}
        namespace={optimizationNamespace}
        setNamespace={setOptimizationNamespace}
        namespaces={optimizationNamespaces}
        isLoadingNamespaces={isLoadingAllNamespaces}
        isDropdownOpen={isOptimizationNamespaceDropdownOpen}
        setIsDropdownOpen={setIsOptimizationNamespaceDropdownOpen}
        isStreaming={isOptimizationStreaming}
        copied={optimizationCopied}
        fullMarkdown={optimizationMarkdown}
        observedMarkdown={optimizationObservedMarkdown}
        answerMarkdown={optimizationAnswerMarkdown}
        answerMarkdownForStreaming={optimizationAnswerMarkdownForStreaming}
        answerContent={optimizationAnswerContent}
        streamError={optimizationStreamError}
        usage={optimizationUsage}
        meta={optimizationMeta}
        onRun={handleRunOptimizationSuggestions}
        onStop={handleStopOptimizationSuggestions}
        onCopy={handleCopyOptimizationSuggestions}
      />

      <IssuesModal
        open={isIssuesModalOpen}
        onClose={handleCloseIssuesModal}
        includeRestartHistory={includeRestartHistory}
        setIncludeRestartHistory={setIncludeRestartHistory}
        searchQuery={issuesSearchQuery}
        setSearchQuery={setIssuesSearchQuery}
        isLoading={isIssuesLoading}
        sortedIssues={sortedIssues}
        issuesByKind={issuesByKind}
        issuesSummary={issuesSummary}
      />

      <StorageModal
        open={isStorageModalOpen}
        onClose={handleCloseStorageModal}
        sortedPVCs={sortedPVCsForStorage}
        sortedPVs={sortedPVsForStorage}
        pvcStatusCounts={pvcStatusCounts}
        pvStatusCounts={pvStatusCounts}
        activeTab={storageActiveTab}
        setActiveTab={setStorageActiveTab}
        namespaceFilter={storageNamespaceFilter}
        setNamespaceFilter={setStorageNamespaceFilter}
        namespaces={storageNamespaces}
        isDropdownOpen={isStorageNamespaceDropdownOpen}
        setIsDropdownOpen={setIsStorageNamespaceDropdownOpen}
        searchQuery={storageSearchQuery}
        setSearchQuery={setStorageSearchQuery}
        isLoading={isStorageLoading}
        storageTopology={storageTopology}
        isLoadingStorageTopology={isLoadingStorageTopology}
        isStorageTopologyError={isStorageTopologyError}
        storageTopologyError={storageTopologyError}
      />

      <ResourceModal
        selectedResourceType={selectedResourceType}
        onClose={handleCloseModal}
        selectedStat={getSelectedStat()}
        isLoading={isLoadingResource()}
        resourceCount={getResourceCount()}
        searchQuery={modalSearchQuery}
        setSearchQuery={setModalSearchQuery}
        filteredResources={filteredResources}
      />
    </div>
  )
}
