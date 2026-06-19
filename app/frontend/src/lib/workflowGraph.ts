// Lightweight, purpose-built parser that extracts just enough structure from a
// GitHub Actions workflow YAML file to render an events/trigger map: the `on:`
// triggers, the `jobs:` and their `needs:` dependencies, and step labels.
//
// This is intentionally not a general YAML parser — it understands block
// mappings/sequences and simple flow sequences (`[a, b]`), which covers the
// vast majority of real-world workflow files.

export interface WorkflowTriggerNode {
  id:    string
  label: string
  /** 1-based line in the source file where this trigger is declared. */
  line:  number
}

export interface WorkflowStepNode {
  label: string
  /** 1-based line in the source file where this step's `- ` item starts. */
  line:  number
}

export interface WorkflowJobNode {
  id:    string
  name:  string
  needs: string[]
  steps: WorkflowStepNode[]
  /** 1-based line in the source file where this job's key is declared. */
  line:  number
  /** Line to insert a new step item at (after the last existing step, or
   *  right after `steps:` if there are none yet). */
  stepsInsertLine: number
  /** Line to insert a brand-new top-level job key (`needs:`, `if:`) at —
   *  right after the job header, before any of its existing keys. Mapping
   *  key order doesn't matter in YAML, so this is always safe. */
  bodyInsertLine: number
  /** Line of an existing `needs:` key, if present. */
  needsLine?: number
  /** Shape of the existing `needs:` value, so edits rewrite it correctly. */
  needsStyle?: 'scalar' | 'flow' | 'block'
  /** For block-style `needs:`, the line right after the last `- item`. */
  needsBlockEndLine?: number
  /** Line of an existing `if:` key, if present. */
  ifLine?: number
  /** Last line occupied by the `if:` value — equal to `ifLine` for a plain
   *  single-line value, or the last continuation line when it's a block
   *  scalar (`if: >-` / `if: |`) spanning multiple lines. Edits must replace
   *  this whole range, not just `ifLine`, or the continuation lines are left
   *  behind as orphaned, unparseable text. */
  ifEndLine?: number
  /** The existing `if:` value, with any `${{ }}` wrapper and block-scalar
   *  indicator stripped, and continuation lines folded into one line. */
  ifExpr?: string
}

export interface WorkflowGraph {
  triggers: WorkflowTriggerNode[]
  jobs:     WorkflowJobNode[]
  /** Line of the `jobs:` key, or undefined if the file has no jobs section
   *  at all (rare — most real workflow files have one). */
  jobsKeyLine: number | undefined
  /** Line to insert a brand-new job at — right after the last existing
   *  job's block, or right after `jobs:` if there are none yet. */
  jobsInsertLine: number
  /** Indentation (in spaces) to use when generating new YAML so it matches
   *  the rest of the file: job id keys, job body keys, and step items. */
  jobIndent:     number
  jobBodyIndent: number
  stepItemIndent: number
}

interface Line {
  indent: number
  text:   string
  /** 1-based line number in the original (untokenized) source file. */
  lineNo: number
}

const TRIGGER_LABELS: Record<string, string> = {
  push:                 'Push',
  pull_request:         'Pull Request',
  pull_request_target:  'PR Target',
  workflow_dispatch:    'Manual Dispatch',
  workflow_call:        'Workflow Call',
  workflow_run:         'Workflow Run',
  schedule:             'Schedule',
  release:              'Release',
  issues:               'Issue',
  issue_comment:        'Issue Comment',
  registry_package:     'Package',
  repository_dispatch:  'Repo Dispatch',
}

function triggerLabel(id: string): string {
  return TRIGGER_LABELS[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i)
    }
  }
  return line
}

function tokenize(content: string): Line[] {
  const lines: Line[] = []
  const raws = content.split(/\r?\n/)
  for (let i = 0; i < raws.length; i++) {
    const stripped = stripComment(raws[i]).replace(/\s+$/, '')
    if (!stripped.trim()) continue
    const indent = stripped.length - stripped.trimStart().length
    lines.push({ indent, text: stripped.trim(), lineNo: i + 1 })
  }
  return lines
}

/** All lines indented further than `lines[idx]`, up to the next line at or below its indent. */
function blockChildren(lines: Line[], idx: number): Line[] {
  const parentIndent = lines[idx].indent
  const children: Line[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].indent <= parentIndent) break
    children.push(lines[i])
  }
  return children
}

/** Only the immediate (shallowest) children — i.e. sibling keys/items of a block. */
function directChildren(children: Line[]): Line[] {
  if (children.length === 0) return []
  const base = children[0].indent
  return children.filter(c => c.indent === base)
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

function findColon(s: string): number {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble
    else if (c === ':' && !inSingle && !inDouble) {
      if (i + 1 === s.length || s[i + 1] === ' ') return i
    }
  }
  return -1
}

