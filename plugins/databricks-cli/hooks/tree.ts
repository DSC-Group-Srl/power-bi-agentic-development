import type { Explorer, TreeNode } from '../types'

export type Row = { node: TreeNode; depth: number; open: boolean; leaf: boolean }

export function empty(): Explorer {
  return {
    target: null,
    nodes: [],
    expanded: [],
    query: '',
    cursor: '',
    selected: '',
    detail: [],
    status: '',
    flash: [],
    flashOn: false,
    flashTones: {},
    busy: {},
    flashDim: [],
    scroll: null,
  }
}

function childrenOf(nodes: TreeNode[]): Map<string, TreeNode[]> {
  const kids = new Map<string, TreeNode[]>()
  for (const n of nodes) {
    const list = kids.get(n.parent)
    if (list) list.push(n)
    else kids.set(n.parent, [n])
  }
  return kids
}

export function ancestors(nodes: TreeNode[], id: string, byId?: Map<string, TreeNode>): string[] {
  const map = byId ?? new Map(nodes.map(n => [n.id, n]))
  const out: string[] = []
  let cur = map.get(id)
  while (cur && cur.parent) {
    out.push(cur.parent)
    cur = map.get(cur.parent)
  }
  return out
}

const RANK: Record<string, number> = { folder: 0, group: 3 }
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sorted(list: TreeNode[]): TreeNode[] {
  return [...list].sort(
    (a, b) => (RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2) || collator.compare(a.name, b.name),
  )
}

export function visible(ex: Explorer, sort = false): Row[] {
  const kids = childrenOf(ex.nodes)
  const q = ex.query.trim().toLowerCase()
  let keep: Set<string> | null = null
  if (q) {
    keep = new Set()
    const byId = new Map(ex.nodes.map(n => [n.id, n]))
    for (const n of ex.nodes) {
      if (!n.name.toLowerCase().includes(q) && !n.note.toLowerCase().includes(q)) continue
      let cur: TreeNode | undefined = n
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id)
        cur = byId.get(cur.parent)
      }
    }
  }
  const open = new Set(ex.expanded)
  const rows: Row[] = []
  const walk = (parent: string, depth: number) => {
    const list = kids.get(parent) ?? []
    for (const n of sort ? sorted(list) : list) {
      if (keep && !keep.has(n.id)) continue
      const leaf = !kids.has(n.id)
      const isOpen = !leaf && (keep ? true : open.has(n.id))
      rows.push({ node: n, depth, open: isOpen, leaf })
      if (isOpen) walk(n.id, depth + 1)
    }
  }
  walk('', 0)
  return rows
}
