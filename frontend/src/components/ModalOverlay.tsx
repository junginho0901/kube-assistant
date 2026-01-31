import { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalOverlayProps {
  children: ReactNode
  onClose?: () => void
}

export function ModalOverlay({ children, onClose }: ModalOverlayProps) {
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

