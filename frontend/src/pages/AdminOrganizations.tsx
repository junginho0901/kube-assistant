import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, Organization } from '@/services/api'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function AdminOrganizations() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const tr = (key: string, fallback: string, options?: Record<string, any>) =>
    t(key, { defaultValue: fallback, ...options })

  const [newHq, setNewHq] = useState('')
  const [newTeam, setNewTeam] = useState('')

  const { data: hqs = [] } = useQuery({
    queryKey: ['organizations', 'hq'],
    queryFn: () => api.listOrganizations('hq'),
  })

  const { data: teams = [] } = useQuery({
    queryKey: ['organizations', 'team'],
    queryFn: () => api.listOrganizations('team'),
  })

  const createMutation = useMutation({
    mutationFn: ({ type, name }: { type: 'hq' | 'team'; name: string }) => api.adminCreateOrganization(type, name),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['organizations', vars.type] })
      if (vars.type === 'hq') setNewHq('')
      else setNewTeam('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: number; type: string }) => api.adminDeleteOrganization(id),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['organizations', vars.type] })
    },
  })

  const renderSection = (
    title: string,
    subtitle: string,
    items: Organization[],
    type: 'hq' | 'team',
    inputValue: string,
    setInputValue: (v: string) => void,
  ) => (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-5">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const name = inputValue.trim()
          if (!name) return
          createMutation.mutate({ type, name })
        }}
      >
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600"
          placeholder={tr('adminOrg.inputPlaceholder', 'Enter name...')}
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || createMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          {tr('adminOrg.add', 'Add')}
        </button>
      </form>

      {createMutation.isError && createMutation.variables?.type === type && (
        <div className="mt-2 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {tr('adminOrg.addError', 'Failed to add. It may already exist.')}
        </div>
      )}

      <div className="mt-4 space-y-1">
        {items.length === 0 && (
          <p className="text-sm text-slate-500 py-2">{tr('adminOrg.empty', 'No items registered.')}</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-900/30 px-4 py-2.5"
          >
            <span className="text-sm text-slate-200">{item.name}</span>
            <button
              type="button"
              onClick={() => {
                const ok = window.confirm(tr('adminOrg.deleteConfirm', 'Delete "{{name}}"?', { name: item.name }))
                if (!ok) return
                deleteMutation.mutate({ id: item.id, type: item.type })
              }}
              disabled={deleteMutation.isPending && deleteMutation.variables?.id === item.id}
              className="rounded p-1 text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-colors"
              title={tr('adminOrg.deleteTitle', 'Delete')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{tr('adminOrg.title', 'HQ / Team management')}</h1>
        <p className="mt-2 text-slate-400">
          {tr('adminOrg.subtitle', 'Manage the list of HQs and Teams that users can select during registration.')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {renderSection(
          tr('adminOrg.hqTitle', 'HQ'),
          tr('adminOrg.hqSubtitle', 'Headquarters / Divisions'),
          hqs,
          'hq',
          newHq,
          setNewHq,
        )}
        {renderSection(
          tr('adminOrg.teamTitle', 'Team'),
          tr('adminOrg.teamSubtitle', 'Teams / Groups'),
          teams,
          'team',
          newTeam,
          setNewTeam,
        )}
      </div>
    </div>
  )
}
