import React from 'react'
import { ArrowLeft, FileCode, Globe, MonitorPlay, X } from 'lucide-react'
import PageHeader from './shared/PageHeader'
import Preview from './Preview'

export interface LivePreviewEntry {
  key:   string   // file path (md/html) or remote URL — also the de-dup key
  type:  'markdown' | 'html' | 'url'
  src:   string    // content, local-server URL, or remote URL
  title: string
}

interface Props {
  previews: LivePreviewEntry[]
  activeKey: string | null
  onSelect: (key: string) => void
  onClose: (key: string) => void
  onBackToList: () => void
}

function entryIcon(type: LivePreviewEntry['type']) {
  if (type === 'url') return <Globe size={15} strokeWidth={1.5} />
  return <FileCode size={15} strokeWidth={1.5} />
}

export default function LivePreviewPage({ previews, activeKey, onSelect, onClose, onBackToList }: Props) {
  const active = activeKey ? previews.find(p => p.key === activeKey) : undefined

  if (active) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-color)] shrink-0">
          <button
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border-0 bg-transparent cursor-pointer text-[12px] text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised transition-colors"
            onClick={onBackToList}
          >
            <ArrowLeft size={13} strokeWidth={1.5} />
            All Previews
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <Preview previewType={active.type} src={active.src} path={active.key} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Live Preview" subtitle="Local .md/.html files and forwarded URLs currently open for preview" />
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {previews.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 h-full text-center opacity-50 select-none">
            <MonitorPlay size={32} strokeWidth={1.3} />
            <div className="text-[13px] text-[var(--info-bar-color)]">No live previews running</div>
            <div className="text-[11.5px] text-[var(--info-bar-color)] max-w-[320px]">
              Right-click a .md or .html file in the file explorer, or run <code>/preview &lt;path|url|port&gt;</code> in a terminal.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {previews.map(p => (
              <div
                key={p.key}
                className="group flex items-center gap-2.5 px-3 py-2.5 rounded-md border border-[var(--border-color)] bg-surface-raised cursor-pointer hover:bg-surface-overlay transition-colors"
                onClick={() => onSelect(p.key)}
              >
                <span className="shrink-0 text-[var(--tab-color)]">{entryIcon(p.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] truncate text-[var(--info-bar-hover-color)]">{p.title}</div>
                  <div className="text-[10.5px] truncate font-mono text-[var(--info-bar-color)] opacity-60">{p.key}</div>
                </div>
                <button
                  className="shrink-0 w-[20px] h-[20px] rounded flex items-center justify-center text-[var(--tab-color)] opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-surface-overlay hover:text-[var(--tab-color-hover)] transition-[opacity,background] duration-[70ms]"
                  onClick={e => { e.stopPropagation(); onClose(p.key) }}
                  title="Stop preview"
                >
                  <X size={12} strokeWidth={1.6} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
