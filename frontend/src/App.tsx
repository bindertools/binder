import React, { useReducer, useEffect, useRef, useState } from 'react'
import TabBar from './components/TabBar'
import Terminal from './components/Terminal'
import Editor from './components/Editor'
import { Tab, OpenFilePayload, AppConfig } from './types'
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime'
import { GetAppConfig } from '../wailsjs/go/main/App'
import './App.css'

let tabCounter = 0
const nextId = () => `tab-${++tabCounter}`

function makeTerminalTab(): Tab {
  return { id: nextId(), type: 'terminal', title: 'terminal' }
}

type TabState = { tabs: Tab[]; activeId: string }
type TabAction =
  | { type: 'add-terminal' }
  | { type: 'open-file'; payload: OpenFilePayload }
  | { type: 'close'; id: string }
  | { type: 'select'; id: string }

function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case 'add-terminal': {
      const tab = makeTerminalTab()
      return { tabs: [...state.tabs, tab], activeId: tab.id }
    }

    case 'open-file': {
      const { payload } = action
      const existing = state.tabs.find(
        t => t.type === 'editor' && t.filePath === payload.path
      )
      if (existing) return { ...state, activeId: existing.id }

      const fileName =
        payload.path.replace(/\\/g, '/').split('/').pop() ?? payload.path
      const tab: Tab = {
        id: nextId(),
        type: 'editor',
        title: fileName,
        filePath: payload.path,
        content: payload.content,
        language: payload.language,
        parentId: payload.terminalId,
      }

      const newTabs = [...state.tabs]
      if (payload.terminalId) {
        let insertIdx = newTabs.length
        for (let i = newTabs.length - 1; i >= 0; i--) {
          if (newTabs[i].id === payload.terminalId || newTabs[i].parentId === payload.terminalId) {
            insertIdx = i + 1
            break
          }
        }
        newTabs.splice(insertIdx, 0, tab)
      } else {
        newTabs.push(tab)
      }
      return { tabs: newTabs, activeId: tab.id }
    }

    case 'close': {
      if (state.tabs.length <= 1) return state
      const idx = state.tabs.findIndex(t => t.id === action.id)
      const newTabs = state.tabs.filter(t => t.id !== action.id)
      const newActiveId =
        state.activeId === action.id
          ? newTabs[Math.min(idx, newTabs.length - 1)].id
          : state.activeId
      return { tabs: newTabs, activeId: newActiveId }
    }

    case 'select':
      return { ...state, activeId: action.id }

    default:
      return state
  }
}

const defaultConfig: AppConfig = {
  default_directory: '',
  indent_guides: false,
  order_directory: false,
}

const initialTab = makeTerminalTab()
const initialState: TabState = { tabs: [initialTab], activeId: initialTab.id }

export default function App() {
  const [state, dispatch] = useReducer(tabReducer, initialState)
  const { tabs, activeId } = state

  const [appConfig, setAppConfig] = useState<AppConfig>(defaultConfig)

  // Load config on mount
  useEffect(() => {
    GetAppConfig().then(cfg => setAppConfig(cfg as AppConfig)).catch(() => {})
  }, [])

  // Listen for config --reload events
  useEffect(() => {
    EventsOn('app:config', (cfg: AppConfig) => setAppConfig(cfg))
    return () => EventsOff('app:config')
  }, [])

  // Wire up open-file event from Go
  useEffect(() => {
    EventsOn('app:open-file', (...args: any[]) => {
      const payload = args[0] as OpenFilePayload
      if (!payload?.path || payload.content === undefined) return
      dispatch({ type: 'open-file', payload })
    })
    return () => EventsOff('app:open-file')
  }, [])

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={id => dispatch({ type: 'select', id })}
        onClose={id => dispatch({ type: 'close', id })}
        onNewTerminal={() => dispatch({ type: 'add-terminal' })}
      />
      <div className="app__content">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="app__pane"
            style={{ display: tab.id === activeId ? 'flex' : 'none' }}
          >
            {tab.type === 'terminal' ? (
              <Terminal tabId={tab.id} active={tab.id === activeId} />
            ) : (
              <Editor
                tabId={tab.id}
                filePath={tab.filePath!}
                content={tab.content ?? ''}
                language={tab.language ?? 'plaintext'}
                active={tab.id === activeId}
                indentGuides={appConfig.indent_guides}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
