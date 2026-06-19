import { useMemo } from 'react'
import { parseWorkflowYaml, type WorkflowJobNode } from '../lib/workflowGraph'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

const NODE_W = 196
const NODE_H = 60
const H_GAP  = 88
const V_GAP  = 26
const PAD    = 32
const ICON_R = 13 // radius of the kind icon badge
const ICON_CX = 24 // badge center x, relative to node origin
const PORT_SPAN = 0.6 // fraction of node height used to fan out multiple ports
const CORRIDOR_TOP = 36 // gap between the lowest node row and the first bus lane
const LANE_GAP     = 16 // vertical spacing between stacked bus lanes
const CORRIDOR_IN  = 24 // how far an edge travels horizontally before dropping into the corridor

type NodeKind = 'trigger' | 'job' | 'success' | 'failure'
type EdgeKind = 'neutral' | 'success' | 'failure'

interface PositionedNode {
  id:    string
  x:     number
  y:     number
  col:   number
  label: string
  sub?:  string
  kind:  NodeKind
}

interface LaidOutEdge {
  from: string
  to:   string
  kind: EdgeKind
}

/** Evenly spaced offsets (as a fraction of node height) for `count` ports, centered. */
function portOffsets(count: number): number[] {
  if (count <= 1) return [0.5]
  const span = PORT_SPAN
  const start = 0.5 - span / 2
  return Array.from({ length: count }, (_, i) => start + (span * i) / (count - 1))
}

/** Builds a rounded elbow ("step") connector between two ports, avoiding the
 *  diagonal-bezier crisscross that makes dense dependency graphs read as spaghetti. */
function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2
  if (Math.abs(y2 - y1) < 0.5) return `M${x1},${y1} H${x2}`
  const r = Math.min(10, Math.abs(y2 - y1) / 2, (midX - x1) / 2)
  const dir = y2 > y1 ? 1 : -1
  return [
    `M${x1},${y1}`,
    `H${midX - r}`,
    `Q${midX},${y1} ${midX},${y1 + r * dir}`,
    `V${y2 - r * dir}`,
    `Q${midX},${y2} ${midX + r},${y2}`,
    `H${x2}`,
  ].join(' ')
}

/** Routes an edge that skips one or more columns through a dedicated
 *  horizontal "bus lane" below all node rows, so it never cuts through an
 *  intermediate column's nodes the way a direct diagonal/elbow would. */
