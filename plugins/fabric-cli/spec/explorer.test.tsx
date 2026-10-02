import { expect, mock, test } from 'claude-code/testing'

type Ran = string[][]
const opens: unknown[] = []
const closes: unknown[] = []
const PLUGIN = 'fabric-cli'
const PANE = 'fabric-explorer'
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const WORKSPACES = [...Array.from({ length: 60 }, (_, i) => ({ name: `WS${String(i).padStart(2, '0')}.Workspace`, id: UUID(i + 1) })), { name: 'My WS.Workspace', id: UUID(99) }]
const ITEMS: Record<string, { name: string; id: string }[]> = {
  'WS00.Workspace': [
    { name: 'Sales.SemanticModel', id: UUID(900) },
    { name: 'Sales.Report', id: UUID(901) },
    { name: 'LH.Lakehouse', id: UUID(902) },
    { name: 'Ops.Folder', id: UUID(903) },
  ],
  'WS00.Workspace/Ops.Folder': [{ name: 'Deep.Notebook', id: UUID(904) }],
  'My WS.Workspace': [{ name: 'My Model.SemanticModel', id: UUID(905) }],
}
let onTool: ((e: any) => Promise<void>) | null = null
const failing = new Set<string>()

function world(on: any, env: Record<string, string>, ran: Ran) {
  mock.env(on, env)
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  const copied: string[] = []
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'test' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', (_$: any, e: any) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: any, e: any) => {
    closes.push(e)
    return {}
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', (_$: any, e: any) => {
    copied.push(e.text)
    return { value: true }
  })
  on('fs.read', () => {
    throw new Error('none')
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    ran.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'uname') return ok(env.OS ? '' : env.HOME?.startsWith('/Users') ? 'Darwin\n' : 'Linux\n')
    if (argv[0] === 'sh') return ok('missing\n')
    if (argv[0] === 'fab' && argv[1] === 'ls') {
      const path = argv[2] && !argv[2].startsWith('-') ? argv[2] : ''
      if (failing.has(path)) return { value: { exitCode: 1, stdout: '', stderr: 'Forbidden', isStdoutTruncated: false, isStderrTruncated: false } }
      const data = path ? (ITEMS[path] ?? []) : WORKSPACES
      return ok(JSON.stringify({ status: 'Success', result: { data } }))
    }
    return ok('')
  })
  on('tool.call', async (_$: any, e: any) => {
    if (onTool) await onTool(e)
    return { result: { stdout: '', stderr: '' } }
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return { clock, copied }
}

const paneProps = (bodyRows: number) => ({ title: 'Fabric', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} }) as any
const rowsOf = async (ui: any) => {
  const find = (n: any): any => (n?.type === 'Client' && n.props?.props?.rows && n.props.key === 'rows' ? n : (n?.children ?? []).map(find).find(Boolean))
  return find(await ui.drawn())?.props.props
}
const NERD = /[\u{e000}-\u{f8ff}\u{f0000}-\u{fffff}]/u

async function open($: any, clock: any, surface: 'terminal' | 'desktop') {
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.settle()
  await $.command.run({ command: PANE, args: '', origin: { kind: 'person' } } as any)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: paneProps(24) })
  await clock.settle()
  return ui
}

test('macOS app: workspaces draw, scroll, copy fab paths, clear search, open the portal and te', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock, copied } = world(on, { HOME: '/Users/k' }, ran)
  const ui = await open($, clock, 'desktop')
  let p = await rowsOf(ui)
  expect(p.rows[0].id).toBe('W:WS00')
  expect(p.bar).toBeDefined()
  expect(NERD.test(JSON.stringify(p.rows))).toBe(false)
  expect(JSON.stringify(p.rows)).not.toContain('below')
  await $.ui.scroll({ component: 'Pane', requestId: PANE, by: 1 } as any)
  await clock.settle()
  p = await rowsOf(ui)
  expect(p.rows[0].id).toBe('W:WS03')
  await ui.post({ scrollTo: 0 }, { in: 'rows' })
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  p = await rowsOf(ui)
  expect(JSON.stringify(p.rows)).toContain('W:WS00/Sales.SemanticModel')
  await ui.post({ copy: 'W:WS00/Sales.SemanticModel' }, { in: 'rows' })
  await clock.settle()
  expect(copied).toEqual(['WS00.Workspace/Sales.SemanticModel'])
  await ui.post({ press: 'W:WS00/Sales.SemanticModel', ctrl: true }, { in: 'rows' })
  await clock.settle()
  expect(ran.find(a => a[0] === 'open')?.[1]).toContain(`/groups/${UUID(1)}/datasets/${UUID(900)}`)
  await ui.post({ press: 'W:WS00/Sales.SemanticModel', shift: true }, { in: 'rows' })
  await clock.settle()
  const osa = ran.find(a => a[0] === 'osascript')
  expect(osa?.join(' ')).toContain("'te' 'interactive' '-s' 'WS00' '-d' 'Sales'")
  expect(ran.some(a => a[0] === 'setsid' || a[0] === 'xdg-terminal-exec')).toBe(false)
  await ui.input({ key: 'q', text: 'WS1', kind: 'change' })
  await clock.settle()
  expect(await ui.find({ key: 'clearq' })).toBeDefined()
  await ui.press({ key: 'clearq' })
  await clock.settle()
  expect(await ui.find({ key: 'clearq' })).toBeUndefined()
  await ui.unmount()
})

