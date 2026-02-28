import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/services/api'
import { KeyRound, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function Account() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const tr = (key: string, fallback: string, options?: Record<string, any>) =>
    t(key, { defaultValue: fallback, ...options })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 30000, retry: false })

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const changePasswordMutation = useMutation({
    mutationFn: () => api.changePassword({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setLocalError(null)
      setSuccess(tr('account.password.changed', 'Password updated.'))
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: () => {
      setSuccess(null)
    },
  })

  const isBusy = changePasswordMutation.isPending

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSuccess(null)
    if (!currentPassword || !newPassword) {
      setLocalError(tr('account.password.required', 'Enter current and new passwords.'))
      return
    }
    if (newPassword !== confirmPassword) {
      setLocalError(tr('account.password.mismatch', 'New passwords do not match.'))
      return
    }
    setLocalError(null)
    changePasswordMutation.mutate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{tr('account.title', 'Account')}</h1>
        <p className="mt-2 text-slate-400">{tr('account.subtitle', 'You can change your password.')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary-500/10">
              <User className="w-6 h-6 text-primary-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{tr('account.profile.title', 'Profile')}</h2>
              <p className="text-sm text-slate-400">{tr('account.profile.subtitle', 'Signed-in account information')}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">{tr('account.profile.name', 'Name')}</div>
            <div className="mt-1 text-sm text-white">{me?.name ?? '-'}</div>
            <div className="mt-3 text-xs text-slate-400">{tr('account.profile.email', 'Email')}</div>
            <div className="mt-1 text-sm text-white">{me?.email ?? '-'}</div>
            <div className="mt-3 text-xs text-slate-400">{tr('account.profile.hq', 'HQ')}</div>
            <div className="mt-1 text-sm text-white">{me?.hq ?? '-'}</div>
            <div className="mt-3 text-xs text-slate-400">{tr('account.profile.team', 'Team')}</div>
            <div className="mt-1 text-sm text-white">{me?.team ?? '-'}</div>
            <div className="mt-3 text-xs text-slate-400">{tr('account.profile.role', 'Role')}</div>
            <div className="mt-1 text-sm text-white">{me?.role ?? '-'}</div>
          </div>
        </div>

        <div className="card h-full flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <KeyRound className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{tr('account.password.title', 'Change password')}</h2>
              <p className="text-sm text-slate-400">{tr('account.password.subtitle', 'Verify your current password')}</p>
            </div>
          </div>

          {success && (
            <div className="mb-3 rounded-lg border border-green-900/40 bg-green-950/30 px-3 py-2 text-sm text-green-200">
              {success}
            </div>
          )}

          {(localError || changePasswordMutation.isError) && (
            <div className="mb-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {localError ?? tr('account.password.failed', 'Failed to change password.')}
            </div>
          )}

          <form onSubmit={onSubmit} className="flex-1 flex flex-col">
            <div className="flex-1 flex flex-col justify-between gap-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {tr('account.password.current', 'Current password')}
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {tr('account.password.new', 'New password')}
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600"
                    placeholder={tr('account.password.minLength', 'At least 4 characters')}
                    autoComplete="new-password"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {tr('account.password.confirm', 'Confirm new password')}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600"
                    placeholder={tr('account.password.confirmPlaceholder', 'Type again')}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isBusy}
                className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBusy
                  ? tr('account.password.updating', 'Updating...')
                  : tr('account.password.submit', 'Update password')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
