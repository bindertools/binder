import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  open:            boolean
  existingFiles:   string[]
  onCreate:        (file: string, content: string) => void
  onDismiss:       () => void
}

type Trigger = 'push' | 'pull_request' | 'workflow_dispatch'

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow'

function buildYaml(name: string, trigger: Trigger, branch: string, job: string, runsOn: string): string {
  const on = trigger === 'push'
    ? `on:\n  push:\n    branches: [${branch || 'main'}]`
    : trigger === 'pull_request'
      ? `on:\n  pull_request:\n    branches: [${branch || 'main'}]`
      : `on:\n  workflow_dispatch: {}`

  return [
    `name: ${name}`,
    ``,
    on,
    ``,
    `jobs:`,
    `  ${job}:`,
    `    runs-on: ${runsOn}`,
    `    steps:`,
    `      - uses: actions/checkout@v4`,
    `      - name: Run`,
    `        run: echo "Hello from ${name}"`,
    ``,
  ].join('\n')
}

export default function NewWorkflowModal({ open, existingFiles, onCreate, onDismiss }: Props) {
  const [name,    setName]    = useState('New Workflow')
  const [trigger, setTrigger] = useState<Trigger>('push')
  const [branch,  setBranch]  = useState('main')
  const [job,     setJob]     = useState('build')
  const [runsOn,  setRunsOn]  = useState('ubuntu-latest')
  const [fileEdited, setFileEdited] = useState(false)
  const [file,    setFile]    = useState('new-workflow.yml')

  useEffect(() => {
    if (open) {
      setName('New Workflow')
      setTrigger('push')
      setBranch('main')
      setJob('build')
      setRunsOn('ubuntu-latest')
      setFileEdited(false)
      setFile('new-workflow.yml')
    }
  }, [open])

  useEffect(() => {
    if (!fileEdited) setFile(`${slugify(name)}.yml`)
  }, [name, fileEdited])

  if (!open) return null

  const fileTaken = existingFiles.includes(file)
  const canCreate = name.trim() !== '' && file.trim() !== '' && job.trim() !== '' && runsOn.trim() !== '' && !fileTaken

  const handleCreate = () => {
    if (!canCreate) return
    onCreate(file, buildYaml(name.trim(), trigger, branch.trim(), job.trim(), runsOn.trim()))
  }

  return ReactDOM.createPortal(
    <>
      <div className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-[2px]" onClick={onDismiss} />

      <div className="fixed z-[10001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[96vw] bg-[var(--info-bar-bg)] border border-[var(--border-color)] rounded-xl flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <span className="text-[13px] font-semibold text-[var(--tab-color-hover)]">New Workflow</span>
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
              onChange={e => setName(e.target.value)}
              className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] text-[var(--tab-color-hover)] outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">File</span>
            <input
              value={file}
              onChange={e => { setFile(e.target.value); setFileEdited(true) }}
              className={`h-8 px-2.5 rounded-md bg-[var(--app-bg)] border text-[12.5px] font-mono text-[var(--tab-color-hover)] outline-none focus:border-accent ${fileTaken ? 'border-[var(--color-error)]' : 'border-[var(--border-color)]'}`}
            />
            <span className="text-[10px] text-[var(--tab-color)] opacity-45">.github/workflows/{file || '…'}</span>
            {fileTaken && <span className="text-[10.5px] text-[var(--color-error)]">A workflow with this file name already exists.</span>}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Trigger</span>
            <select
              value={trigger}
              onChange={e => setTrigger(e.target.value as Trigger)}
              className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] text-[var(--tab-color-hover)] outline-none focus:border-accent"
            >
              <option value="push">On push</option>
              <option value="pull_request">On pull request</option>
              <option value="workflow_dispatch">Manual (workflow_dispatch)</option>
            </select>
          </label>

          {trigger !== 'workflow_dispatch' && (
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Branch</span>
              <input
                value={branch}
                onChange={e => setBranch(e.target.value)}
                className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] font-mono text-[var(--tab-color-hover)] outline-none focus:border-accent"
              />
            </label>
          )}

          <div className="flex gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Job name</span>
              <input
                value={job}
                onChange={e => setJob(e.target.value)}
                className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] font-mono text-[var(--tab-color-hover)] outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-55">Runs on</span>
              <input
                value={runsOn}
                onChange={e => setRunsOn(e.target.value)}
                className="h-8 px-2.5 rounded-md bg-[var(--app-bg)] border border-[var(--border-color)] text-[12.5px] font-mono text-[var(--tab-color-hover)] outline-none focus:border-accent"
              />
            </label>
          </div>
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
