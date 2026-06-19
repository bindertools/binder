import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { parseWorkflowYaml, type WorkflowJobNode } from '../lib/workflowGraph'
import type { WorkflowStepEvent } from '../lib/workflows'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

interface Props {
  content:     string
  loading:     boolean
  /** Step results from the most recent run, used to overlay live/last-run
   *  status onto each step instead of just listing them inertly. */
  stepEvents?: WorkflowStepEvent[]
  /** Jumps the code editor to a specific line of the workflow file — wired
   *  up to the edit-pencil and add-step buttons throughout the map. */
  onEdit?:     (line: number) => void
}

interface RowJob {
  job:        WorkflowJobNode
  isTerminal: boolean
  /** Needs that aren't satisfied by the row directly above — shown as text,
   *  since a drawn line spanning past another row is what caused the
   *  original overlap bug. */
  farNeeds:   string[]
}

/** Layers jobs into rows via Kahn's algorithm: row 0 is every job with no
 *  unresolved `needs`, row 1 is everything that becomes unblocked once row 0
 *  is "done", and so on. A job's row is the number of waves it took to
 *  unblock it, which is the same shape of answer as a longest-path search
 *  but reached by repeatedly peeling off the current frontier instead of
 *  recursing — there's no shared code with the depth-first version this
 *  replaced. */
function buildRows(jobs: WorkflowJobNode[]): RowJob[][] {
  const byId = new Map(jobs.map(j => [j.id, j]))
  const remaining = new Map(jobs.map(j => [j.id, j.needs.filter(d => byId.has(d)).length]))
  const dependents = new Map<string, string[]>()
  for (const j of jobs) {
    for (const dep of j.needs) {
      if (!byId.has(dep)) continue
      if (!dependents.has(dep)) dependents.set(dep, [])
      dependents.get(dep)!.push(j.id)
    }
  }

  const row = new Map<string, number>()
  let frontier = jobs.filter(j => remaining.get(j.id) === 0).map(j => j.id)
  let r = 0
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      row.set(id, r)
      for (const dep of dependents.get(id) ?? []) {
        const left = (remaining.get(dep) ?? 0) - 1
        remaining.set(dep, left)
        if (left === 0) next.push(dep)
      }
    }
    frontier = next
    r++
  }

  const reliedOn = new Set<string>()
  jobs.forEach(j => j.needs.forEach(d => reliedOn.add(d)))

  const rowCount = row.size > 0 ? Math.max(...row.values()) + 1 : 0
  const rows: RowJob[][] = Array.from({ length: rowCount }, () => [])
  for (const j of jobs) {
    const r2 = row.get(j.id) ?? 0
    rows[r2].push({
      job: j,
      isTerminal: !reliedOn.has(j.id),
      farNeeds: j.needs.filter(d => (row.get(d) ?? 0) !== r2 - 1),
    })
  }
  return rows
}

interface Point { x: number; y: number }
interface Wire { from: Point; to: Point }

function topCenter(el: HTMLElement, origin: HTMLElement): Point {
  const r = el.getBoundingClientRect()
  const o = origin.getBoundingClientRect()
  return { x: r.left - o.left + r.width / 2, y: r.top - o.top }
}

function bottomCenter(el: HTMLElement, origin: HTMLElement): Point {
  const r = el.getBoundingClientRect()
  const o = origin.getBoundingClientRect()
  return { x: r.left - o.left + r.width / 2, y: r.bottom - o.top }
}

/** Per-job, per-step-index status from the latest run, so the map can show
 *  real outcomes instead of static placeholders. */
function buildStepStatus(stepEvents: WorkflowStepEvent[] | undefined) {
  const byJob = new Map<string, Map<number, WorkflowStepEvent['status']>>()
  for (const ev of stepEvents ?? []) {
    let m = byJob.get(ev.job)
    if (!m) { m = new Map(); byJob.set(ev.job, m) }
    m.set(ev.stepIndex, ev.status)
  }
  return byJob
}

type JobRunStatus = 'success' | 'failure' | 'running' | undefined

function jobRunStatus(stepCount: number, statuses: Map<number, WorkflowStepEvent['status']> | undefined): JobRunStatus {
  if (!statuses || statuses.size === 0) return undefined
  let sawFailure = false
  let sawRunning = false
  let allSuccess = stepCount > 0
  for (let i = 0; i < stepCount; i++) {
    const s = statuses.get(i)
    if (s === 'failure') sawFailure = true
    if (s === 'running') sawRunning = true
    if (s !== 'success') allSuccess = false
  }
  if (sawFailure) return 'failure'
  if (sawRunning) return 'running'
  if (allSuccess) return 'success'
  return undefined
}

