let _paneCounter = 0
function newPaneId() { return `pane-${Date.now()}-${++_paneCounter}` }

export type PageId = 'terminal' | 'editor' | 'database' | 'debug' | 'settings' | 'plugins' | 'ports' | 'versioncontrol'

export interface LeafPane {
  type: 'leaf'
  id: string
  tabIds: string[]
  activeTabId: string
  activePage: PageId
}

export interface SplitNode {
  type: 'split'
  id: string
  direction: 'h' | 'v'
  ratio: number
  first: PaneNode
  second: PaneNode
}

export type PaneNode = LeafPane | SplitNode

export function createLeaf(
  tabIds: string[],
  activeTabId: string,
  activePage: PageId = 'terminal',
): LeafPane {
  return { type: 'leaf', id: newPaneId(), tabIds, activeTabId, activePage }
}

export function getFirstLeaf(node: PaneNode): LeafPane {
  return node.type === 'leaf' ? node : getFirstLeaf(node.first)
}

export function getAllLeaves(node: PaneNode): LeafPane[] {
  if (node.type === 'leaf') return [node]
  return [...getAllLeaves(node.first), ...getAllLeaves(node.second)]
}

export function findLeaf(node: PaneNode, paneId: string): LeafPane | null {
  if (node.type === 'leaf') return node.id === paneId ? node : null
  return findLeaf(node.first, paneId) ?? findLeaf(node.second, paneId)
}

export function findLeafForTab(node: PaneNode, tabId: string): LeafPane | null {
  if (node.type === 'leaf') return node.tabIds.includes(tabId) ? node : null
  return findLeafForTab(node.first, tabId) ?? findLeafForTab(node.second, tabId)
}

export function updateLeafInTree(
  node: PaneNode,
  paneId: string,
  updater: (leaf: LeafPane) => LeafPane,
): PaneNode {
  if (node.type === 'leaf') return node.id === paneId ? updater(node) : node
  return {
    ...node,
    first: updateLeafInTree(node.first, paneId, updater),
    second: updateLeafInTree(node.second, paneId, updater),
  }
}

export function updateRatioInTree(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio }
  return {
    ...node,
    first: updateRatioInTree(node.first, splitId, ratio),
    second: updateRatioInTree(node.second, splitId, ratio),
  }
}

export function splitPaneInTree(
  root: PaneNode,
  paneId: string,
  direction: 'h' | 'v',
  newLeaf: LeafPane,
  newLeafFirst = false,
): PaneNode {
  if (root.type === 'leaf') {
    if (root.id !== paneId) return root
    const [first, second] = newLeafFirst ? [newLeaf, root] : [root, newLeaf]
    return { type: 'split', id: newPaneId(), direction, ratio: 0.5, first, second }
  }
  return {
    ...root,
    first: splitPaneInTree(root.first, paneId, direction, newLeaf, newLeafFirst),
    second: splitPaneInTree(root.second, paneId, direction, newLeaf, newLeafFirst),
  }
}

export function closePaneInTree(root: PaneNode, paneId: string): PaneNode | null {
  if (root.type === 'leaf') return root.id === paneId ? null : root
  const newFirst = closePaneInTree(root.first, paneId)
  const newSecond = closePaneInTree(root.second, paneId)
  if (newFirst === null) return newSecond
  if (newSecond === null) return newFirst
  return { ...root, first: newFirst, second: newSecond }
}

export function addTabToLeaf(root: PaneNode, paneId: string, tabId: string): PaneNode {
  return updateLeafInTree(root, paneId, leaf => {
    if (leaf.tabIds.includes(tabId)) return { ...leaf, activeTabId: tabId }
    return { ...leaf, tabIds: [...leaf.tabIds, tabId], activeTabId: tabId }
  })
}

export function removeTabFromTree(root: PaneNode, tabId: string): PaneNode {
  if (root.type === 'leaf') {
    if (!root.tabIds.includes(tabId)) return root
    const newTabIds = root.tabIds.filter(id => id !== tabId)
    const newActiveTabId = root.activeTabId === tabId
      ? (newTabIds[newTabIds.length - 1] ?? '')
      : root.activeTabId
    return { ...root, tabIds: newTabIds, activeTabId: newActiveTabId }
  }
  return {
    ...root,
    first: removeTabFromTree(root.first, tabId),
    second: removeTabFromTree(root.second, tabId),
  }
}

export function moveTabToPane(root: PaneNode, tabId: string, toPaneId: string): PaneNode {
  return addTabToLeaf(removeTabFromTree(root, tabId), toPaneId, tabId)
}

// ── Persistence ────────────────────────────────────────────────────────────────

export interface SerializedNode {
  t: 'l' | 's'
  id: string
  tids?: string[]
  aid?: string
  pg?: string
  dir?: 'h' | 'v'
  r?: number
  a?: SerializedNode
  b?: SerializedNode
}

export function serializeLayout(node: PaneNode): SerializedNode {
  if (node.type === 'leaf') {
    return { t: 'l', id: node.id, tids: node.tabIds, aid: node.activeTabId, pg: node.activePage }
  }
  return {
    t: 's', id: node.id, dir: node.direction, r: node.ratio,
    a: serializeLayout(node.first), b: serializeLayout(node.second),
  }
}

export function deserializeLayout(s: SerializedNode, validTabIds: Set<string>): PaneNode | null {
  if (s.t === 'l') {
    const tabIds = (s.tids ?? []).filter(id => validTabIds.has(id))
    if (tabIds.length === 0) return null
    const activeTabId = tabIds.includes(s.aid ?? '') ? s.aid! : tabIds[0]
    return { type: 'leaf', id: s.id, tabIds, activeTabId, activePage: (s.pg as PageId) ?? 'terminal' }
  }
  if (!s.a || !s.b) return null
  const first = deserializeLayout(s.a, validTabIds)
  const second = deserializeLayout(s.b, validTabIds)
  if (!first && !second) return null
  if (!first) return second!
  if (!second) return first
  return { type: 'split', id: s.id, direction: s.dir!, ratio: s.r ?? 0.5, first, second }
}
