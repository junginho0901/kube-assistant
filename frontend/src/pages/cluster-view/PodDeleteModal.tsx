// Pod 삭제 confirm 모달. ClusterView.tsx 에서 추출 (Phase 3.1.a).
//
// 부모가 모든 상태 (deleteTargetPod / force / error / isDeleting) 를 소유 +
// 콜백 (onForceChange / onClose / onConfirm) 으로 변경 위임. 이 컴포넌트는
// dialog UI 와 disabled 처리만 담당.

import { HelpCircle } from 'lucide-react'
import { ModalOverlay } from '@/components/ModalOverlay'
import type { PodInfo } from '@/services/api'

interface Props {
  pod: PodInfo | null
  force: boolean
  error: string | null
  isDeleting: boolean
  onForceChange: (force: boolean) => void
  onClose: () => void
  onConfirm: () => void
}

export function PodDeleteModal({ pod, force, error, isDeleting, onForceChange, onClose, onConfirm }: Props) {
  if (!pod) return null
  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="bg-slate-800 rounded-lg w-full max-w-lg p-6"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pod 삭제"
      >
        <h2 className="text-xl font-bold text-white mb-4">Pod 삭제</h2>
        <p className="text-slate-300 leading-relaxed">
          <strong>Pod</strong>{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-100">
            {pod.name}
          </kbd>
          를 삭제할까요?
        </p>
        <p className="text-slate-400 mt-3">
          리소스 삭제는 <strong>위험</strong>할 수 있습니다. 삭제 효과를 충분히 이해한 뒤 진행하세요.
          가능하면 변경 전 다른 사람의 리뷰를 받는 것을 권장합니다.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <input
            id="force-delete-checkbox"
            type="checkbox"
            checked={force}
            onChange={(event) => onForceChange(event.target.checked)}
            className="w-4 h-4 rounded border-slate-500 bg-slate-700"
          />
          <label htmlFor="force-delete-checkbox" className="text-sm text-slate-300">
            강제 삭제
          </label>
          <span title="체크 시 grace period를 무시하고 즉시 삭제합니다">
            <HelpCircle className="w-4 h-4 text-slate-400" />
          </span>
        </div>

        {error && (
          <div className="mt-4 text-sm text-red-400">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            취소
          </button>
          <button
            type="button"
            className="btn bg-red-600 hover:bg-red-700 text-white disabled:opacity-60"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            확인
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
