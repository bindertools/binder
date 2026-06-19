import { useMemo, useState } from 'react'
import { ChevronDown, Zap, PlayCircle, CheckCircle2, XCircle } from 'lucide-react'
import { parseWorkflowYaml, type WorkflowJobNode } from '../lib/workflowGraph'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

/** Groups jobs into sequential stages by dependency depth — stage 0 has no
 *  `needs`, stage 1 depends only on stage 0, and so on. Jobs in the same
 *  stage run in parallel; stages run one after another. This is the whole
 *  layout: no coordinates, no edges, just "what runs alongside what, in
 *  what order" — which is the question this view actually exists to answer. */
function computeStages(jobs: WorkflowJobNode[]): WorkflowJobNode[][] {
  const depth = new Map<string, number>()
  const byId = new Map(jobs.map(j => [j.id, j]))

  function resolve(id: string, visiting: Set<string>): number {
    if (depth.has(id)) return depth.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const job = byId.get(id)
    let d = 0
    if (job) for (const dep of job.needs) if (byId.has(dep)) d = Math.max(d, resolve(dep, visiting) + 1)
    depth.set(id, d)
    return d
  }

  for (const j of jobs) resolve(j.id, new Set())
  const maxDepth = jobs.length ? Math.max(...jobs.map(j => depth.get(j.id) ?? 0)) : -1
  const stages: WorkflowJobNode[][] = []
  for (let d = 0; d <= maxDepth; d++) stages.push(jobs.filter(j => (depth.get(j.id) ?? 0) === d))
  return stages
}

interface Props {
  content: string
  loading: boolean
}

export default function WorkflowEventsMap({ content, loading }: Props) {
  const graph = useMemo(() => parseWorkflowYaml(content), [content])
  const stages = useMemo(() => computeStages(graph.jobs), [graph.jobs])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  if (loading) {
    return (
      <div className="wf-pipeline">
        <div className="wf-events-map__loading">
          <Skeleton width="40%" height={14} />
          <Skeleton width="70%" height={48} />
          <Skeleton width="55%" height={48} />
        </div>
      </div>
    )
  }

  if (graph.triggers.length === 0 && graph.jobs.length === 0) {
    return (
      <div className="wf-pipeline">
        <div className="wf-output-card__placeholder">
          No triggers or jobs could be parsed from this workflow.
        </div>
      </div>
    )
  }

  return (
    <div className="wf-pipeline">
      {graph.triggers.length > 0 && (
        <>
          <div className="wf-pipeline__triggers">
            <span className="wf-pipeline__triggers-icon"><Zap size={13} strokeWidth={2} /></span>
            <span className="wf-pipeline__triggers-label">Runs on</span>
            {graph.triggers.map(t => (
              <span key={t.id} className="wf-pipeline__chip">{t.label}</span>
            ))}
          </div>
          {stages.length > 0 && <div className="wf-pipeline__connector" />}
        </>
      )}

      {stages.map((stage, i) => (
        <div key={i} className="wf-pipeline__stage">
          <div className="wf-pipeline__stage-header">
            <span className="wf-pipeline__stage-index">Stage {i + 1}</span>
            <span className="wf-pipeline__stage-meta">
              {stage.length} job{stage.length === 1 ? '' : 's'}{stage.length > 1 ? ' · runs in parallel' : ''}
            </span>
          </div>
          <div className="wf-pipeline__jobs">
            {stage.map(j => {
              const isOpen = expanded.has(j.id)
              return (
                <div key={j.id} className={`wf-pipeline__job${isOpen ? ' wf-pipeline__job--open' : ''}`}>
                  <button className="wf-pipeline__job-head" onClick={() => toggle(j.id)}>
                    <span className="wf-pipeline__job-icon"><PlayCircle size={16} strokeWidth={1.8} /></span>
                    <span className="wf-pipeline__job-name">{j.name}</span>
                    <span className="wf-pipeline__job-spacer" />
                    {j.needs.length > 0 && i > 0 && (
                      <span className="wf-pipeline__job-needs">needs {j.needs.join(', ')}</span>
                    )}
                    <span className="wf-pipeline__job-steps">{j.steps.length} step{j.steps.length === 1 ? '' : 's'}</span>
                    <span className={`wf-pipeline__job-chevron${isOpen ? ' wf-pipeline__job-chevron--open' : ''}`}>
                      <ChevronDown size={14} strokeWidth={2} />
                    </span>
                  </button>
                  {isOpen && (
                    <ol className="wf-pipeline__steps">
                      {j.steps.map((s, si) => <li key={si}>{s}</li>)}
                    </ol>
                  )}
                </div>
              )
            })}
          </div>
          <div className="wf-pipeline__connector" />
        </div>
      ))}

      {graph.jobs.length > 0 && (
        <div className="wf-pipeline__outcome">
          <div className="wf-pipeline__outcome-card wf-pipeline__outcome-card--success">
            <CheckCircle2 size={16} strokeWidth={1.8} />
            <span>All jobs pass</span>
          </div>
          <div className="wf-pipeline__outcome-card wf-pipeline__outcome-card--failure">
            <XCircle size={16} strokeWidth={1.8} />
            <span>Any job fails</span>
          </div>
        </div>
      )}
    </div>
  )
}
