import { useMemo } from 'react'
import { parseWorkflowYaml, type WorkflowJobNode } from '../lib/workflowGraph'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

const NODE_W = 176
const NODE_H = 56
const H_GAP  = 72
const V_GAP  = 22
const PAD    = 28

type NodeKind = 'trigger' | 'job' | 'success' | 'failure'

interface PositionedNode {
  id:    string
  x:     number
  y:     number
  label: string
  sub?:  string
  kind:  NodeKind
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Longest dependency chain ending at each job (0 = no `needs`). */
function computeLayers(jobs: WorkflowJobNode[]): Map<string, number> {
  const layer = new Map<string, number>()
  const jobMap = new Map(jobs.map(j => [j.id, j]))

  function resolve(id: string, visiting: Set<string>): number {
    if (layer.has(id)) return layer.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const job = jobMap.get(id)
    let l = 0
    if (job) {
      for (const dep of job.needs) {
        if (jobMap.has(dep)) l = Math.max(l, resolve(dep, visiting) + 1)
      }
    }
    layer.set(id, l)
    return l
  }

  for (const j of jobs) resolve(j.id, new Set())
  return layer
}

interface Props {
  content: string
  loading: boolean
}

export default function WorkflowEventsMap({ content, loading }: Props) {
  const graph = useMemo(() => parseWorkflowYaml(content), [content])

  const layout = useMemo(() => {
    const { triggers, jobs } = graph
    const layers = computeLayers(jobs)
    const maxLayer = jobs.length ? Math.max(...jobs.map(j => layers.get(j.id) ?? 0)) : -1

    const dependedOn = new Set<string>()
    jobs.forEach(j => j.needs.forEach(n => dependedOn.add(n)))
    const terminalJobs = jobs.filter(j => !dependedOn.has(j.id))

    interface ColNode { id: string; label: string; sub?: string; kind: NodeKind }
    const columns: ColNode[][] = []

    if (triggers.length > 0) {
      columns.push(triggers.map(t => ({ id: `trigger:${t.id}`, label: t.label, kind: 'trigger' as const })))
    }

    for (let l = 0; l <= maxLayer; l++) {
      const jobsInLayer = jobs.filter(j => (layers.get(j.id) ?? 0) === l)
      columns.push(jobsInLayer.map(j => ({
        id:    `job:${j.id}`,
        label: j.name,
        sub:   `${j.steps.length} step${j.steps.length === 1 ? '' : 's'}`,
        kind:  'job' as const,
      })))
    }

    if (jobs.length > 0) {
      columns.push([
        { id: 'outcome:success', label: 'Success', kind: 'success' as const },
        { id: 'outcome:failure', label: 'Failure', kind: 'failure' as const },
      ])
    }

    const maxRows = Math.max(1, ...columns.map(c => c.length))
    const colHeight = maxRows * (NODE_H + V_GAP) - V_GAP

    const nodes: PositionedNode[] = []
    const nodeById = new Map<string, PositionedNode>()

    columns.forEach((col, ci) => {
      const x = ci * (NODE_W + H_GAP)
      const colH = col.length * (NODE_H + V_GAP) - V_GAP
      const offsetY = (colHeight - colH) / 2
      col.forEach((n, ri) => {
        const node: PositionedNode = { ...n, x, y: offsetY + ri * (NODE_H + V_GAP) }
        nodes.push(node)
        nodeById.set(n.id, node)
      })
    })

    const edges: { from: string; to: string }[] = []
    if (jobs.length > 0) {
      const rootJobs = jobs.filter(j => (layers.get(j.id) ?? 0) === 0)
      for (const t of triggers) for (const j of rootJobs) edges.push({ from: `trigger:${t.id}`, to: `job:${j.id}` })
      for (const j of jobs) {
        for (const dep of j.needs) {
          if (jobs.some(jj => jj.id === dep)) edges.push({ from: `job:${dep}`, to: `job:${j.id}` })
        }
      }
      for (const j of terminalJobs) {
        edges.push({ from: `job:${j.id}`, to: 'outcome:success' })
        edges.push({ from: `job:${j.id}`, to: 'outcome:failure' })
      }
    }

    const width  = columns.length * NODE_W + Math.max(0, columns.length - 1) * H_GAP + PAD * 2
    const height = colHeight + PAD * 2

    return { nodes, nodeById, edges, width, height }
  }, [graph])

  if (loading) {
    return (
      <div className="wf-events-map">
        <div className="wf-events-map__loading">
          <Skeleton width="50%" height={14} />
          <Skeleton width="65%" height={14} />
          <Skeleton width="40%" height={14} />
        </div>
      </div>
    )
  }

  if (graph.triggers.length === 0 && graph.jobs.length === 0) {
    return (
      <div className="wf-events-map">
        <div className="wf-output-card__placeholder">
          No triggers or jobs could be parsed from this workflow.
        </div>
      </div>
    )
  }

  return (
    <div className="wf-events-map">
      <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
        <g transform={`translate(${PAD},${PAD})`}>
          {layout.edges.map((e, i) => {
            const a = layout.nodeById.get(e.from)
            const b = layout.nodeById.get(e.to)
            if (!a || !b) return null
            const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
            const x2 = b.x,          y2 = b.y + NODE_H / 2
            const mx = (x1 + x2) / 2
            return (
              <path
                key={`${e.from}->${e.to}-${i}`}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                className="wf-events-map__edge"
              />
            )
          })}
          {layout.nodes.map(n => (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} className={`wf-events-map__node wf-events-map__node--${n.kind}`}>
              <rect width={NODE_W} height={NODE_H} rx={10} />
              <text x={14} y={n.sub ? 23 : NODE_H / 2 + 5} className="wf-events-map__label">{truncate(n.label, 22)}</text>
              {n.sub && <text x={14} y={41} className="wf-events-map__sublabel">{n.sub}</text>}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