function splitKeyValue(text: string): { key: string; value: string } {
  let t = text
  if (t.startsWith('- ')) t = t.slice(2).trim()
  else if (t === '-') t = ''
  const idx = findColon(t)
  if (idx < 0) return { key: unquote(t), value: '' }
  return { key: unquote(t.slice(0, idx)), value: t.slice(idx + 1).trim() }
}

function parseFlowList(value: string): string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '')
  if (!inner.trim()) return []
  return inner.split(',').map(s => unquote(s.trim())).filter(Boolean)
}

function parseTriggers(lines: Line[]): WorkflowTriggerNode[] {
  const idx = lines.findIndex(l => l.indent === 0 && /^(on|"on"|'on')\s*:/.test(l.text))
  if (idx < 0) return []

  const { value } = splitKeyValue(lines[idx].text)
  if (value) {
    const ids = value.startsWith('[') ? parseFlowList(value) : [unquote(value)]
    return ids.filter(Boolean).map(id => ({ id, label: triggerLabel(id), line: lines[idx].lineNo }))
  }

  const direct = directChildren(blockChildren(lines, idx))
  return direct
    .filter(l => splitKeyValue(l.text).key)
    .map(l => ({ id: splitKeyValue(l.text).key, label: triggerLabel(splitKeyValue(l.text).key), line: l.lineNo }))
}

function actionLabel(uses: string): string {
  const withoutVersion = uses.split('@')[0]
  const parts = withoutVersion.split('/')
  return parts[parts.length - 1] || uses
}

function parseSteps(stepsChildren: Line[]): WorkflowStepNode[] {
  const items = directChildren(stepsChildren)
  const steps: WorkflowStepNode[] = []
  for (const item of items) {
    const itemIdx = stepsChildren.indexOf(item)
    const itemChildren = directChildren(blockChildren(stepsChildren, itemIdx))
    const { key, value } = splitKeyValue(item.text)

    let label = ''
    if (key === 'name') label = unquote(value)
    else if (key === 'uses') label = actionLabel(unquote(value))
    else if (key === 'run') label = 'Run script'

    if (!label) {
      for (const c of itemChildren) {
        const kv = splitKeyValue(c.text)
        if (kv.key === 'name') { label = unquote(kv.value); break }
      }
    }
    if (!label) {
      for (const c of itemChildren) {
        const kv = splitKeyValue(c.text)
        if (kv.key === 'uses') { label = actionLabel(unquote(kv.value)); break }
        if (kv.key === 'run') { label = 'Run script'; break }
      }
    }
    steps.push({ label: label || 'Step', line: item.lineNo })
  }
  return steps
}

interface JobsParseResult {
  jobs:           WorkflowJobNode[]
  jobsKeyLine:    number | undefined
  jobsInsertLine: number
  jobIndent:      number
  jobBodyIndent:  number
  stepItemIndent: number
}

