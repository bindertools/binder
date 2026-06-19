import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseWorkflowYaml, type WorkflowJobNode } from '../lib/workflowGraph'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

interface Props {
  content: string
  loading: boolean
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

export default function EventsMap({ content, loading }: Props) {
  const graph = useMemo(() => parseWorkflowYaml(content), [content])
  const rows = useMemo(() => buildRows(graph.jobs), [graph.jobs])

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
                <div className="ev-map__card-kicker">On</div>
                <div className="ev-map__card-name">{graph.triggers.map(t => t.label).join(', ')}</div>
              </div>
            </div>
          )}

          {rows.map((rowJobs, r) => (
            <div className="ev-map__row" key={r}>
              {rowJobs.map(rj => (
                <div
                  key={rj.job.id}
                  className="ev-map__card"
                  ref={el => { if (el) cardRefs.current.set(rj.job.id, el); else cardRefs.current.delete(rj.job.id) }}
                >
                  <div className="ev-map__card-name">{rj.job.name}</div>
                  <div className="ev-map__card-meta">{rj.job.steps.length} step{rj.job.steps.length === 1 ? '' : 's'}</div>
                  {rj.farNeeds.length > 0 && (
                    <div className="ev-map__card-far">also needs {rj.farNeeds.join(', ')}</div>
                  )}
                  {rj.isTerminal && (
                    <div className="ev-map__card-result">
                      <span className="ev-map__chip ev-map__chip--pass">Pass</span>
                      <span className="ev-map__chip ev-map__chip--fail">Fail</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
