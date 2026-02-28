import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, Member, UserRole } from '@/services/api'
import { CheckCircle, ChevronDown, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAccessToken } from '@/services/auth'
import { ModalOverlay } from '@/components/ModalOverlay'
import { useTranslation } from 'react-i18next'

export default function AdminUsers() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const tr = (key: string, fallback: string, options?: Record<string, any>) =>
    t(key, { defaultValue: fallback, ...options })
  const [limit] = useState(100)
  const [offset] = useState(0)
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({})
  const [openRoleDropdownUserId, setOpenRoleDropdownUserId] = useState<string | null>(null)
  const roleDropdownRef = useRef<HTMLDivElement | null>(null)
  const [reauthModalOpen, setReauthModalOpen] = useState(false)

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    staleTime: 30000,
    retry: false,
    enabled: !reauthModalOpen,
  })

  const { data: users, isLoading, isError } = useQuery({
    queryKey: ['admin-users', limit, offset],
    queryFn: () => api.adminListUsers({ limit, offset }),
    staleTime: 5000,
    retry: false,
    enabled: !reauthModalOpen,
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: UserRole }) => api.adminUpdateUserRole(userId, role),
    onSuccess: (_data, vars) => {
      // 본인 권한을 admin -> user 로 내린 경우: 안내 모달을 띄우고, 확인 시 로그아웃 + 재로그인 유도
      if (me?.id && vars.userId === me.id && vars.role !== 'admin') {
        setReauthModalOpen(true)
        return
      }

      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (_err, vars) => {
      // 실패 시 서버 값으로 되돌리기(다음 refetch에 맞춤)
      setRoleDrafts((prev) => {
        const next = { ...prev }
        delete next[vars.userId]
        return next
      })
    },
  })

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId }: { userId: string }) => api.adminResetUserPassword(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: ({ userId }: { userId: string }) => api.adminDeleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  useEffect(() => {
    roleDropdownRef.current = null
  }, [openRoleDropdownUserId])

  useEffect(() => {
    if (!openRoleDropdownUserId) return

    const handleClickOutside = (event: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
        setOpenRoleDropdownUserId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openRoleDropdownUserId])

  if (isLoading) {
    return <div className="text-slate-300">{tr('adminUsers.loading', 'Loading...')}</div>
  }

  if (isError) {
    return <div className="text-slate-300">{tr('adminUsers.loadError', 'Failed to load users.')}</div>
  }

  const rows: Member[] = Array.isArray(users) ? users : []
  const isBlocked = reauthModalOpen

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{tr('adminUsers.title', 'User management')}</h1>
        <p className="mt-2 text-slate-400">
          {tr('adminUsers.subtitle', 'Update user roles (read/write/admin).')}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-800/50 overflow-visible">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
            <tr className="text-left text-slate-300">
              <th className="px-4 py-3">{tr('adminUsers.table.name', 'Name')}</th>
              <th className="px-4 py-3">{tr('adminUsers.table.email', 'Email')}</th>
              <th className="px-4 py-3">{tr('adminUsers.table.role', 'Role')}</th>
              <th className="px-4 py-3">{tr('adminUsers.table.password', 'Password')}</th>
              <th className="px-4 py-3">{tr('adminUsers.table.delete', 'Delete')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const isUpdating = updateRoleMutation.isPending && updateRoleMutation.variables?.userId === u.id
              const isResetting = resetPasswordMutation.isPending && resetPasswordMutation.variables?.userId === u.id
              const isDeleting = deleteUserMutation.isPending && deleteUserMutation.variables?.userId === u.id
              const resolvedRole = (u.role === 'admin' || u.role === 'write' || u.role === 'read')
                ? (u.role as UserRole)
                : 'read'
              const currentRole = (roleDrafts[u.id] ?? resolvedRole) as UserRole
              const isOpen = openRoleDropdownUserId === u.id
              const isSelf = !!me?.id && me.id === u.id
              return (
                <tr key={u.id} className="border-t border-slate-700 text-slate-200">
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3">{u.email ?? '-'}</td>
                  <td className="px-4 py-3">
                    <div
                      className="relative inline-block"
                      ref={(el) => {
                        if (isOpen) roleDropdownRef.current = el
                      }}
                    >
                      <button
                        type="button"
                        disabled={isUpdating || isBlocked}
                        onClick={() => setOpenRoleDropdownUserId((prev) => (prev === u.id ? null : u.id))}
                        className="w-32 inline-flex items-center justify-between gap-2 rounded-lg border border-slate-600 bg-slate-900/40 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900/60 focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-50"
                        aria-haspopup="menu"
                        aria-expanded={isOpen}
                      >
                        <span className="truncate">
                          {tr(`adminUsers.roles.${currentRole}`, currentRole.toUpperCase())}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 mt-2 w-32 rounded-xl border border-slate-700 bg-slate-900 shadow-xl z-50 overflow-hidden"
                        >
                          {(['read', 'write', 'admin'] as const).map((role) => {
                            const isSelected = currentRole === role
                            return (
                              <button
                                key={role}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenRoleDropdownUserId(null)
                                  if (role === currentRole) return
                                  setRoleDrafts((prev) => ({ ...prev, [u.id]: role }))
                                  updateRoleMutation.mutate({ userId: u.id, role })
                                }}
                                className={`w-full px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-800 transition-colors ${
                                  isSelected ? 'bg-slate-800 text-white' : 'text-slate-200'
                                }`}
                              >
                                <span className="flex-1 text-left">
                                  {tr(`adminUsers.roles.${role}`, role.toUpperCase())}
                                </span>
                                {isSelected && <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={isResetting || isBlocked}
                      onClick={() => {
                        const ok = window.confirm(
                          tr('adminUsers.resetPasswordConfirm', 'Reset password to 1111?\\n\\nTarget: {{target}}', {
                            target: u.email ?? u.name,
                          })
                        )
                        if (!ok) return
                        resetPasswordMutation.mutate({ userId: u.id })
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-900/40 px-2.5 py-2 text-xs text-slate-200 hover:bg-slate-900/60 focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-50"
                      title={tr('adminUsers.resetPasswordTitle', 'Reset password to 1111')}
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {isResetting
                          ? tr('adminUsers.resetting', 'Resetting...')
                          : tr('adminUsers.reset', 'Reset PW')}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={isDeleting || isSelf || isBlocked}
                      onClick={() => {
                        const ok = window.confirm(
                          tr(
                            'adminUsers.deleteConfirm',
                            'Delete this user?\\n\\nTarget: {{target}}\\n\\n* Deletions cannot be easily undone.',
                            { target: u.email ?? u.name }
                          )
                        )
                        if (!ok) return
                        deleteUserMutation.mutate({ userId: u.id })
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/60 bg-red-950/20 px-2.5 py-2 text-xs text-red-200 hover:bg-red-950/35 focus:outline-none focus:ring-2 focus:ring-red-600 disabled:opacity-50"
                      title={
                        isSelf
                          ? tr('adminUsers.deleteSelfBlocked', 'You cannot delete your own account.')
                          : tr('adminUsers.deleteTitle', 'Delete user')
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-300" />
                      <span>
                        {isDeleting ? tr('adminUsers.deleting', 'Deleting...') : tr('adminUsers.delete', 'Delete')}
                      </span>
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-slate-300" colSpan={5}>
                  {tr('adminUsers.empty', 'No users found.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reauthModalOpen && (
        <ModalOverlay>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={tr('adminUsers.reauth.ariaLabel', 'Re-authentication required')}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">
              {tr('adminUsers.reauth.title', 'Role updated')}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {tr('adminUsers.reauth.subtitle', 'For security, please sign in again. You will be taken to the login page.')}
            </p>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  clearAccessToken()
                  queryClient.clear()
                  navigate('/login', { replace: true })
                }}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500"
              >
                {tr('adminUsers.reauth.confirm', 'OK')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
