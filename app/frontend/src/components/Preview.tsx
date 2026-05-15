import React, { useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './Preview.css'

type PreviewType = 'markdown' | 'html' | 'url'

interface Props {
  previewType: PreviewType
  src: string      // file content (md/html) or URL
  path: string     // display label — file path or URL
}

// ── icons ──────────────────────────────────────────────────────────────────
const MdIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4 10V6l2 2 2-2v4M11 10V6M9.5 8H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const HtmlIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M4 3L1 8l3 5M12 3l3 5-3 5M9 2l-2 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const WebIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M8 1.5C8 1.5 5.5 4 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 4 10.5 8s-2.5 6.5-2.5 6.5M1.5 8h13" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
)

const RefreshIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 4.4 2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M10 2h3.5V5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function Preview({ previewType, src, path }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const displayLabel = previewType === 'url' ? src : path

  const Icon = previewType === 'markdown' ? MdIcon
             : previewType === 'html'     ? HtmlIcon
             :                             WebIcon

  const handleRefresh = () => {
    if (iframeRef.current) {
      if (previewType === 'html') {
        iframeRef.current.srcdoc = src
      } else if (previewType === 'url') {
        iframeRef.current.src = src
      }
    }
  }

  return (
    <div className="preview-container">
      {/* Info bar */}
      <div className="editor-filepath preview-infobar">
        <Icon />
        <span className="preview-infobar__label">{displayLabel}</span>
        {(previewType === 'html' || previewType === 'url') && (
          <button className="preview-infobar__refresh" onClick={handleRefresh} title="Refresh">
            <RefreshIcon />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="preview-body">
        {previewType === 'markdown' && (
          <div className="preview-md-scroll">
            <div className="preview-md-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{src}</ReactMarkdown>
            </div>
          </div>
        )}

        {previewType === 'html' && (
          <iframe
            ref={iframeRef}
            className="preview-iframe"
            srcDoc={src}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
            title="HTML Preview"
          />
        )}

        {previewType === 'url' && (
          <iframe
            ref={iframeRef}
            className="preview-iframe"
            src={src}
            sandbox="allow-scripts allow-forms allow-modals"
            title="URL Preview"
          />
        )}
      </div>
    </div>
  )
}
