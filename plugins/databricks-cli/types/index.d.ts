export type Target = { kind: 'databricks'; profile: string }

export type TreeNode = {
  id: string
  parent: string
  kind: string
  name: string
  path: string
  hidden: boolean
  sig: string
  note: string
  url?: string
}

export type Work = { tone: string; lit: string[]; dim: string[]; since: number; until: number | null }

export type Onboard = { kind: 'missing' | 'signedOut' | 'unreachable'; line: string }

export type Explorer = {
  target: Target | null
  nodes: TreeNode[]
  expanded: string[]
  query: string
  cursor: string
  selected: string
  detail: string[]
  status: string
  work: Work | null
  onboard: Onboard | null
  busy: Record<string, { tone: string; n: number; at: number }>
  scroll: number | null
  root: string
}

declare module 'claude-code' {
  interface PluginState {
    'databricks-cli': {
      explorer: Explorer
      nodes: TreeNode[]
    }
  }
}