function parseJobs(lines: Line[]): JobsParseResult {
  const idx = lines.findIndex(l => l.indent === 0 && /^jobs\s*:/.test(l.text))
  if (idx < 0) {
    return { jobs: [], jobsKeyLine: undefined, jobsInsertLine: 1, jobIndent: 2, jobBodyIndent: 4, stepItemIndent: 6 }
  }

  const jobsChildren = blockChildren(lines, idx)
  const jobLines = directChildren(jobsChildren)
  const jobs: WorkflowJobNode[] = []

  const jobIndent = jobLines.length > 0 ? jobLines[0].indent : 2
  let jobBodyIndent = jobIndent + 2
  let stepItemIndent = jobIndent + 4

  for (const jobLine of jobLines) {
    const { key: jobId } = splitKeyValue(jobLine.text)
    if (!jobId) continue

    const jobIdx = jobsChildren.indexOf(jobLine)
    const jobChildren = blockChildren(jobsChildren, jobIdx)
    const directJobChildren = directChildren(jobChildren)
    if (directJobChildren.length > 0) jobBodyIndent = directJobChildren[0].indent

    let name = jobId
    let needs: string[] = []
    let steps: WorkflowStepNode[] = []
    let stepsInsertLine = jobLine.lineNo + 1
    let needsLine: number | undefined
    let needsStyle: 'scalar' | 'flow' | 'block' | undefined
    let needsBlockEndLine: number | undefined
    let ifLine: number | undefined
    let ifEndLine: number | undefined
    let ifExpr: string | undefined

    for (const c of directJobChildren) {
      const { key, value } = splitKeyValue(c.text)
      if (key === 'name' && value) {
        name = unquote(value)
      } else if (key === 'if') {
        ifLine = c.lineNo
        if (/^[|>][-+0-9]*$/.test(value.trim())) {
          // Block scalar (`if: >-`, `if: |`, etc.) — its value is every
          // deeper-indented line that follows, not the text after the colon.
          const cIdx = jobChildren.indexOf(c)
          const ifBlock = blockChildren(jobChildren, cIdx)
          ifEndLine = ifBlock.length > 0 ? ifBlock[ifBlock.length - 1].lineNo : c.lineNo
          ifExpr = ifBlock.map(l => l.text.trim()).join(' ').replace(/^\$\{\{\s*|\s*\}\}$/g, '')
        } else {
          ifEndLine = c.lineNo
          ifExpr = value.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
        }
      } else if (key === 'needs') {
        needsLine = c.lineNo
        if (value.startsWith('[')) {
          needs = parseFlowList(value)
          needsStyle = 'flow'
        } else if (value) {
          needs = [unquote(value)]
          needsStyle = 'scalar'
        } else {
          const cIdx = jobChildren.indexOf(c)
          const needsBlock = blockChildren(jobChildren, cIdx)
          needs = directChildren(needsBlock)
            .map(n => splitKeyValue(n.text).key)
            .filter(Boolean)
          needsStyle = 'block'
          needsBlockEndLine = needsBlock.length > 0
            ? needsBlock[needsBlock.length - 1].lineNo + 1
            : c.lineNo + 1
        }
      } else if (key === 'steps') {
        const cIdx = jobChildren.indexOf(c)
        const stepsBlock = blockChildren(jobChildren, cIdx)
        steps = parseSteps(stepsBlock)
        stepItemIndent = steps.length > 0 ? lines.find(l => l.lineNo === steps[0].line)?.indent ?? stepItemIndent : stepItemIndent
        stepsInsertLine = stepsBlock.length > 0
          ? stepsBlock[stepsBlock.length - 1].lineNo + 1
          : c.lineNo + 1
      }
    }

    jobs.push({
      id: jobId, name, needs, steps, line: jobLine.lineNo, stepsInsertLine,
      bodyInsertLine: jobLine.lineNo + 1,
      needsLine, needsStyle, needsBlockEndLine, ifLine, ifEndLine, ifExpr,
    })
  }

  const jobsInsertLine = jobsChildren.length > 0
    ? jobsChildren[jobsChildren.length - 1].lineNo + 1
    : lines[idx].lineNo + 1

  return { jobs, jobsKeyLine: lines[idx].lineNo, jobsInsertLine, jobIndent, jobBodyIndent, stepItemIndent }
}

export function parseWorkflowYaml(content: string): WorkflowGraph {
  const lines = tokenize(content)
  const { jobs, jobsKeyLine, jobsInsertLine, jobIndent, jobBodyIndent, stepItemIndent } = parseJobs(lines)
  return {
    triggers: parseTriggers(lines),
    jobs, jobsKeyLine, jobsInsertLine, jobIndent, jobBodyIndent, stepItemIndent,
  }
}

// ── Mutations ──────────────────────────────────────────────────────────────────
// Everything below edits workflow YAML as text, splicing in/around the line
// numbers the parser above already tracks, rather than re-serializing the
// whole file — so untouched parts of the file (comments, formatting,
// unrelated jobs) are left byte-for-byte alone.

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job'