test('a fab export Claude runs shimmers teal on the item; fab get with -o too', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'fab export "WS00.Workspace/Sales.SemanticModel" -o ./out -f' } as any)
  await clock.advance(50)
  const p = await rowsOf(ui)
  const row = p.rows.find((r: any) => r.id === 'W:WS00/Sales.SemanticModel')
  expect(JSON.stringify(row)).toContain('"sh":"teal"')
  await ui.unmount()
})

test('Windows: the portal and te open through cmd start, never setsid or osascript', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: 'W:WS00/Sales.SemanticModel', ctrl: true }, { in: 'rows' })
  await ui.post({ press: 'W:WS00/Sales.SemanticModel', shift: true }, { in: 'rows' })
  await clock.settle()
  const starts = ran.filter(a => a[0] === 'cmd')
  expect(starts.length).toBe(2)
  expect(starts[0]?.slice(0, 4)).toEqual(['cmd', '/c', 'start', ''])
  expect(starts[1]?.at(-1)).toBe('te interactive -s WS00 -d Sales')
  expect(ran.some(a => ['setsid', 'osascript', 'uname', 'xdg-terminal-exec'].includes(a[0] ?? ''))).toBe(false)
  await ui.unmount()
})

const OPS: [string, string, string][] = [
  ['fab ls "WS00.Workspace" -l', 'W:WS00', 'purple'],
  ['fab exists "WS00.Workspace/Sales.Report"', 'W:WS00/Sales.Report', 'purple'],
  ['fab get "WS00.Workspace/Sales.SemanticModel" -q definition', 'W:WS00/Sales.SemanticModel', 'purple'],
  ['fab get "WS00.Workspace/Sales.SemanticModel" -q definition -o ./out', 'W:WS00/Sales.SemanticModel', 'teal'],
  ['fab export "WS00.Workspace/Sales.Report" -o ./out -f', 'W:WS00/Sales.Report', 'teal'],
  ['fab bulk-export "WS00.Workspace" -o ./bk', 'W:WS00', 'teal'],
  ['fab cp "WS00.Workspace/Sales.Report" ./local/', 'W:WS00/Sales.Report', 'teal'],
  ['fab cp ./local/Sales.Report "WS00.Workspace/Sales.Report" -f', 'W:WS00/Sales.Report', 'pink'],
  ['fab import "WS00.Workspace/Sales.Report" -i ./dir -f', 'W:WS00/Sales.Report', 'pink'],
  ['fab set "WS00.Workspace/Sales.Report" -q displayName -i Renamed -f', 'W:WS00/Sales.Report', 'orange'],
  ['fab mkdir "WS00.Workspace/New.Notebook"', 'W:WS00', 'orange'],
  ['fab rm "WS00.Workspace/Gone.Notebook" -f', 'W:WS00', 'orange'],
  ['fab job run "WS00.Workspace/Ops.Folder/Deep.Notebook"', 'W:WS00/Ops.Folder/Deep.Notebook', 'orange'],
  ['fab job run-status "WS00.Workspace/Ops.Folder/Deep.Notebook" --id 1', 'W:WS00/Ops.Folder/Deep.Notebook', 'purple'],
  ['fab table optimize "WS00.Workspace/LH.Lakehouse/Tables/sales" --vorder', 'W:WS00/LH.Lakehouse', 'orange'],
  ['fab table schema "WS00.Workspace/LH.Lakehouse/Tables/sales"', 'W:WS00/LH.Lakehouse', 'purple'],
  ['fab ls "WS00.Workspace/LH.Lakehouse/Files/raw"', 'W:WS00/LH.Lakehouse', 'purple'],
  ['fab acl get "WS00.Workspace"', 'W:WS00', 'purple'],
  ['fab acl set "WS00.Workspace" -I u@x.com -R viewer -f', 'W:WS00', 'orange'],
  ['fab assign ".capacities/cap.Capacity" -W "WS00.Workspace" -f', 'W:WS00', 'orange'],
  ['fab start "WS00.Workspace/Mirror.MirroredDatabase" -f', 'W:WS00', 'orange'],
  ['fab cd "WS00.Workspace" && fab get "Sales.Report"', 'W:WS00/Sales.Report', 'purple'],
  ["fab get 'My WS.Workspace/My Model.SemanticModel' -q . | jq .", 'W:My WS/My Model.SemanticModel', 'purple'],
]

