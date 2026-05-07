import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { api, Session } from '@/services/api'
import { chatStreamManager, ChatStreamState } from '@/services/chatStreamManager'
import { stripToolDetails } from '@/services/chatTextUtils'
import { ChatWelcome } from './ai-chat/ChatWelcome'
import { MessageInput } from './ai-chat/MessageInput'
import { SessionSidebar } from './ai-chat/SessionSidebar'
import { useChatSessions } from './ai-chat/useChatSessions'
import { useChatStreamSync } from './ai-chat/useChatStreamSync'
import { exportToolCallsAsZip } from './ai-chat/exportToolCalls'
import { Bot, User, Sparkles, Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { getAuthHeaders, handleUnauthorized } from '@/services/auth'
// JSZip은 Monaco Editor AMD loader와 충돌하므로 dynamic import 사용
// import JSZip from 'jszip'
import { useTranslation } from 'react-i18next'

const TOOL_RESULT_DISPLAY_MAX_CHARS = 2000
const TRUNCATED_MARKER = '... (truncated) ...'

function truncateToolResultsInContent(content: string, maxChars = TOOL_RESULT_DISPLAY_MAX_CHARS) {
  if (!content) return content

  // Only truncate tool "📊 Results" blocks. Keep other code blocks intact.
  const resultsBlockRegex =
    /(<summary><strong>📊 Results<\/strong><\/summary>[\s\S]*?```(?:json|yaml)?\r?\n)([\s\S]*?)(\r?\n```)/g

  return content.replace(resultsBlockRegex, (_match, prefix: string, body: string, suffix: string) => {
    if (body.includes(TRUNCATED_MARKER)) return `${prefix}${body}${suffix}`
    if (body.length <= maxChars) return `${prefix}${body}${suffix}`
    const truncatedBody = body.slice(0, maxChars) + `\n${TRUNCATED_MARKER}`
    return `${prefix}${truncatedBody}${suffix}`
  })
}

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  isTemporary?: boolean  // 스트리밍 중 임시 메시지 표시
  // Tool 호출 결과 (DB의 tool_calls 컬럼 그대로)
  toolCalls?: any[] 
  // 스트리밍 단계(툴 실행/답변 생성 구분). 임시 메시지에서만 사용.
  streamingPhase?: 'waiting' | 'tools' | 'answer'
}