/** A job id that doesn't collide with any existing job. */
export function nextJobId(jobs: WorkflowJobNode[], wanted: string): string {
  const base = slugify(wanted)
  const ids = new Set(jobs.map(j => j.id))
  if (!ids.has(base)) return base
  let n = 2
  while (ids.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Appends a new job (with one placeholder step) to the end of the `jobs:`
 *  block. Returns the updated content and the new job's id. */
export function insertJob(content: string, name: string): { content: string; id: string } {
  const graph = parseWorkflowYaml(content)
  const id = nextJobId(graph.jobs, name)
  const jobInd  = ' '.repeat(graph.jobIndent)
  const bodyInd = ' '.repeat(graph.jobBodyIndent)
  const stepInd = ' '.repeat(graph.stepItemIndent)
  const subInd  = ' '.repeat(graph.stepItemIndent + 2)

  const block = [
    `${jobInd}${id}:`,
    `${bodyInd}name: ${name}`,
    `${bodyInd}runs-on: ubuntu-latest`,
    `${bodyInd}steps:`,
    `${stepInd}- name: New step`,
    `${subInd}run: echo "TODO"`,
  ]

  const lines = content.split(/\r?\n/)
  if (graph.jobsKeyLine === undefined) {
    lines.push('jobs:', ...block)
  } else {
    lines.splice(graph.jobsInsertLine - 1, 0, ...block)
  }
  return { content: lines.join('\n'), id }
}

/** Adds `sourceId` to `targetId`'s `needs:`, rewriting whatever shape the
 *  existing `needs:` value already has (or adding one as a plain scalar
 *  if there wasn't one). No-op if the edge already exists. */
export function addNeedsEdge(content: string, sourceId: string, targetId: string): string {
  const graph = parseWorkflowYaml(content)
  const target = graph.jobs.find(j => j.id === targetId)
  if (!target || target.needs.includes(sourceId)) return content

  const lines = content.split(/\r?\n/)

  if (target.needsLine === undefined) {
    lines.splice(target.bodyInsertLine - 1, 0, `${' '.repeat(graph.jobBodyIndent)}needs: ${sourceId}`)
  } else if (target.needsStyle === 'scalar') {
    const ln = target.needsLine - 1
    const m = lines[ln].match(/^(\s*needs:\s*)(.+)$/)
    const existing = m ? unquoteList(m[2]) : target.needs
    lines[ln] = `${m ? m[1] : lines[ln]}[${[...existing, sourceId].join(', ')}]`
  } else if (target.needsStyle === 'flow') {
    const ln = target.needsLine - 1
    lines[ln] = lines[ln].replace(/\]\s*(#.*)?$/, (m, comment) => `, ${sourceId}]${comment ?? ''}`)
  } else if (target.needsStyle === 'block' && target.needsBlockEndLine !== undefined) {
    const itemInd = ' '.repeat(graph.jobBodyIndent + 2)
    lines.splice(target.needsBlockEndLine - 1, 0, `${itemInd}- ${sourceId}`)
  }

  return lines.join('\n')
}

function unquoteList(flowValue: string): string[] {
  const inner = flowValue.replace(/^\[/, '').replace(/\]\s*$/, '')
  return inner.split(',').map(s => s.trim()).filter(Boolean)
}

/** Sets (or clears, when `expr` is undefined) a job's `if:` condition. */
export function setJobCondition(content: string, jobId: string, expr: string | undefined): string {
  const graph = parseWorkflowYaml(content)
  const job = graph.jobs.find(j => j.id === jobId)
  if (!job) return content

  const lines = content.split(/\r?\n/)
  // Block-scalar `if:` values span ifLine..ifEndLine — the whole range must
  // be removed/replaced together, or its continuation lines are left behind
  // as orphaned text that breaks the file's YAML.
  const ifSpan = job.ifLine !== undefined ? (job.ifEndLine ?? job.ifLine) - job.ifLine + 1 : 0

  if (expr === undefined) {
    if (job.ifLine !== undefined) lines.splice(job.ifLine - 1, ifSpan)
    return lines.join('\n')
  }

  const text = `${' '.repeat(graph.jobBodyIndent)}if: \${{ ${expr} }}`
  if (job.ifLine !== undefined) lines.splice(job.ifLine - 1, ifSpan, text)
  else lines.splice(job.bodyInsertLine - 1, 0, text)
  return lines.join('\n')
}

export type LinkCondition = 'pass' | 'fail' | 'other'

/** Reads back the condition a `needs:` edge into `target` effectively runs
 *  under, based on `target`'s own `if:` expression (job-level `if:` is the
 *  only place GitHub Actions lets you express this, so one expression is
 *  treated as describing all of a job's inbound edges). */
export function edgeCondition(target: WorkflowJobNode, sourceId: string): LinkCondition {
  if (!target.ifExpr) return 'pass'
  if (target.ifExpr === `needs.${sourceId}.result == 'failure'`) return 'fail'
  return 'other'
}

/** Links two jobs: `targetId` gets `sourceId` added to its `needs:`, and —
 *  for "fail"/"other" — a job-level `if:` expression describing when it
 *  should run relative to that dependency. "Pass" leaves `if:` untouched,
 *  since requiring success is already the default GitHub Actions behavior
 *  for a job with `needs:`. */
export function linkJobs(content: string, sourceId: string, targetId: string, condition: LinkCondition, customExpr?: string): string {
  let next = addNeedsEdge(content, sourceId, targetId)
  if (condition === 'fail') {
    next = setJobCondition(next, targetId, `needs.${sourceId}.result == 'failure'`)
  } else if (condition === 'other') {
    const expr = (customExpr ?? '').trim()
    next = setJobCondition(next, targetId, expr ? expr.replace(/^\$\{\{\s*|\s*\}\}$/g, '') : 'always()')
  }
  return next
}
