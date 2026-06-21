import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  open:      boolean
  onCreate:  (forward: {
    name: string
    protocol: 'tcp' | 'udp' | 'both'
    listen_port: number
    target_host: string
    target_port: number
    enabled: boolean
  }) => void
  onDismiss: () => void
}

export default function NewPortForwardModal({ open, onCreate, onDismiss }: Props) {
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<'tcp' | 'udp' | 'both'>('tcp')
  const [listenPort, setListenPort] = useState('')
  const [targetHost, setTargetHost] = useState('127.0.0.1')
  const [targetPort, setTargetPort] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (open) {
      setName('')
      setProtocol('tcp')
      setListenPort('')
      setTargetHost('127.0.0.1')
      setTargetPort('')
      setEnabled(true)
    }
  }, [open])

  if (!open) return null

  const listenPortNum = Number(listenPort)
  const targetPortNum = Number(targetPort)
  const canCreate =
    name.trim() !== '' &&
    targetHost.trim() !== '' &&
    Number.isInteger(listenPortNum) && listenPortNum > 0 && listenPortNum <= 65535 &&
    Number.isInteger(targetPortNum) && targetPortNum > 0 && targetPortNum <= 65535

  const handleCreate = () => {
    if (!canCreate) return
    onCreate({
      name: name.trim(),
      protocol,
      listen_port: listenPortNum,
      target_host: targetHost.trim(),
      target_port: targetPortNum,
      enabled,
    })
  }

  return ReactDOM.createPortal(
    <>
      <div className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-[2px]" onClick={onDismiss} />

      <div className="fixed z-[10001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[96vw] bg-[var(--info-bar-bg)] border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-overlay)] flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <span className="text-[13px] font-semibold text-[var(--tab-color-hover)]">New Port Forward</span>
          <button
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--tab-color)] hover:bg-surface-raised hover:text-[var(--tab-color-hover)] transition-colors"
            onClick={onDismiss}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Name</span>
            <input
              autoFocus
              value={name}
              placeholder="e.g. Dev server"
              onChange={e => setName(e.target.value)}
              className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] text-[var(--tab-color-hover)] outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Protocol</span>
            <select
              value={protocol}
              onChange={e => setProtocol(e.target.value as 'tcp' | 'udp' | 'both')}
              className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] text-[var(--tab-color-hover)] outline-none focus:border-accent"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="both">TCP + UDP</option>
            </select>
          </label>

          <div className="flex gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Listen port</span>
              <input
                value={listenPort}
                placeholder="8080"
                inputMode="numeric"
                onChange={e => setListenPort(e.target.value.replace(/[^0-9]/g, ''))}
                className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] font-mono text-[var(--tab-color-hover)] outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Target port</span>
              <input
                value={targetPort}
                placeholder="3000"
                inputMode="numeric"
                onChange={e => setTargetPort(e.target.value.replace(/[^0-9]/g, ''))}
                className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] font-mono text-[var(--tab-color-hover)] outline-none focus:border-accent"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Target host</span>
            <input
              value={targetHost}
              placeholder="127.0.0.1"
              onChange={e => setTargetHost(e.target.value)}
              className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] font-mono text-[var(--tab-color-hover)] outline-none focus:border-accent"
            />
            <span className="text-[10px] text-[var(--tab-color)] opacity-45">
              Relayed locally on this machine only. Does not touch router or NAT port forwarding.
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="cursor-pointer"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="text-[12px] text-[var(--tab-color-hover)]">Start immediately</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
          <button
            className="px-3.5 h-7 rounded-md bg-transparent text-[var(--tab-color)] text-[12px] font-medium cursor-pointer border border-[var(--border-color)] hover:bg-surface-raised transition-colors duration-[100ms]"
            onClick={onDismiss}
          >
            Cancel
          </button>
          <button
            className="px-3.5 h-7 rounded-md bg-accent text-white text-[12px] font-medium cursor-pointer border-0 hover:bg-accent-hover transition-colors duration-[100ms] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleCreate}
            disabled={!canCreate}
          >
            Create
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
