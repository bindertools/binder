import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseWorkflowYaml, type WorkflowJobNode } from '../lib/workflowGraph'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

interface Props {
  content: string
  loading: boolean
}

interface Lane {
  job:        WorkflowJobNode
  isTerminal: boolean
  /** Dependencies that aren't in the immediately preceding lane — too rare to
   *  deserve a drawn connector, so they're called out as text instead. */
  farDeps:    string[]
}

/** Splits jobs into sequential lanes by dependency depth (lane 0 has no
 *  `needs`). A connector is only ever drawn between a lane and the one right
 *  before it, so every line is short and lives entirely in one gap — there's
 *  no long-haul connector that could cross behind an unrelated lane. */
function buildLanes(jobs: WorkflowJobNode[]): Lane[][] {
  const byId = new Map(jobs.map(j => [j.id, j]))
  const depthOf = new Map<string, number>()

  const depth = (id: string, seen: Set<string>): number => {
    if (depthOf.has(id)) return depthOf.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const job = byId.get(id)
    let d = 0
    if (job) for (const dep of job.needs) if (byId.has(dep)) d = Math.max(d, depth(dep, seen) + 1)
    depthOf.set(id, d)
    return d
  }
  jobs.forEach(j => depth(j.id, new Set()))

  const reliedOn = new Set<string>()
  jobs.forEach(j => j.needs.forEach(d => reliedOn.add(d)))

  const deepest = jobs.length ? Math.max(...jobs.map(j => depthOf.get(j.id) ?? 0)) : -1
  const lanes: Lane[][] = []
  for (let d = 0; d <= deepest; d++) {
    lanes.push(
      jobs
        .filter(j => (depthOf.get(j.id) ?? 0) === d)
        .map(job => ({
          job,
          isTerminal: !reliedOn.has(job.id),
          farDeps: job.needs.filter(dep => (depthOf.get(dep) ?? 0) !== d - 1),
        })),
    )
  }
  return lanes
}

interface Point { x: number; y: number }
interface Connector { from: Point; to: Point; tone: 'normal' | 'success' | 'failure' }

function centerRelativeTo(el: HTMLElement, origin: HTMLElement): Point {
  const r = el.getBoundingClientRect()
  const o = origin.getBoundingClientRect()
  return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 }
}

function edgeRelativeTo(el: HTMLElement, origin: HTMLElement, side: 'left' | 'right'): Point {
  const r = el.getBoundingClientRect()
  const o = origin.getBoundingClientRect()
  return { x: (side === 'left' ? r.left : r.right) - o.left, y: r.top - o.top + r.height / 2 }
}

export default function EventsMap({ content, loading }: Props) {
  const graph = useMemo(() => parseWorkflowYaml(content), [content])
  const lanes = useMemo(() => buildLanes(graph.jobs), [graph.jobs])

  const surfaceRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const jobRefs = useRef(new Map<string, HTMLDivElement>())
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [surfaceSize, setSurfaceSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const measure = () => {
      const next: Connector[] = []
      const trigger = triggerRef.current

      if (trigger && lanes.length > 0) {
        for (const lane of lanes[0]) {
          const el = jobRefs.current.get(lane.job.id)
          if (!el) continue
          next.push({
            from: edgeRelativeTo(trigger, surface, 'right'),
            to:   edgeRelativeTo(el, surface, 'left'),
            tone: 'normal',
          })
        }
      }

      for (let i = 1; i < lanes.length; i++) {
        for (const lane of lanes[i]) {
          const target = jobRefs.current.get(lane.job.id)
          if (!target) continue
          for (const dep of lane.job.needs) {
            const prevHasIt = lanes[i - 1].some(l => l.job.id === dep)
            if (!prevHasIt) continue
            const source = jobRefs.current.get(dep)
            if (!source) continue
            next.push({
              from: edgeRelativeTo(source, surface, 'right'),
              to:   edgeRelativeTo(target, surface, 'left'),
              tone: 'normal',
            })
          }
        }
      }

      setConnectors(next)
      setSurfaceSize({ w: surface.scrollWidth, h: surface.scrollHeight })
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(surface)
    return () => ro.disconnect()
  }, [lanes])

  if (loading) {
    return (
      <div className="ev-map">
        <div className="ev-map__loading">
          <Skeleton width="40%" height={14} />
          <Skeleton width="60%" height={40} />
          <Skeleton width="50%" height={40} />
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
        <svg className="ev-map__wires" width={surfaceSize.w} height={surfaceSize.h}>
          {connectors.map((c, i) => {
            const midX = (c.from.x + c.to.x) / 2
            return (
              <path
                key={i}
                d={`M${c.from.x},${c.from.y} C${midX},${c.from.y} ${midX},${c.to.y} ${c.to.x},${c.to.y}`}
                className={`ev-map__wire ev-map__wire--${c.tone}`}
              />
            )
          })}
        </svg>

        <div className="ev-map__lanes">
          {graph.triggers.length > 0 && (
            <div className="ev-map__lane ev-map__lane--trigger">
              <div className="ev-map__pill ev-map__pill--trigger" ref={triggerRef}>
                <span className="ev-map__pill-kicker">On</span>
                <span className="ev-map__pill-name">{graph.triggers.map(t => t.label).join(', ')}</span>
              </div>
            </div>
          )}

          {lanes.map((lane, i) => (
            <div className="ev-map__lane" key={i}>
              {lane.map(l => (
                <div
                  key={l.job.id}
                  className="ev-map__pill"
                  ref={el => { if (el) jobRefs.current.set(l.job.id, el); else jobRefs.current.delete(l.job.id) }}
                >
                  <span className="ev-map__pill-name">{l.job.name}</span>
                  <span className="ev-map__pill-meta">{l.job.steps.length} step{l.job.steps.length === 1 ? '' : 's'}</span>
                  {l.farDeps.length > 0 && (
                    <span className="ev-map__pill-far">also needs {l.farDeps.join(', ')}</span>
                  )}
                  {l.isTerminal && (
                    <span className="ev-map__pill-result">
                      <span className="ev-map__result-dot ev-map__result-dot--pass" />Pass
                      <span className="ev-map__result-dot ev-map__result-dot--fail" />Fail
                    </span>
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
