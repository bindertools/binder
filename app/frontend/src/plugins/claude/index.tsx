import React, { useEffect, useRef, useState } from 'react'
import type { Plugin, PluginTabProps } from '@cmdide/plugin-sdk'
import './claude.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function renderMessage(text: string, onRun?: (code: string) => void): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  const matches = [...text.matchAll(/```(\w*)\n?([\s\S]*?)```/g)]
  if (matches.length === 0) return text

  for (const m of matches) {
    if (m.index! > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>)
    const code = m[2].trim()
    parts.push(
      <div key={m.index} className="claude-code">
        <pre className="claude-code__pre">{code}</pre>
        {onRun && (
          <button className="claude-code__run" onClick={() => onRun(code)}>
            ▶ Run in terminal
          </button>
        )}
      </div>
    )
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>)
  return parts
}

function ClaudeTab({ context }: PluginTabProps) {
  const { executeCommand } = context
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem('claude:api-key') ?? '' } catch { return '' }
  })
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showKey, setShowKey] = useState(!apiKey)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const saveKey = (k: string) => {
    setApiKey(k)
    try { localStorage.setItem('claude:api-key', k) } catch {}
    setShowKey(false)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !apiKey || loading) return
    setInput('')
    const newMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const data = await res.json()
      const reply = data.content?.[0]?.text ?? ''
      setMessages([...newMessages, { role: 'assistant', content: reply }])
    } catch (e: any) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleRun = (code: string) => {
    if (executeCommand) executeCommand(code)
  }

  if (showKey) {
    return (
      <div className="claude claude--setup">
        <div className="claude__setup-card">
          <div className="claude__setup-title">Claude API Key</div>
          <div className="claude__setup-desc">Enter your Anthropic API key to enable Claude chat.</div>
          <input
            className="claude__key-input"
            type="password"
            placeholder="sk-ant-…"
            onKeyDown={e => { if (e.key === 'Enter') saveKey((e.target as HTMLInputElement).value) }}
          />
          <button className="claude__save-key" onClick={e => {
            const input = (e.currentTarget.parentElement?.querySelector('.claude__key-input') as HTMLInputElement)
            if (input?.value) saveKey(input.value)
          }}>Save key</button>
        </div>
      </div>
    )
  }

  return (
    <div className="claude">
      <div className="claude__header">
        <span className="claude__title">Claude</span>
        <button className="claude__key-btn" onClick={() => setShowKey(true)} title="Change API key">key</button>
        {messages.length > 0 && (
          <button className="claude__clear" onClick={() => setMessages([])}>clear</button>
        )}
      </div>
      <div className="claude__messages">
        {messages.length === 0 && (
          <div className="claude__welcome">Ask Claude anything. Code suggestions can run directly in your terminal.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`claude__msg claude__msg--${m.role}`}>
            <div className="claude__msg-content">
              {m.role === 'assistant'
                ? renderMessage(m.content, executeCommand ? handleRun : undefined)
                : m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="claude__msg claude__msg--assistant">
            <div className="claude__typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="claude__input-row">
        <textarea
          className="claude__input"
          placeholder="Ask Claude…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={2}
        />
        <button className="claude__send" onClick={send} disabled={!input.trim() || loading}>
          {loading ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}

const claudePlugin: Plugin = {
  id: 'claude',
  name: 'Claude AI',
  description: 'Chat with Claude directly in the IDE. Clickable code suggestions run in your terminal.',
  author: 'built-in',
  version: '1.0.0',
  tabType: 'claude',
  tabTitle: 'claude',
  TabComponent: ClaudeTab,
  checkRequirements: () => null,
}

export default claudePlugin