export default function EventsMap({ content, loading, stepEvents, onEdit }: Props) {
  const graph = useMemo(() => parseWorkflowYaml(content), [content])
  const rows = useMemo(() => buildRows(graph.jobs), [graph.jobs])
  const stepStatusByJob = useMemo(() => buildStepStatus(stepEvents), [stepEvents])

  const surfaceRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [wires, setWires] = useState<Wire[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const measure = () => {
      const found: Wire[] = []
      const trigger = triggerRef.current

      if (trigger && rows.length > 0) {
        for (const rj of rows[0]) {
          const el = cardRefs.current.get(rj.job.id)
          if (el) found.push({ from: bottomCenter(trigger, surface), to: topCenter(el, surface) })
        }
      }

      for (let r = 1; r < rows.length; r++) {
        for (const rj of rows[r]) {
          const target = cardRefs.current.get(rj.job.id)
          if (!target) continue
          for (const dep of rj.job.needs) {
            if (!rows[r - 1].some(p => p.job.id === dep)) continue
            const source = cardRefs.current.get(dep)
            if (!source) continue
            found.push({ from: bottomCenter(source, surface), to: topCenter(target, surface) })
          }
        }
      }

      setWires(found)
      setSize({ w: surface.scrollWidth, h: surface.scrollHeight })
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(surface)
    return () => ro.disconnect()
  }, [rows])

  if (loading) {
    return (
      <div className="ev-map">
        <div className="ev-map__loading">
          <Skeleton width="35%" height={14} />
          <Skeleton width="55%" height={44} />
          <Skeleton width="45%" height={44} />
        </div>
      </div>
    )
  }

  if (graph.triggers.length === 0 && graph.jobs.length === 0) {
    return (
      <div className="ev-map">
        <div className="wf-output-card__placeholder">
          No triggers or jobs could be parsed from this workflow.
        </div>
      </div>
    )
  }

  return (
    <div className="ev-map">
      <div className="ev-map__surface" ref={surfaceRef}>
        <svg className="ev-map__wires" width={size.w} height={size.h}>
          {wires.map((w, i) => {
            const midY = (w.from.y + w.to.y) / 2
            return (
              <path
                key={i}
                d={`M${w.from.x},${w.from.y} C${w.from.x},${midY} ${w.to.x},${midY} ${w.to.x},${w.to.y}`}
                className="ev-map__wire"
              />
            )
          })}
        </svg>

        <div className="ev-map__rows">
          {graph.triggers.length > 0 && (
            <div className="ev-map__row">
              <div className="ev-map__card ev-map__card--trigger" ref={triggerRef}>
                <div className="ev-map__card-head">
                  <div className="ev-map__card-kicker">On</div>
                  {onEdit && (
                    <button
                      type="button"
                      className="ev-map__icon-btn"
                      title="Edit triggers"
                      onClick={() => onEdit(graph.triggers[0].line)}
                    >
                      <Pencil size={11} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
                <div className="ev-map__card-name">{graph.triggers.map(t => t.label).join(', ')}</div>
              </div>
            </div>
          )}

          {rows.map((rowJobs, r) => (
            <div className="ev-map__row" key={r}>
              {rowJobs.map(rj => {
                const statuses = stepStatusByJob.get(rj.job.id)
                const runStatus = rj.isTerminal ? jobRunStatus(rj.job.steps.length, statuses) : undefined
                return (
                  <div
                    key={rj.job.id}
                    className="ev-map__card"
                    ref={el => { if (el) cardRefs.current.set(rj.job.id, el); else cardRefs.current.delete(rj.job.id) }}
                  >
                    <div className="ev-map__card-head">
                      <div className="ev-map__card-name">{rj.job.name}</div>
                      {onEdit && (
                        <button
                          type="button"
                          className="ev-map__icon-btn"
                          title="Edit job"
                          onClick={() => onEdit(rj.job.line)}
                        >
                          <Pencil size={11} strokeWidth={1.8} />
                        </button>
                      )}
                    </div>

                    <div className="ev-map__steps">
                      {rj.job.steps.map((s, i) => {
                        const status = statuses?.get(i)
                        return (
                          <div className="ev-map__step" key={i}>
                            <span className={`ev-map__step-dot${status ? ` ev-map__step-dot--${status}` : ''}`} />
                            <span className="ev-map__step-label">{s.label}</span>
                            {onEdit && (
                              <button
                                type="button"
                                className="ev-map__icon-btn ev-map__icon-btn--step"
                                title="Edit step"
                                onClick={() => onEdit(s.line)}
                              >
                                <Pencil size={10} strokeWidth={1.8} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                      {onEdit && (
                        <button
                          type="button"
                          className="ev-map__add-step"
                          onClick={() => onEdit(rj.job.stepsInsertLine)}
                        >
                          <Plus size={11} strokeWidth={2} /> Add step
                        </button>
                      )}
                    </div>

                    {rj.farNeeds.length > 0 && (
                      <div className="ev-map__card-far">also needs {rj.farNeeds.join(', ')}</div>
                    )}

                    {rj.isTerminal && (
                      <div className="ev-map__card-result">
                        {runStatus === 'success' && <span className="ev-map__chip ev-map__chip--pass">Pass</span>}
                        {runStatus === 'failure' && <span className="ev-map__chip ev-map__chip--fail">Fail</span>}
                        {runStatus === 'running' && <span className="ev-map__chip ev-map__chip--running">Running…</span>}
                        {!runStatus && <span className="ev-map__chip ev-map__chip--idle">Not run</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
