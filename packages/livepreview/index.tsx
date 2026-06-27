import React from 'react'
import { ArrowLeft, FileCode, Globe, MonitorPlay, X } from 'lucide-react'
import type { AppManifest, AppTabProps } from '@binder/app-sdk'
import PageHeader from '../../app/frontend/src/components/shared/PageHeader'
import Preview from '../../app/frontend/src/components/Preview'
import { invoke } from '../../app/frontend/src/lib/ipc'
import {
  type LivePreviewEntry, useLivePreviews, useActiveLivePreviewKey,
  openLivePreview, closeLivePreview, selectLivePreview,
} from '../../app/frontend/src/lib/livePreviewStore'

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

function LivePreviewPage({ previews, activeKey, onSelect, onClose, onBackToList }: Props) {
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

const LivePreviewIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

function LivePreviewAdapter(_props: AppTabProps) {
  const previews  = useLivePreviews()
  const activeKey = useActiveLivePreviewKey()
  return (
    <LivePreviewPage
      previews={previews}
      activeKey={activeKey}
      onSelect={selectLivePreview}
      onClose={closeLivePreview}
      onBackToList={() => selectLivePreview(null)}
    />
  )
}

// Opens a local .md/.html file in the live preview, starting the host's
// preview server first. Triggered from the file-explorer contribution below.
async function openFilePreview(path: string): Promise<void> {
  const result = await invoke<{ url: string; ok: boolean }>('preview.start').catch(() => null)
  if (!result?.url) return
  const urlPath = path.replace(/\\/g, '/')
  const url = result.url + (urlPath.startsWith('/') ? urlPath : '/' + urlPath)
  openLivePreview({ type: 'html', url, path })
  window.dispatchEvent(new CustomEvent('apps:navigate', { detail: { pageId: 'livepreview' } }))
}

const livePreviewApp: AppManifest = {
  id: 'livepreview',
  name: 'Live Preview',
  description: 'Preview .md/.html files and forwarded URLs/ports without leaving the app.',
  author: 'BinderTools',
  version: '1.0.0',
  tabType: 'livepreview',
  tabTitle: 'Live Preview',
  TabComponent: LivePreviewAdapter,
  sidebar: { icon: LivePreviewIcon, label: 'Live Preview' },
  contributes: {
    fileExplorerContextMenu: ({ path, ext, isDir }) => {
      if (isDir) return null
      if (ext !== 'md' && ext !== 'markdown' && ext !== 'html' && ext !== 'htm') return null
      return [{ label: 'Open Live Preview', action: () => void openFilePreview(path) }]
    },
  },
}

export default livePreviewApp
