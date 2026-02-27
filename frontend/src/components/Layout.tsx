import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, type ComponentType } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  Box,
  Boxes,
  Clock,
  Database,
  FileBox,
  FileCode,
  HardDrive,
  Key,
  Layers,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Network,
  Search,
  Server,
  Shield,
  Waypoints,
} from 'lucide-react'
import { api } from '@/services/api'
import { clearAccessToken } from '@/services/auth'

type NavItem = {
  name: string
  href: string
  icon?: ComponentType<{ className?: string }>
  exact?: boolean
  match?: (pathname: string, search: string) => boolean
}

type NavGroup = {
  label: string
  items: NavItem[]
  adminOnly?: boolean
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [clusterStatus, setClusterStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking')

  const {
    data: me,
    isError: isMeError,
  } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
    staleTime: 30000,
  })

  useEffect(() => {
    if (!isMeError) return
    clearAccessToken()
    queryClient.clear()
    navigate('/login')
  }, [isMeError, navigate, queryClient])

  useEffect(() => {
    const checkClusterStatus = async () => {
      try {
        const health = await api.getHealth()
        setClusterStatus(health.kubernetes === 'connected' ? 'connected' : 'disconnected')
      } catch (error) {
        setClusterStatus('disconnected')
      }
    }

    checkClusterStatus()
    const interval = setInterval(checkClusterStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleLogout = () => {
    // Best-effort: clear HttpOnly auth cookie (for WS/SSE auth) as well.
    void api.logout().catch(() => {})
    clearAccessToken()
    queryClient.clear()
    navigate('/login')
  }

  const isAdmin = me?.role === 'admin'
  const searchParams = new URLSearchParams(location.search)

  const storageTabMatch = (tab: string) => {
    if (!location.pathname.startsWith('/storage')) return false
    const current = searchParams.get('tab') || 'pvcs'
    return current === tab
  }

  const navGroups: NavGroup[] = [
    {
      label: 'Core',
      items: [
        { name: 'Dashboard', href: '/', icon: LayoutDashboard, exact: true },
        { name: 'Cluster View', href: '/cluster-view', icon: Layers },
        { name: 'Monitoring', href: '/monitoring', icon: Activity },
        { name: 'AI Chat', href: '/ai-chat', icon: MessageSquare },
      ],
    },
    {
      label: 'Cluster',
      items: [
        { name: 'Namespaces', href: '/cluster/namespaces', icon: Boxes },
        { name: 'Nodes', href: '/cluster/nodes', icon: Server },
        { name: 'Advanced Search (Beta)', href: '/cluster/search', icon: Search },
      ],
    },
    {
      label: 'Workloads',
      items: [
        { name: 'Pods', href: '/workloads/pods', icon: Box },
        { name: 'Deployments', href: '/workloads/deployments', icon: Layers },
        { name: 'Stateful Sets', href: '/workloads/statefulsets', icon: Database },
        { name: 'Daemon Sets', href: '/workloads/daemonsets', icon: Server },
        { name: 'Replica Sets', href: '/workloads/replicasets', icon: Boxes },
        { name: 'Jobs', href: '/workloads/jobs', icon: FileBox },
        { name: 'CronJobs', href: '/workloads/cronjobs', icon: Clock },
      ],
    },
    {
      label: 'Storage',
      items: [
        {
          name: 'Persistent Volume Claims',
          href: '/storage?tab=pvcs',
          icon: Database,
          match: () => storageTabMatch('pvcs'),
        },
        {
          name: 'Persistent Volumes',
          href: '/storage?tab=pvs',
          icon: HardDrive,
          match: () => storageTabMatch('pvs'),
        },
        {
          name: 'Storage Classes',
          href: '/storage?tab=storageclasses',
          icon: Layers,
          match: () => storageTabMatch('storageclasses'),
        },
        {
          name: 'Volume Attachments',
          href: '/storage?tab=volumeattachments',
          icon: Waypoints,
          match: () => storageTabMatch('volumeattachments'),
        },
      ],
    },
    {
      label: 'Network',
      items: [
        { name: 'Services', href: '/network/services', icon: Network },
        { name: 'Endpoints', href: '/network/endpoints', icon: Server },
        { name: 'Endpoint Slices', href: '/network/endpointslices', icon: Waypoints },
        { name: 'Ingresses', href: '/network/ingresses', icon: ArrowRight },
        { name: 'Ingress Classes', href: '/network/ingressclasses', icon: FileCode },
        { name: 'Network Policies', href: '/network/networkpolicies', icon: Shield },
      ],
    },
    {
      label: 'Gateway (Beta)',
      items: [
        { name: 'Gateways', href: '/gateway/gateways', icon: Waypoints },
        { name: 'Gateway Classes', href: '/gateway/gatewayclasses', icon: FileCode },
        { name: 'HTTP Routes', href: '/gateway/httproutes', icon: ArrowRight },
        { name: 'GRPC Routes', href: '/gateway/grpcroutes', icon: ArrowRight },
        { name: 'Reference Grants', href: '/gateway/referencegrants', icon: Key },
        { name: 'Backend TLS Policies', href: '/gateway/backendtlspolicies', icon: Shield },
        { name: 'Backend Traffic Policies', href: '/gateway/backendtrafficpolicies', icon: Network },
      ],
    },
    {
      label: 'Security',
      items: [
        { name: 'Service Accounts', href: '/security/serviceaccounts', icon: Key },
        { name: 'Roles', href: '/security/roles', icon: Shield },
        { name: 'Role Bindings', href: '/security/rolebindings', icon: Shield },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { name: 'Config Maps', href: '/configuration/configmaps', icon: FileCode },
        { name: 'Secrets', href: '/configuration/secrets', icon: Key },
        { name: 'HPAs', href: '/configuration/hpas', icon: Activity },
        { name: 'VPAs', href: '/configuration/vpas', icon: Activity },
        { name: 'Pod Disruption Budgets', href: '/configuration/pdbs', icon: Shield },
        { name: 'Resource Quotas', href: '/configuration/resourcequotas', icon: Database },
        { name: 'Limit Ranges', href: '/configuration/limitranges', icon: Layers },
        { name: 'Priority Classes', href: '/configuration/priorityclasses', icon: Activity },
        { name: 'Runtime Classes', href: '/configuration/runtimeclasses', icon: Server },
        { name: 'Leases', href: '/configuration/leases', icon: Clock },
        { name: 'Mutating Webhook Configurations', href: '/configuration/mutatingwebhookconfigurations', icon: FileCode },
        { name: 'Validating Webhook Configurations', href: '/configuration/validatingwebhookconfigurations', icon: FileCode },
      ],
    },
    {
      label: 'Custom Resources',
      items: [
        { name: 'Instances', href: '/custom-resources/instances', icon: FileBox },
        { name: 'CRD Groups', href: '/custom-resources/groups', icon: FileCode },
      ],
    },
    {
      label: 'Admin',
      adminOnly: true,
      items: [{ name: 'User Management', href: '/admin/users', icon: Shield }],
    },
  ]

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="fixed inset-y-0 left-0 w-64 bg-slate-800 border-r border-slate-700">
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-3 px-6 border-b border-slate-700 h-[100px]">
            <Activity className="w-8 h-8 text-primary-500" />
            <div>
              <h1 className="text-xl font-bold text-white">K8s DevOps</h1>
              <p className="text-xs text-slate-400">Assistant</p>
            </div>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-6">
            {navGroups
              .filter((group) => (group.adminOnly ? isAdmin : true))
              .map((group) => (
                <div key={group.label} className="space-y-2">
                  <div className="px-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const isActive = item.match
                        ? item.match(location.pathname, location.search)
                        : item.exact
                          ? location.pathname === item.href
                          : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`)
                      const Icon = item.icon
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          className={`
                            flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors
                            ${isActive ? 'bg-primary-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}
                          `}
                        >
                          {Icon && <Icon className="w-4 h-4" />}
                          <span className="font-medium">{item.name}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
          </nav>

          <div className="px-6 py-4">
            <Link
              to="/account"
              className="block rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 hover:bg-slate-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
              title="내 정보 / 비밀번호 변경"
            >
              <div className="text-[11px] text-slate-400">계정</div>
              <div className="mt-0.5 truncate text-sm text-white">{me?.name ?? '...'}</div>
              <div className="truncate text-xs text-slate-400">{me?.email ?? ''}</div>
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700/40"
            >
              <LogOut className="w-4 h-4" />
              로그아웃
            </button>

            <div className="-mx-6 mt-4 border-t border-slate-700" />
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
              {clusterStatus === 'checking' ? (
                <>
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  <span>연결 확인 중...</span>
                </>
              ) : clusterStatus === 'connected' ? (
                <>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span>클러스터 연결됨</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span>클러스터 연결 안 됨</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="pl-64">
        <main className={`min-h-screen ${location.pathname === '/ai-chat' ? '' : 'p-8'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
