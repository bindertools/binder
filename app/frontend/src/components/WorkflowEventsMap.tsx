import { useMemo } from 'react'
import { parseWorkflowYaml, type WorkflowJobNode } from '../lib/workflowGraph'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

const NODE_W = 184
const NODE_H = 56
const H_GAP  = 104
const V_GAP  = 34
const PAD    = 36
const CHAMFER = 9 // corner cut on the node silhouette
const VIA     = 3 // half-size of the square pad drawn at each trace endpoint
const PORT_SPAN = 0.6 // fraction of node height used to fan out multiple ports
const CORRIDOR_TOP = 40 // gap between the lowest node row and the first bus lane
const LANE_GAP     = 18 // vertical spacing between stacked bus lanes
const CORRIDOR_IN  = 26 // how far an edge travels horizontally before dropping into the corridor

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

/** Builds a sharp right-angle ("circuit trace") connector between two ports —
 *  no curves, no diagonals, just orthogonal segments like a PCB trace. */
function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2
  if (Math.abs(y2 - y1) < 0.5) return `M${x1},${y1} H${x2}`
  return `M${x1},${y1} H${midX} V${y2} H${x2}`
}

/** Routes an edge that skips one or more columns through a dedicated
 *  horizontal "bus lane" below all node rows, so it never cuts through an
 *  intermediate column's nodes the way a direct elbow would. */
function busPath(x1: number, y1: number, x2: number, y2: number, laneY: number): string {
  return [
    `M${x1},${y1}`,
    `H${x1 + CORRIDOR_IN}`,
    `V${laneY}`,
    `H${x2 - CORRIDOR_IN}`,
    `V${y2}`,
    `H${x2}`,
  ].join(' ')
}

/** Octagonal "chamfered" node silhouette — a deliberately different shape
 *  language from a rounded card, closer to a schematic component outline. */
function chamferPath(w: number, h: number, c: number): string {
  return [
    `M${c},0`, `H${w - c}`, `L${w},${c}`, `V${h - c}`,
    `L${w - c},${h}`, `H${c}`, `L0,${h - c}`, `V${c}`, 'Z',
  ].join(' ')
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
      return { ...e, path, x1, y1, x2, y2 }
    }).filter((e): e is LaidOutEdge & { path: string; x1: number; y1: number; x2: number; y2: number } => e !== null)

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
          <pattern id="wf-events-map-grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M0,0 H22 M0,0 V22" className="wf-events-map__grid-line" />
          </pattern>
        </defs>
        <rect width={layout.width} height={layout.height} fill="url(#wf-events-map-grid)" />
        <g transform={`translate(${PAD},${PAD})`}>
          {layout.edges.map((e, i) => (
            <g key={`${e.from}->${e.to}-${i}`}>
              <path d={e.path} className={`wf-events-map__edge wf-events-map__edge--${e.kind}`} />
              <rect
                x={e.x1 - VIA} y={e.y1 - VIA} width={VIA * 2} height={VIA * 2}
                className={`wf-events-map__via wf-events-map__via--${e.kind}`}
              />
              <rect
                x={e.x2 - VIA} y={e.y2 - VIA} width={VIA * 2} height={VIA * 2}
                className={`wf-events-map__via wf-events-map__via--${e.kind}`}
              />
            </g>
          ))}
          {layout.nodes.map(n => (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} className={`wf-events-map__node wf-events-map__node--${n.kind}`}>
              <path className="wf-events-map__card" d={chamferPath(NODE_W, NODE_H, CHAMFER)} />
              <text x={16} y={n.sub ? 24 : NODE_H / 2 + 4} className="wf-events-map__label">{truncate(n.label, 23).toUpperCase()}</text>
              {n.sub && <text x={16} y={40} className="wf-events-map__sublabel">{n.sub.toUpperCase()}</text>}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
