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
}

export interface WorkflowGraph {
  triggers: WorkflowTriggerNode[]
  jobs:     WorkflowJobNode[]
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

function parseJobs(lines: Line[]): WorkflowJobNode[] {
  const idx = lines.findIndex(l => l.indent === 0 && /^jobs\s*:/.test(l.text))
  if (idx < 0) return []

  const jobsChildren = blockChildren(lines, idx)
  const jobLines = directChildren(jobsChildren)
  const jobs: WorkflowJobNode[] = []

  for (const jobLine of jobLines) {
    const { key: jobId } = splitKeyValue(jobLine.text)
    if (!jobId) continue

    const jobIdx = jobsChildren.indexOf(jobLine)
    const jobChildren = blockChildren(jobsChildren, jobIdx)
    const directJobChildren = directChildren(jobChildren)

    let name = jobId
    let needs: string[] = []
    let steps: WorkflowStepNode[] = []
    let stepsInsertLine = jobLine.lineNo + 1

    for (const c of directJobChildren) {
      const { key, value } = splitKeyValue(c.text)
      if (key === 'name' && value) {
        name = unquote(value)
      } else if (key === 'needs') {
        if (value.startsWith('[')) needs = parseFlowList(value)
        else if (value) needs = [unquote(value)]
        else {
          const cIdx = jobChildren.indexOf(c)
          needs = directChildren(blockChildren(jobChildren, cIdx))
            .map(n => splitKeyValue(n.text).key)
            .filter(Boolean)
        }
      } else if (key === 'steps') {
        const cIdx = jobChildren.indexOf(c)
        const stepsBlock = blockChildren(jobChildren, cIdx)
        steps = parseSteps(stepsBlock)
        stepsInsertLine = stepsBlock.length > 0
          ? stepsBlock[stepsBlock.length - 1].lineNo + 1
          : c.lineNo + 1
      }
    }

    jobs.push({ id: jobId, name, needs, steps, line: jobLine.lineNo, stepsInsertLine })
  }

  return jobs
}

export function parseWorkflowYaml(content: string): WorkflowGraph {
  const lines = tokenize(content)
  return {
    triggers: parseTriggers(lines),
    jobs:     parseJobs(lines),
  }
}
