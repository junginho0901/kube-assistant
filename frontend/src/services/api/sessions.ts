// Sessions API — chat session list / detail (cursor-paginated).
// Backed by the session-service.

import { client } from './client'
import type { Session, SessionDetail } from './types'

export const sessionsApi = {
  getSessions: async (params?: {
    limit?: number
    offset?: number
    before_updated_at?: string
    before_id?: string
  }): Promise<Session[]> => {
    const { data } = await client.get('/sessions', { params })
    return data
  },

  createSession: async (title?: string): Promise<Session> => {
    const { data } = await client.post('/sessions', { title })
    return data
  },

  getSession: async (sessionId: string): Promise<SessionDetail> => {
    const { data } = await client.get(`/sessions/${sessionId}`)
    return data
  },

  updateSession: async (sessionId: string, title: string): Promise<Session> => {
    const { data } = await client.patch(`/sessions/${sessionId}`, { title })
    return data
  },

  deleteSession: async (sessionId: string): Promise<void> => {
    await client.delete(`/sessions/${sessionId}`)
  },
}