export default function AIChat() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [viewSessionId, setViewSessionId] = useState<string | null>(null) // 현재 화면에 표시 중인 메시지의 세션
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streamState, setStreamState] = useState<ChatStreamState>(() => chatStreamManager.getState())
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [stoppedSessionId, setStoppedSessionId] = useState<string | null>(null)  // 중단된 세션 ID
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)  // 다중 선택 모드
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())  // 선택된 세션들
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)  // 우클릭 컨텍스트 메뉴
  const [lastLoadedSessionId, setLastLoadedSessionId] = useState<string | null>(null)
  const [pendingFinalSyncSessionId, setPendingFinalSyncSessionId] = useState<string | null>(null)
  const [pinnedSessions, setPinnedSessions] = useState<Record<string, Session>>({})
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamStateRef = useRef<ChatStreamState>(streamState)
  const messagesRef = useRef<Message[]>([])
  const finalSyncRetryRef = useRef<{ sessionId: string | null; tries: number }>({
    sessionId: null,
    tries: 0,
  })
  const finalSyncTimerRef = useRef<number | null>(null)
  const sessionsScrollRef = useRef<HTMLDivElement>(null)
  const sessionsScrollRafRef = useRef<number | null>(null)
  const [sessionsScrollTop, setSessionsScrollTop] = useState(0)
  const [sessionsViewportHeight, setSessionsViewportHeight] = useState(0)

  const isStreaming = streamState.isStreaming
  const isTempSessionId = (id: string | null) => typeof id === 'string' && id.startsWith('temp:')

  const {
    sessionsList,
    sessionsLoading,
    sessionsFetchingNextPage,
    fetchNextSessionsPage,
    sessionsHasNextPage,
    upsertSessionAtFront,
  } = useChatSessions({ pinnedSessions })

  useEffect(() => {
    const el = sessionsScrollRef.current
    if (!el) return

    const update = () => {
      setSessionsViewportHeight(el.clientHeight || 0)
      setSessionsScrollTop(el.scrollTop || 0)
    }

    update()

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 세션 상세 조회 (스트리밍 중이 아닐 때만)
  const { data: sessionDetail } = useQuery({
    queryKey: ['session', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId && !isTempSessionId(selectedSessionId),
  })

  // AI 설정 정보 조회 (모델명)
  const { data: aiConfig } = useQuery({
    queryKey: ['ai-config'],
    queryFn: api.getAIConfig,
    staleTime: 5 * 60 * 1000, // 5분 캐시 (모델 변경 시 invalidate로 즉시 갱신)
  })

  // 세션 생성 (첫 질문에서만 필요)
  const createSessionMutation = useMutation({
    mutationFn: ({ title }: { title: string; optimisticId: string }) => api.createSession(title || 'New Chat'),
    onMutate: async ({ title, optimisticId }: { title: string; optimisticId: string }) => {
      const previousSessions = queryClient.getQueryData<InfiniteData<Session[]>>(['sessions'])
      const nowIso = new Date().toISOString()

      const optimisticSession: Session = {
        id: optimisticId,
        title: title || 'New Chat',
        created_at: nowIso,
        updated_at: nowIso,
        message_count: 0,
      }

      upsertSessionAtFront(optimisticSession)

      // 즉시 UI에 반영 후, 백그라운드에서 기존 세션 fetch를 취소
      void queryClient.cancelQueries({ queryKey: ['sessions'] })
      setViewSessionId(optimisticId)
      return { previousSessions, optimisticId }
    },
    onSuccess: (newSession, _vars, ctx) => {
      // optimistic session을 실제 session으로 교체 (세션 목록 깜빡임 방지)
      if (ctx?.optimisticId) {
        setPinnedSessions((prev) => {
          const next = { ...prev }
          delete next[ctx.optimisticId]
          return next
        })
      }

      upsertSessionAtFront(newSession, ctx?.optimisticId)
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previousSessions) {
        queryClient.setQueryData(['sessions'], ctx.previousSessions)
      }
      if (ctx?.optimisticId) {
        setPinnedSessions((prev) => {
          const next = { ...prev }
          delete next[ctx.optimisticId]
          return next
        })
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })

  // 세션 삭제
  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (selectedSessionId === deleteSessionMutation.variables) {
        setSelectedSessionId(null)
        setMessages([])
      }
    },
  })

  // 세션 제목 수정
  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      api.updateSession(sessionId, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setEditingSessionId(null)
    },
  })

  // 세션 상세가 로드되면 메시지 설정
  // - 새 세션으로 전환될 때는 DB 내용을 그대로 사용
  // - 동일 세션에서 스트리밍이 끝난 후에는, 이미 화면에 있는 답변을 덮어쓰지 않도록 함
  useEffect(() => {
    if (sessionDetail && stoppedSessionId !== sessionDetail.id) {
      console.log('[DEBUG] Loading messages from DB:', sessionDetail.messages.length, 'messages')
      
      const dbMessages = sessionDetail.messages.map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        toolCalls: msg.tool_calls || undefined,
      }))

      // 스트리밍 직후(DB에 assistant가 아직 저장되기 전)에는 DB가 뒤처진 상태로 UI를 덮어쓰지 않도록 방어
      const uiSnapshot = messagesRef.current
      const uiHasAssistant = uiSnapshot.some((m) => m.role === 'assistant' && (m.content?.length ?? 0) > 0)
      const dbIsBehind = dbMessages.length < uiSnapshot.length
      const activeStream = streamStateRef.current
      const streamRelatedToThisSession =
        activeStream.sessionId === sessionDetail.id && (activeStream.status === 'streaming' || activeStream.status === 'completed')

      // 1) 세션이 바뀐 경우: DB 데이터로 완전히 교체 (스트리밍 중인 세션이라도 화면 세션은 맞춰야 함)
      if (sessionDetail.id !== lastLoadedSessionId) {
        const uiHasTemporary = messagesRef.current.some((m) => m.isTemporary)
        const streamForThisSession =
          activeStream.sessionId === sessionDetail.id && activeStream.status === 'streaming'

        // 새로 만든 세션으로 전환 직후(session 생성 완료 직후)에는 DB가 잠깐 빈 배열을 줄 수 있음.
        // 이때 UI에 이미 임시 말풍선이 있으면, 빈 DB 데이터로 덮어써서 "초기화면으로 깜빡"하지 않게 한다.
        if (dbMessages.length === 0 && (streamForThisSession || uiHasTemporary)) {
          setLastLoadedSessionId(sessionDetail.id)
          setViewSessionId(sessionDetail.id)
          return
        }

        // DB가 뒤처진 상태(assistant 저장 전)라면, UI에 이미 그려진 말풍선을 유지한다.
        if (streamRelatedToThisSession && uiHasAssistant && dbIsBehind) {
          setLastLoadedSessionId(sessionDetail.id)
          setViewSessionId(sessionDetail.id)
          return
        }

        console.log('[DEBUG] Session changed, replacing messages from DB')
        setMessages(dbMessages)
        setLastLoadedSessionId(sessionDetail.id)
        setViewSessionId(sessionDetail.id)
        return
      }

      // 현재 세션이 스트리밍 중이라면 DB의 중간 상태(user만 저장 등)로 UI를 덮어쓰지 않는다.
      if (activeStream.status === 'streaming' && activeStream.sessionId === sessionDetail.id) {
        return
      }

      // 스트리밍 완료 후: DB에 최종 assistant 메시지가 저장되었을 때만 동기화한다.
      if (pendingFinalSyncSessionId && sessionDetail.id === pendingFinalSyncSessionId) {
        const uiLen = messagesRef.current.length
        const last = dbMessages[dbMessages.length - 1]
        // "assistant로 끝난다"만으로는 부족함(이전 턴까지만 있어도 assistant로 끝날 수 있음).
        // 최소한 UI가 가진 메시지 수만큼 DB에 반영된 이후에만 동기화한다.
        if (last && last.role === 'assistant' && dbMessages.length >= uiLen) {
          setMessages(dbMessages)
          setLastLoadedSessionId(sessionDetail.id)
          setPendingFinalSyncSessionId(null)
          setViewSessionId(sessionDetail.id)
          return
        }

        // 아직 DB에 최종 assistant가 반영되지 않았으면 짧게 재조회(몇 번만)해서 동기화 기회를 만든다.
        // (그 사이 UI는 유지)
        if (finalSyncRetryRef.current.sessionId !== pendingFinalSyncSessionId) {
          finalSyncRetryRef.current = { sessionId: pendingFinalSyncSessionId, tries: 0 }
        }
        if (finalSyncTimerRef.current != null) {
          clearTimeout(finalSyncTimerRef.current)
          finalSyncTimerRef.current = null
        }
        if (finalSyncRetryRef.current.tries < 8) {
          finalSyncRetryRef.current.tries += 1
          finalSyncTimerRef.current = window.setTimeout(() => {
            void queryClient.refetchQueries({ queryKey: ['session', pendingFinalSyncSessionId] })
          }, 500)
        }
      }

      // 2) 같은 세션인 경우:
      //    - 아직 화면에 영구 메시지가 없으면(DB 초기 로드 등) DB로 교체
      //    - 이미 user/assistant 메시지가 있으면 그대로 유지 (스트리밍 완료 후 덮어쓰지 않음)
      setMessages((prev) => {
        // DB가 뒤처진 상태면(예: assistant 저장 전) 현재 UI를 유지한다.
        if (uiHasAssistant && dbMessages.length < prev.length) {
          return prev
        }
        const hasNonTemporary = prev.some(msg => !msg.isTemporary)
        if (!hasNonTemporary) {
          console.log('[DEBUG] No non-temporary messages yet, syncing from DB')
          setViewSessionId(sessionDetail.id)
          return dbMessages
        }
        console.log('[DEBUG] Keeping existing messages (same session, non-temporary present)')
        return prev
      })
    }
  }, [pendingFinalSyncSessionId, sessionDetail, stoppedSessionId, lastLoadedSessionId, queryClient])

  // 컴포넌트 언마운트 시 final sync 타이머 정리
  useEffect(() => {
    return () => {
      if (finalSyncTimerRef.current != null) {
        clearTimeout(finalSyncTimerRef.current)
        finalSyncTimerRef.current = null
      }
    }
  }, [])

  // 스트리밍 상태는 라우트 이동(언마운트) 이후에도 유지될 수 있으므로,
  // 전역 스트림 매니저에서 상태를 구독한다.
  useEffect(() => {
    const unsubscribe = chatStreamManager.subscribe((s) => {
      streamStateRef.current = s
      setStreamState(s)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useChatStreamSync({ streamState, selectedSessionId, viewSessionId, setMessages })

  // 스트리밍 종료 시(완료/오류/중단) 세션 목록/상세를 갱신하고 임시 플래그를 정리
  const prevStreamStatusRef = useRef(streamState.status)
  useEffect(() => {
    const prev = prevStreamStatusRef.current
    const next = streamState.status
    prevStreamStatusRef.current = next

    if (prev !== 'streaming' || next === 'streaming') return

    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    if (streamState.sessionId) {
      queryClient.refetchQueries({ queryKey: ['session', streamState.sessionId] })
    }

    if (next === 'completed' && streamState.sessionId) {
      setPendingFinalSyncSessionId(streamState.sessionId)
    }

    // 현재 화면에 보이는 임시 메시지는 일단 영구 표시로 전환
    setMessages((prevMessages) =>
      prevMessages.map((m) => ({
        ...m,
        isTemporary: false,
      }))
    )

    if (next === 'error' && streamState.error && streamState.sessionId && selectedSessionId === streamState.sessionId) {
      setMessages((prevMessages) => [
        ...prevMessages,
        { role: 'assistant', content: t('aiChat.errorAnswer', { error: streamState.error }) },
      ])
    }
  }, [queryClient, selectedSessionId, streamState.error, streamState.sessionId, streamState.status])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(scrollToBottom, [messages])

  // 외부 클릭 시 컨텍스트 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) {
        setContextMenu(null)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu])

  // ESC 키로 컨텍스트 메뉴 닫기
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && contextMenu) {
        setContextMenu(null)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  const handleStop = async () => {
    const snapshot = chatStreamManager.getState()
    if (!snapshot.sessionId || !snapshot.isStreaming) return

    console.log('[DEBUG] Stop button clicked. sessionId=', snapshot.sessionId)

    // 중단된 세션은 현재 UI 상태를 유지하기 위해 DB 동기화를 잠시 막는다.
    setStoppedSessionId(snapshot.sessionId)

    await chatStreamManager.stop()

    const assistantContent = snapshot.functionCallsContent + snapshot.assistantContent
    if (assistantContent) {
      try {
        // DB에 중단된 assistant 메시지만 저장 (user 메시지는 백엔드에서 이미 저장)
        console.log('[DEBUG] Saving stopped assistant message to DB')
        const response = await fetch(`/api/v1/sessions/${snapshot.sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            messages: [
              {
                role: 'assistant',
                content: assistantContent,
                tool_calls: snapshot.toolCalls && snapshot.toolCalls.length > 0 ? snapshot.toolCalls : undefined,
              },
            ],
          }),
        })

        if (response.status === 401) {
          handleUnauthorized()
          return
        }

        if (response.ok) {
          console.log('[DEBUG] Messages saved successfully')
          await queryClient.refetchQueries({ queryKey: ['session', snapshot.sessionId] })
          await queryClient.invalidateQueries({ queryKey: ['sessions'] })
        }
      } catch (error) {
        console.error('[ERROR] Failed to save stopped messages:', error)
      }
    }

    // 임시 플래그 제거하여 현재 화면에 유지
    setMessages((prev) => prev.map((msg) => ({ ...msg, isTemporary: false })))
  }

  const handleSend = async (messageToSend?: string) => {
    const message = messageToSend || input.trim()
    if (!message || isStreaming) return

    const userMessage = message
    const initialTitle = userMessage.length > 50 ? `${userMessage.slice(0, 50)}...` : userMessage

    // 중단 플래그 리셋
    setStoppedSessionId(null)
    setPendingFinalSyncSessionId(null)

    // 세션이 없으면(첫 질문) UI는 즉시 보여주고, 실제 세션 생성/스트리밍은 비동기로 이어서 처리
    const existingRealSessionId =
      selectedSessionId && !isTempSessionId(selectedSessionId) ? selectedSessionId : null

    const optimisticId =
      existingRealSessionId ?? `temp:${Date.now()}-${Math.random().toString(16).slice(2)}`

    if (!existingRealSessionId) {
      setSelectedSessionId(optimisticId)
      setViewSessionId(optimisticId)

      // 세션 목록이 아직 로딩 중이어도, 임시 세션을 즉시 목록에 노출
      const nowIso = new Date().toISOString()
      const optimisticSession: Session = {
        id: optimisticId,
        title: initialTitle || t('aiChat.newChatTitle'),
        created_at: nowIso,
        updated_at: nowIso,
        message_count: 0,
      }
      setPinnedSessions((prev) => ({ ...prev, [optimisticId]: optimisticSession }))
      upsertSessionAtFront(optimisticSession)
    }
    if (existingRealSessionId) {
      setViewSessionId(existingRealSessionId)
    }

    const newMessage: Message = {
      role: 'user',
      content: userMessage,
      isTemporary: true,  // 임시 메시지로 표시
    }

    // user 메시지와 빈 assistant 메시지를 동시에 추가
    setMessages((prev) => [
      ...prev,
      newMessage,
      { role: 'assistant', content: '', isTemporary: true, streamingPhase: 'waiting' }  // 로딩용 빈 메시지
    ])
    setInput('')

    const startStream = (sessionIdToUse: string) => {
      // 스트리밍 시작 (라우트 이동 후에도 유지)
      void chatStreamManager.startSessionChat(sessionIdToUse, userMessage).catch((error) => {
        console.error('[ERROR] Failed to start streaming:', error)
        setMessages((prev) => prev.filter((msg) => !msg.isTemporary))
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: t('aiChat.errorAnswer', { error: String(error) }) },
        ])
      })
    }

    if (existingRealSessionId) {
      startStream(existingRealSessionId)
      return
    }

    // 중요: 여기서 await 하면 React 18 batching 때문에 "대화방/말풍선 표시"가 네트워크 응답까지 지연될 수 있어
    // mutate + callback으로 비동기 작업을 분리한다.
    createSessionMutation.mutate(
      { title: initialTitle, optimisticId },
      {
        onSuccess: (newSession) => {
          // DB 동기화가 중간 상태로 덮어쓰지 않도록 먼저 스트리밍 상태를 올린다.
          startStream(newSession.id)

          // 사용자가 아직 이 임시 세션을 보고 있다면 실제 세션으로 전환
          setSelectedSessionId((current) => (current === optimisticId ? newSession.id : current))
          setViewSessionId((current) => (current === optimisticId ? newSession.id : current))
        },
        onError: (error) => {
          console.error('[ERROR] Failed to create session:', error)
          setSelectedSessionId((current) => (current === optimisticId ? null : current))
          setViewSessionId((current) => (current === optimisticId ? null : current))
          setPinnedSessions((prev) => {
            const next = { ...prev }
            delete next[optimisticId]
            return next
          })
          setMessages((prev) => prev.filter((msg) => !msg.isTemporary))
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: t('aiChat.errorSessionCreate', { error: String(error) }) },
          ])
        },
      },
    )
  }

  const handleNewChat = () => {
    // 세션을 미리 생성하지 않고, 선택만 해제 (첫 질문 시 자동 생성)
    setSelectedSessionId(null)
    setViewSessionId(null)
    setStoppedSessionId(null)
    setPendingFinalSyncSessionId(null)
    setPinnedSessions({})
    setMessages([])
  }

  const maybeFetchMoreSessions = (container: HTMLDivElement) => {
    if (!sessionsHasNextPage) return
    if (sessionsFetchingNextPage) return
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight
    // "바닥에 딱 닿았을 때"만 다음 페이지를 로드 (브라우저 반올림 오차 감안)
    if (remaining <= 1) {
      void fetchNextSessionsPage()
    }
  }

  const handleSessionsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget

    if (sessionsScrollRafRef.current != null) {
      cancelAnimationFrame(sessionsScrollRafRef.current)
    }

    sessionsScrollRafRef.current = requestAnimationFrame(() => {
      setSessionsScrollTop(container.scrollTop)
      maybeFetchMoreSessions(container)
      sessionsScrollRafRef.current = null
    })
  }

  const handleSelectSession = (sessionId: string) => {
    if (isMultiSelectMode) {
      // 다중 선택 모드에서는 체크박스 토글
      const newSelected = new Set(selectedSessionIds)
      if (newSelected.has(sessionId)) {
        newSelected.delete(sessionId)
      } else {
        newSelected.add(sessionId)
      }
      setSelectedSessionIds(newSelected)
    } else {
      // 같은 세션 재클릭 시 무시 — setSelectedSessionId(같은 값) 은 useQuery 재실행
      // 안 시키는데 setMessages([]) 만 실행되어 영원히 빈 화면이 되는 버그 방지.
      if (selectedSessionId === sessionId) return

      // 일반 모드에서는 세션 선택 + 중단 플래그 초기화
      setSelectedSessionId(sessionId)
      setViewSessionId(sessionId)
      setStoppedSessionId(null)
      setPendingFinalSyncSessionId(null)
      setMessages([])
    }
  }

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const isStreamingThisSession = isStreaming && streamState.sessionId === sessionId

    const ok = isStreamingThisSession
      ? confirm(t('aiChat.confirmDeleteStreaming'))
      : confirm(t('aiChat.confirmDelete'))

    if (!ok) return

    if (isStreamingThisSession) {
      await chatStreamManager.stop()
    }

    setStoppedSessionId(null)
    setPendingFinalSyncSessionId(null)
    setPinnedSessions((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null)
      setViewSessionId(null)
      setMessages([])
    }
    deleteSessionMutation.mutate(sessionId)
  }

  const handleToggleMultiSelect = () => {
    setIsMultiSelectMode(!isMultiSelectMode)
    setSelectedSessionIds(new Set())
  }

  const handleDeleteSelected = async () => {
    if (selectedSessionIds.size === 0) return

    const includesStreaming =
      isStreaming && !!streamState.sessionId && selectedSessionIds.has(streamState.sessionId)

    const ok = includesStreaming
      ? confirm(
          t('aiChat.confirmDeleteSelectedWithStreaming', { count: selectedSessionIds.size }),
        )
      : confirm(t('aiChat.confirmDeleteSelected', { count: selectedSessionIds.size }))

    if (ok) {
      if (includesStreaming) {
        await chatStreamManager.stop()
      }

      // 선택된 세션들을 순차적으로 삭제
      for (const sessionId of selectedSessionIds) {
        if (isTempSessionId(sessionId)) continue
        await deleteSessionMutation.mutateAsync(sessionId)
      }
      
      // 삭제 후 상태 초기화
      setSelectedSessionIds(new Set())
      setIsMultiSelectMode(false)
      
      // 현재 선택된 세션이 삭제되었으면 초기화
      if (selectedSessionId && selectedSessionIds.has(selectedSessionId)) {
        setSelectedSessionId(null)
        setViewSessionId(null)
        setStoppedSessionId(null)
        setPendingFinalSyncSessionId(null)
        setPinnedSessions({})
        setMessages([])
      }
    }
  }

  const handleSelectAll = () => {
    if (sessionsList.length > 0) {
      setSelectedSessionIds(new Set(sessionsList.map(s => s.id).filter((id) => !isTempSessionId(id))))
    }
  }

  const handleDeselectAll = () => {
    setSelectedSessionIds(new Set())
  }

  const handleEditSession = (session: Session, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
    setContextMenu(null)
  }

  const handleContextMenu = (session: Session, e: React.MouseEvent) => {
    if (isMultiSelectMode) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      sessionId: session.id,
    })
  }

  const handleCloseContextMenu = () => {
    setContextMenu(null)
  }

  const handleSaveEdit = (sessionId: string) => {
    if (editingTitle.trim()) {
      updateSessionMutation.mutate({ sessionId, title: editingTitle })
    }
  }

  const handleCancelEdit = () => {
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const quickQuestions = useMemo(
    () => (t('aiChat.quickQuestions', { returnObjects: true }) as string[]) || [],
    [t],
  )

  const handleCopyMessage = async (message: Message, key: string) => {
    try {
      await navigator.clipboard.writeText(stripToolDetails(message.content || ''))
      setCopiedMessageKey(key)
      setTimeout(() => {
        setCopiedMessageKey(curr => (curr === key ? null : curr))
      }, 1500)
    } catch (err) {
      console.warn('[AIChat] copy failed', err)
    }
  }

  const handleDownloadJson = async (message: Message) => {
    const sessionId = viewSessionId || selectedSessionId
    await exportToolCallsAsZip({
      message,
      sessionId,
      t,
      getCurrentMessages: () => messagesRef.current,
    })
  }

  return (
    <div className="flex h-screen">
      {/* 왼쪽 사이드바 - 세션 목록 */}
      <SessionSidebar
        sessionsList={sessionsList}
        sessionsLoading={sessionsLoading}
        sessionsHasNextPage={sessionsHasNextPage}
        sessionsFetchingNextPage={sessionsFetchingNextPage}
        fetchNextSessions={fetchNextSessionsPage}
        sessionsScrollRef={sessionsScrollRef}
        sessionsScrollTop={sessionsScrollTop}
        sessionsViewportHeight={sessionsViewportHeight}
        handleSessionsScroll={handleSessionsScroll}
        selectedSessionId={selectedSessionId}
        createSessionMutation={createSessionMutation}
        isMultiSelectMode={isMultiSelectMode}
        selectedSessionIds={selectedSessionIds}
        handleToggleMultiSelect={handleToggleMultiSelect}
        handleSelectAll={handleSelectAll}
        handleDeselectAll={handleDeselectAll}
        handleDeleteSelected={handleDeleteSelected}
        editingSessionId={editingSessionId}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        handleEditSession={handleEditSession}
        handleSaveEdit={handleSaveEdit}
        handleCancelEdit={handleCancelEdit}
        handleSelectSession={handleSelectSession}
        handleNewChat={handleNewChat}
        handleDeleteSession={handleDeleteSession}
        contextMenu={contextMenu}
        handleContextMenu={handleContextMenu}
        handleCloseContextMenu={handleCloseContextMenu}
        t={t}
      />

      {/* 오른쪽 채팅 영역 */}
      <div className="flex-1 flex flex-col">
        <div className="px-6 border-b border-slate-700 bg-slate-800 h-[100px] flex items-center">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-yellow-400" />
                {t('aiChat.title')}
              </h1>
              {aiConfig && (
                <span className="px-2.5 py-1 text-xs font-medium bg-primary-500/20 text-primary-400 rounded-full border border-primary-500/30">
                  {aiConfig.model}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-400">
              {t('aiChat.subtitle')}
            </p>
          </div>
        </div>

        {messages.length === 0 && (!selectedSessionId || isTempSessionId(selectedSessionId)) ? (
          <ChatWelcome
            emptyTitle={t('aiChat.emptyTitle')}
            emptySubtitle={t('aiChat.emptySubtitle')}
            questions={quickQuestions}
            onSelectQuestion={(q) => handleSend(q)}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {messages.map((message, idx) => (
              <div
                key={message.id != null ? `db-${message.id}` : `tmp-${idx}`}
                className={`flex gap-3 p-6 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.role === 'user'
                      ? 'bg-primary-500'
                      : 'bg-gradient-to-br from-purple-500 to-pink-500'
                  }`}
                >
                  {message.role === 'user' ? (
                    <User className="w-5 h-5 text-white" />
                  ) : (
                    <Bot className="w-5 h-5 text-white" />
                  )}
                </div>
                <div
                  className={`flex-1 p-4 rounded-lg prose prose-invert max-w-3xl overflow-x-auto ${
                    message.role === 'user'
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-700 text-slate-100'
                  }`}
                >
                  {(() => {
                    const hasContent = message.content && message.content.length > 0
                    
                    if (hasContent) {
                      // Tool call이 있고 답변 생성이 아직 시작되지 않았으면 로딩 점 추가
                      const hasToolCalls = message.content.includes('🔧') || message.content.includes('<summary>🔧')
                      const isWaitingForAnswer =
                        message.isTemporary &&
                        message.role === 'assistant' &&
                        (message.streamingPhase === 'waiting' || message.streamingPhase === 'tools')
                      
                      const messageKey = message.id != null ? `db-${message.id}` : `tmp-${idx}`
                      const showCopyButton = message.role === 'assistant' && !message.isTemporary
                      const isCopied = copiedMessageKey === messageKey
                      return (
                        <>
                          {(showCopyButton || (message.toolCalls && message.toolCalls.length > 0)) && (
                            <div className="flex justify-end gap-2 mb-2">
                              {showCopyButton && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleCopyMessage(message, messageKey)
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-slate-600 hover:bg-slate-500 text-slate-100"
                                  title={isCopied ? t('aiChat.copied') : t('aiChat.copyMessage')}
                                >
                                  {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                  <span>{isCopied ? t('aiChat.copied') : t('aiChat.copyMessage')}</span>
                                </button>
                              )}
                              {message.toolCalls && message.toolCalls.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleDownloadJson(message)
                                  }}
                                  className="px-2.5 py-1 text-xs rounded bg-slate-600 hover:bg-slate-500 text-slate-100"
                                >
                                  {t('aiChat.resultZipDownload')}
                                </button>
                              )}
                            </div>
                          )}
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw]}
                          >
                            {message.role === 'assistant'
                              ? truncateToolResultsInContent(message.content)
                              : message.content}
                          </ReactMarkdown>
                          {hasToolCalls && isWaitingForAnswer && (
                            <div className="flex gap-2 items-center py-3 mt-4">
                              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                              <div
                                className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                                style={{ animationDelay: '0.1s' }}
                              />
                              <div
                                className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                                style={{ animationDelay: '0.2s' }}
                              />
                            </div>
                          )}
                        </>
                      )
                    } else if (message.role === 'assistant') {
                      return (
                        <div className="flex gap-2 items-center py-1">
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                          <div
                            className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                            style={{ animationDelay: '0.1s' }}
                          />
                          <div
                            className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                            style={{ animationDelay: '0.2s' }}
                          />
                        </div>
                      )
                    }
                    return null
                  })()}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        <MessageInput
          value={input}
          onChange={setInput}
          onSubmit={() => handleSend()}
          onStop={handleStop}
          isStreaming={isStreaming}
          placeholder={t('aiChat.inputPlaceholder')}
          sendLabel={t('aiChat.send')}
          stopLabel={t('aiChat.stop')}
        />
      </div>
    </div>
  )
}
