import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Send, Loader2, Plus, Trash2, MessageCircle } from 'lucide-react'
import type { ChatConversation, ChatMessage } from '@shared/models'
import { api } from '@renderer/lib/api'

interface ChatDrawerProps {
  projectId: string
  onClose: () => void
}

export default function ChatDrawer({ projectId, onClose }: ChatDrawerProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const loadConversations = useCallback(async () => {
    const list = await api.chat.listConversations(projectId)
    setConversations(list)
    return list
  }, [projectId])

  useEffect(() => {
    loadConversations().then((list) => {
      if (list.length > 0) {
        setActiveConversationId(list[0].id)
      }
    })
  }, [loadConversations])

  useEffect(() => {
    if (activeConversationId) {
      api.chat.listMessages(activeConversationId).then(setMessages)
    } else {
      setMessages([])
    }
  }, [activeConversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamedContent])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeConversationId])

  async function handleNewConversation() {
    const conv = await api.chat.createConversation({
      projectId,
      title: 'New Chat',
    })
    setConversations((prev) => [conv, ...prev])
    setActiveConversationId(conv.id)
    setMessages([])
  }

  async function handleDeleteConversation(id: number) {
    await api.chat.deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeConversationId === id) {
      setActiveConversationId(null)
      setMessages([])
    }
  }

  async function handleSend() {
    if (!input.trim() || sending || !activeConversationId) return

    const content = input.trim()
    setInput('')
    setSending(true)

    try {
      // Save user message
      const userMsg = await api.chat.sendMessage({
        conversationId: activeConversationId,
        role: 'user',
        content,
      })
      setMessages((prev) => [...prev, userMsg])

      // Call AI via OpenRouter
      const config = (await window.api.invoke('settings:get')) as {
        openRouterKey?: string
        chatModel?: string
      } | undefined
      const apiKey = config?.openRouterKey
      const model = config?.chatModel || 'anthropic/claude-sonnet-4-20250514'

      if (!apiKey) {
        const errorMsg = await api.chat.sendMessage({
          conversationId: activeConversationId,
          role: 'assistant',
          content: 'Please configure your OpenRouter API key in Settings to use chat.',
        })
        setMessages((prev) => [...prev, errorMsg])
        return
      }

      // Build message history for context
      const history = [...messages, userMsg].map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }))

      // Assemble project context with RAG search
      let systemPrompt: string
      try {
        systemPrompt = await window.api.invoke('chat:getContext', projectId, content) as string
      } catch {
        systemPrompt = 'You are a helpful coding assistant integrated into CodeFire. Be concise and helpful.'
      }

      setStreaming(true)
      setStreamedContent('')

      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.slice(-20),
          ],
          stream: true,
        }),
      })

      if (!resp.ok || !resp.body) {
        throw new Error(`API error: ${resp.status}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))

        for (const line of lines) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              fullContent += delta
              setStreamedContent(fullContent)
            }
          } catch { /* ignore parse errors in stream */ }
        }
      }

      setStreaming(false)
      setStreamedContent('')

      if (fullContent) {
        const assistantMsg = await api.chat.sendMessage({
          conversationId: activeConversationId,
          role: 'assistant',
          content: fullContent,
        })
        setMessages((prev) => [...prev, assistantMsg])
      }
    } catch (err) {
      console.error('Chat error:', err)
      setStreaming(false)
      setStreamedContent('')
    } finally {
      setSending(false)
    }
  }

  const activeConversation = conversations.find((c) => c.id === activeConversationId)

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] z-50 flex flex-col bg-neutral-900/95 backdrop-blur-xl border-l border-neutral-700 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle size={16} className="text-codefire-orange" />
          <span className="text-sm font-medium text-neutral-200">Chat</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewConversation}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
            title="New conversation"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Conversation list (collapsed) */}
      {conversations.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-neutral-800 overflow-x-auto scrollbar-none shrink-0">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConversationId(conv.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] whitespace-nowrap transition-colors shrink-0 group ${
                conv.id === activeConversationId
                  ? 'bg-neutral-800 text-neutral-200'
                  : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
              }`}
            >
              <span className="truncate max-w-24">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteConversation(conv.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-neutral-600 hover:text-red-400 transition-all"
              >
                <Trash2 size={10} />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {!activeConversationId ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle size={32} className="text-neutral-700 mb-3" />
            <p className="text-sm text-neutral-500 mb-3">Start a conversation</p>
            <button
              onClick={handleNewConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-codefire-orange/20 text-codefire-orange rounded hover:bg-codefire-orange/30 transition-colors"
            >
              <Plus size={12} />
              New Chat
            </button>
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle size={24} className="text-neutral-700 mb-2" />
            <p className="text-xs text-neutral-600">
              {activeConversation?.title || 'Ask anything about your project'}
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}
            {streaming && streamedContent && (
              <ChatBubble role="assistant" content={streamedContent} />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {activeConversationId && (
        <div className="px-3 py-3 border-t border-neutral-800 shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              rows={1}
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-codefire-orange/50 resize-none max-h-24"
              placeholder="Ask something..."
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="px-3 py-2 bg-codefire-orange/20 text-codefire-orange rounded-lg hover:bg-codefire-orange/30 transition-colors disabled:opacity-40 self-end"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? 'bg-codefire-orange/20 text-neutral-200'
            : 'bg-neutral-800 text-neutral-300 border border-neutral-700/50'
        }`}
      >
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}