test('every fab operation class lights the right item in the right tone', { timeoutMs: 60_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  const misses: string[] = []
  for (const [command, id, tone] of OPS) {
    await $.tool.call({ tool: 'Bash', command } as any)
    await clock.advance(50)
    const p = await rowsOf(ui)
    const row = p.rows.find((r: any) => r.id === id)
    if (!JSON.stringify(row ?? {}).includes(`"sh":"${tone}"`)) misses.push(`${command} -> ${id} ${tone}: ${row ? 'wrong tone' : 'not in view'}`)
    await clock.advance(3000)
  }
  expect(misses).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'fab find "sales"' } as any)
  await clock.advance(50)
  await ui.unmount()
})

test('auth, config, help and commented-out fab commands are ignored', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  for (const command of ['fab auth status', 'fab config set mode command_line', 'fab --version', 'fab desc .Workspace', 'echo hi # fab rm "WS00.Workspace/Sales.Report" -f']) {
    await $.tool.call({ tool: 'Bash', command } as any)
    await clock.advance(50)
  }
  expect(ran.filter(a => a[0] === 'fab')).toEqual([])
})

test('Claude activity scrolls into view; a user scroll stays put without activity', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ scrollTo: 1 }, { in: 'rows' })
  await clock.settle()
  let p = await rowsOf(ui)
  expect(p.rows.some((r: any) => r.id === 'W:WS00')).toBe(false)
  await $.tool.call({ tool: 'Bash', command: 'fab get "WS00.Workspace/Sales.SemanticModel" -q definition' } as any)
  await clock.advance(50)
  p = await rowsOf(ui)
  expect(JSON.stringify(p.rows.find((r: any) => r.id === 'W:WS00/Sales.SemanticModel') ?? {})).toContain('"sh":"purple"')
  await clock.advance(3000)
  await $.ui.scroll({ component: 'Pane', requestId: PANE, by: 3 } as any)
  await clock.settle()
  const top = (await rowsOf(ui)).rows[0].id
  await clock.advance(6000)
  await ui.redraw()
  expect((await rowsOf(ui)).rows[0].id).toBe(top)
  await ui.unmount()
})

test('a running fab command shows a spinner on its workspace', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  let mid = ''
  onTool = async () => {
    await ui.redraw()
    mid = JSON.stringify((await rowsOf(ui)).rows.find((r: any) => r.id === 'W:WS00') ?? {})
  }
  await $.tool.call({ tool: 'Bash', command: 'fab export "WS00.Workspace/Sales.Report" -o ./out -f' } as any)
  onTool = null
  await clock.advance(50)
  expect(mid).toContain('"spin":true')
  await ui.unmount()
})

test('a change in a workspace keeps its open folders expanded', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: 'W:WS00/Ops.Folder' }, { in: 'rows' })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'fab set "WS00.Workspace/Sales.Report" -q displayName -i "Sales 2"' } as any)
  await clock.advance(50)
  const p = await rowsOf(ui)
  expect(JSON.stringify(p.rows)).toContain('W:WS00/Ops.Folder/Deep.Notebook')
  expect(JSON.stringify(p.rows)).not.toContain('loading')
  await ui.unmount()
})