function busPath(x1: number, y1: number, x2: number, y2: number, laneY: number): string {
  const r = 10
  const dir1 = laneY > y1 ? 1 : -1
  const dir2 = y2 > laneY ? 1 : -1
  return [
    `M${x1},${y1}`,
    `H${x1 + CORRIDOR_IN - r}`,
    `Q${x1 + CORRIDOR_IN},${y1} ${x1 + CORRIDOR_IN},${y1 + r * dir1}`,
    `V${laneY - r * dir1}`,
    `Q${x1 + CORRIDOR_IN},${laneY} ${x1 + CORRIDOR_IN + r},${laneY}`,
    `H${x2 - CORRIDOR_IN - r}`,
    `Q${x2 - CORRIDOR_IN},${laneY} ${x2 - CORRIDOR_IN},${laneY + r * dir2}`,
    `V${y2 - r * dir2}`,
    `Q${x2 - CORRIDOR_IN},${y2} ${x2 - CORRIDOR_IN + r},${y2}`,
    `H${x2}`,
  ].join(' ')
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Small stroke-based glyph drawn inside each node's icon badge, centered on (0,0). */
function NodeGlyph({ kind }: { kind: NodeKind }) {
  switch (kind) {
    case 'trigger':
      return <path d="M1.5,-6 L-4,1 H-0.5 L-1.5,6 L4,-1 H0.5 Z" />
    case 'success':
      return <path d="M-4.5,0.5 L-1.5,4 L5,-4.5" />
    case 'failure':
      return <path d="M-4,-4 L4,4 M4,-4 L-4,4" />
    case 'job':
    default:
      return <path d="M-3,-5 L5,0 L-3,5 Z" />
  }
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
        const node: PositionedNode = { ...n, x, y: offsetY + ri * (NODE_H + V_GAP), col: ci }
        nodes.push(node)
        nodeById.set(n.id, node)
      })
    })

    const edges: LaidOutEdge[] = []
    if (jobs.length > 0) {
      const rootJobs = jobs.filter(j => (layers.get(j.id) ?? 0) === 0)
      for (const t of triggers) for (const j of rootJobs) edges.push({ from: `trigger:${t.id}`, to: `job:${j.id}`, kind: 'neutral' })
      for (const j of jobs) {
        for (const dep of j.needs) {
          if (jobs.some(jj => jj.id === dep)) edges.push({ from: `job:${dep}`, to: `job:${j.id}`, kind: 'neutral' })
        }
      }
      for (const j of terminalJobs) {
        edges.push({ from: `job:${j.id}`, to: 'outcome:success', kind: 'success' })
        edges.push({ from: `job:${j.id}`, to: 'outcome:failure', kind: 'failure' })
      }
    }

    // Fan multiple edges out/in across a node's height instead of funneling
    // them all through its vertical center — the single biggest contributor
    // to overlapping, "spaghetti" connectors in dense dependency graphs.
    const outByNode = new Map<string, LaidOutEdge[]>()
    const inByNode  = new Map<string, LaidOutEdge[]>()
    for (const e of edges) {
      if (!outByNode.has(e.from)) outByNode.set(e.from, [])
      outByNode.get(e.from)!.push(e)
      if (!inByNode.has(e.to)) inByNode.set(e.to, [])
      inByNode.get(e.to)!.push(e)
    }
    const exitOffset = new Map<LaidOutEdge, number>()
    const entryOffset = new Map<LaidOutEdge, number>()
    for (const [, list] of outByNode) {
      const sorted = [...list].sort((a, b) => (nodeById.get(a.to)?.y ?? 0) - (nodeById.get(b.to)?.y ?? 0))
      const offsets = portOffsets(sorted.length)
      sorted.forEach((e, i) => exitOffset.set(e, offsets[i]))
    }
    for (const [, list] of inByNode) {
      const sorted = [...list].sort((a, b) => (nodeById.get(a.from)?.y ?? 0) - (nodeById.get(b.from)?.y ?? 0))
      const offsets = portOffsets(sorted.length)
      sorted.forEach((e, i) => entryOffset.set(e, offsets[i]))
    }

    // Edges that skip one or more columns get a dedicated bus lane below the
    // node grid instead of a direct elbow — a direct path's midpoint would
    // otherwise land inside an intermediate column and cut through whatever
    // node happens to sit there.
    const skipEdges = edges
      .filter(e => {
        const a = nodeById.get(e.from)
        const b = nodeById.get(e.to)
        return !!a && !!b && Math.abs(b.col - a.col) > 1
      })
      .sort((e1, e2) => (nodeById.get(e1.from)?.col ?? 0) - (nodeById.get(e2.from)?.col ?? 0))
    const laneOf = new Map<LaidOutEdge, number>()
    skipEdges.forEach((e, i) => laneOf.set(e, i))
    const laneCount = skipEdges.length

    const routedEdges = edges.map(e => {
      const a = nodeById.get(e.from)
      const b = nodeById.get(e.to)
      if (!a || !b) return null
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H * (exitOffset.get(e) ?? 0.5)
      const x2 = b.x,          y2 = b.y + NODE_H * (entryOffset.get(e) ?? 0.5)
      const lane = laneOf.get(e)
      const path = lane === undefined
        ? elbowPath(x1, y1, x2, y2)
        : busPath(x1, y1, x2, y2, colHeight + CORRIDOR_TOP + lane * LANE_GAP)
      return { ...e, path }
    }).filter((e): e is LaidOutEdge & { path: string } => e !== null)

    const width  = columns.length * NODE_W + Math.max(0, columns.length - 1) * H_GAP + PAD * 2
    const height = colHeight + (laneCount > 0 ? CORRIDOR_TOP + laneCount * LANE_GAP : 0) + PAD * 2

    return { nodes, nodeById, edges: routedEdges, width, height }
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
        <defs>
          <pattern id="wf-events-map-dots" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" className="wf-events-map__dot" />
          </pattern>
          {(['neutral', 'success', 'failure'] as const).map(k => (
            <marker
              key={k}
              id={`wf-events-map-arrow-${k}`}
              viewBox="0 0 8 8"
              refX="6.5"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0.5 L7,4 L0,7.5 Z" className={`wf-events-map__arrowhead wf-events-map__arrowhead--${k}`} />
            </marker>
          ))}
        </defs>
        <rect width={layout.width} height={layout.height} fill="url(#wf-events-map-dots)" />
        <g transform={`translate(${PAD},${PAD})`}>
          {layout.edges.map((e, i) => (
            <path
              key={`${e.from}->${e.to}-${i}`}
              d={e.path}
              markerEnd={`url(#wf-events-map-arrow-${e.kind})`}
              className={`wf-events-map__edge wf-events-map__edge--${e.kind}`}
            />
          ))}
          {layout.nodes.map(n => (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} className={`wf-events-map__node wf-events-map__node--${n.kind}`}>
              <rect className="wf-events-map__card" width={NODE_W} height={NODE_H} rx={10} />
              <circle className="wf-events-map__icon-bg" cx={ICON_CX} cy={NODE_H / 2} r={ICON_R} />
              <g transform={`translate(${ICON_CX},${NODE_H / 2})`} className="wf-events-map__icon">
                <NodeGlyph kind={n.kind} />
              </g>
              <text x={ICON_CX + ICON_R + 12} y={n.sub ? NODE_H / 2 - 6 : NODE_H / 2 + 5} className="wf-events-map__label">
                {truncate(n.label, 20)}
              </text>
              {n.sub && (
                <text x={ICON_CX + ICON_R + 12} y={NODE_H / 2 + 14} className="wf-events-map__sublabel">{n.sub}</text>
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