test('sidebar only: no pane in the default layout or a narrow terminal, and an inline pane closes itself', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const { clock } = world(on, { HOME: '/Users/k' }, ran)
  const before = opens.length
  const main = await $.command.run({ command: PANE, args: '', origin: { kind: 'person' }, presentation: { isFullscreen: false, columns: 200 } } as any)
  expect(JSON.stringify(main)).toContain('/tui fullscreen')
  const narrow = await $.command.run({ command: PANE, args: '', origin: { kind: 'person' }, presentation: { isFullscreen: true, columns: 90 } } as any)
  expect(JSON.stringify(narrow)).toContain('110 columns')
  expect(opens.length).toBe(before)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...paneProps(24), placement: 'inline' } })
  await clock.settle()
  expect(closes.length).toBeGreaterThan(0)
  await ui.unmount()
  void copied
})

const lists = (ran: Ran, path: string) => ran.filter(a => a[0] === 'fab' && a[1] === 'ls' && a[2] === path).length

test('a failing workspace is listed once per refresh, and its error clears when another loads', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  failing.add('WS01.Workspace')
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS01' }, { in: 'rows' })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).toContain('error: Forbidden')
  const before = lists(ran, 'WS01.Workspace')
  await ui.press({ key: 'refresh' })
  await clock.settle()
  expect(lists(ran, 'WS01.Workspace') - before).toBe(1)
  failing.delete('WS01.Workspace')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).not.toContain('error: Forbidden')
  await ui.unmount()
})

test('one fab command touching a workspace several times reloads it once', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  const before = lists(ran, 'WS00.Workspace')
  await $.tool.call({ tool: 'Bash', command: 'fab cp WS00.Workspace/Sales.Report WS00.Workspace/Copy.Report && fab rm WS00.Workspace/LH.Lakehouse -f' } as any)
  await clock.settle()
  expect(lists(ran, 'WS00.Workspace') - before).toBe(1)
  await ui.unmount()
})

test('a folder left open under a collapsed workspace loads when the workspace opens again', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: 'W:WS00/Ops.Folder' }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.advance(600)
  await ui.press({ key: 'refresh' })
  await clock.settle()
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  const p = await rowsOf(ui)
  expect(p.rows.some((r: any) => r.id === 'W:WS00/Ops.Folder/Deep.Notebook')).toBe(true)
  await ui.unmount()
})

test('with the pane hidden, fab commands Claude runs list nothing', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  await ui.unmount()
  const inline = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...paneProps(24), placement: 'inline' } })
  await clock.settle()
  const before = ran.filter(a => a[0] === 'fab').length
  await $.tool.call({ tool: 'Bash', command: 'fab set "WS00.Workspace/Sales.SemanticModel" -q description -i x -f' } as any)
  await clock.settle()
  expect(ran.filter(a => a[0] === 'fab').length).toBe(before)
  await inline.unmount()
})

test('a fab command inside a for loop reveals each workspace the loop names', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await $.tool.call({ tool: 'Bash', command: 'for w in WS00 "My WS"; do fab ls "$w.Workspace"; done' } as any)
  await clock.settle()
  expect(lists(ran, 'WS00.Workspace')).toBe(1)
  expect(lists(ran, 'My WS.Workspace')).toBe(1)
  const p = await rowsOf(ui)
  expect(p.rows.some((r: any) => r.id === 'W:My WS/My Model.SemanticModel')).toBe(true)
  await ui.unmount()
})

test('creating or deleting a whole workspace re-lists the tenant instead of listing the workspace', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  const roots = () => ran.filter(a => a[0] === 'fab' && a[1] === 'ls' && a[2] === '-l').length
  const before = roots()
  await $.tool.call({ tool: 'Bash', command: 'fab rm WS05.Workspace -f' } as any)
  await clock.settle()
  expect(roots() - before).toBe(1)
  expect(lists(ran, 'WS05.Workspace')).toBe(0)
  await ui.unmount()
})

test('the selection stops riding along with prompts once the pane is hidden', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const { clock } = world(on, { HOME: '/home/k' }, ran)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'W:WS00' }, { in: 'rows' })
  await clock.settle()
  const shown = await $.prompt.submit({ text: 'what is this', context: [] } as any)
  expect(JSON.stringify(shown)).toContain('WS00')
  await ui.unmount()
  const inline = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...paneProps(24), placement: 'inline' } })
  await clock.settle()
  const hidden = await $.prompt.submit({ text: 'what is this', context: [] } as any)
  expect(JSON.stringify(hidden)).not.toContain('WS00')
  await inline.unmount()
})
