import { expect, mock, test } from 'claude-code/testing'
import { tokenize } from '../hooks/parse'

type Ran = string[][]
const opens: unknown[] = []
const closes: unknown[] = []
const PLUGIN = 'databricks-cli'
const PANE = 'databricks-pane'
const HOST = 'https://dbc-demo.cloud.databricks.com'
const DATA: Record<string, unknown> = {
  'workspace list /': [
    { object_type: 'DIRECTORY', path: '/Users' },
    { object_type: 'DIRECTORY', path: '/Shared' },
  ],
  'workspace list /Shared': [
    { object_type: 'NOTEBOOK', path: '/Shared/etl', language: 'PYTHON', object_id: 11 },
    { object_type: 'FILE', path: '/Shared/readme.md', object_id: 12 },
  ],
  'catalogs list': [{ name: 'main', catalog_type: 'MANAGED_CATALOG' }],
  'schemas list main': [{ name: 'sales', full_name: 'main.sales' }],
  'tables list main sales': [
    { name: 'orders', full_name: 'main.sales.orders', table_type: 'MANAGED' },
    { name: 'orders_v', full_name: 'main.sales.orders_v', table_type: 'VIEW' },
  ],
  'volumes list main sales': [{ name: 'raw', full_name: 'main.sales.raw', volume_type: 'MANAGED' }],
  'clusters list': [{ cluster_id: '0123-abc', cluster_name: 'shared', state: 'RUNNING' }],
  'warehouses list': [{ id: 'wh1', name: 'Serverless', state: 'STOPPED' }],
  'jobs list': Array.from({ length: 60 }, (_, i) => ({ job_id: 100 + i, settings: { name: `job ${String(i).padStart(2, '0')}` } })),
  'pipelines list-pipelines': [],
  'apps list': [],
  'lakeview list': [],
}

const truncated = new Set<string>()
const failingDb = new Set<string>()
let gate: { key: string; wait: Promise<void> } | null = null

function world(on: any, env: Record<string, string>, ran: Ran, copied: string[]) {
  mock.env(on, env)
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
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
    return { value: { isCopied: true } }
  })
  on('fs.read', (_$: any, e: any) => {
    if (String(e.path).replace(/\\/g, '/').endsWith('/.databrickscfg')) return { value: `[DEFAULT]\nhost = ${HOST}\n` }
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('process.run', async (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    ran.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'uname') return ok(env.HOME?.startsWith('/Users') ? 'Darwin\n' : 'Linux\n')
    if (argv[0] === 'sh') return ok('missing\n')
    if (argv[0] === 'databricks') {
      const key = argv.slice(1).filter((a, i, all) => a !== '-o' && all[i - 1] !== '-o' && a !== '-p' && all[i - 1] !== '-p' && !a.startsWith('--omit-')).join(' ')
      if (gate && gate.key === key) await gate.wait
      if (failingDb.has(key)) return { value: { exitCode: 1, stdout: '', stderr: 'PERMISSION_DENIED', isStdoutTruncated: false, isStderrTruncated: false } }
      if (truncated.has(key)) return { value: { exitCode: 0, stdout: JSON.stringify(DATA[key] ?? []).slice(0, 20), stderr: '', isStdoutTruncated: true, isStderrTruncated: false } }
      return ok(JSON.stringify(DATA[key] ?? []))
    }
    return ok('')
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return clock
}

const paneProps = { title: 'Databricks', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} } as any
const rowsOf = async (ui: any) => {
  const find = (n: any): any => (n?.type === 'Client' && n.props?.key === 'rows' ? n : (n?.children ?? []).map(find).find(Boolean))
  return find(await ui.drawn())?.props.props
}
const ids = (p: any) => p.rows.map((r: any) => r.id)
const NERD = /[\u{e000}-\u{f8ff}\u{f0000}-\u{fffff}]/u

async function open($: any, clock: any, surface: 'terminal' | 'desktop') {
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.settle()
  await $.command.run({ command: PANE, args: '', origin: { kind: 'person' } } as any)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: paneProps })
  await clock.settle()
  return ui
}

test('macOS app: sections browse like a file tree, copy CLI arguments, open objects in Databricks', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/Users/k' }, ran, copied)
  const ui = await open($, clock, 'desktop')
  let p = await rowsOf(ui)
  expect(ids(p)).toEqual(['S:workspace', 'S:catalog', 'S:compute', 'S:jobs', 'S:pipelines', 'S:apps', 'S:dashboards'])
  expect(NERD.test(JSON.stringify(p.rows))).toBe(false)
  for (const id of ['S:catalog', 'UC:main', 'UC:main.sales']) {
    await ui.post({ press: id }, { in: 'rows' })
    await clock.settle()
  }
  p = await rowsOf(ui)
  expect(ids(p)).toEqual(expect.arrayContaining(['UC:main.sales.orders', 'UC:main.sales.orders_v', 'UV:main.sales.raw']))
  await ui.post({ press: 'UC:main.sales.orders' }, { in: 'rows' })
  await clock.settle()
  await ui.post({ copy: 'UC:main.sales.orders' }, { in: 'rows' })
  await clock.settle()
  expect(copied).toEqual(['main.sales.orders'])
  await ui.post({ press: 'UC:main.sales.orders', ctrl: true }, { in: 'rows' })
  await clock.settle()
  expect(ran).toContainEqual(['open', `${HOST}/explore/data/main/sales/orders`])
  const sent = await $.prompt.submit({ text: 'describe this', wait: false } as any)
  expect(JSON.stringify(sent)).toContain('databricks CLI argument: main.sales.orders')
  await ui.unmount()
})

test('long sections scroll, and a databricks command Claude runs lights the object even when scrolled away', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const clock = world(on, { HOME: '/home/k' }, ran, [])
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'S:jobs' }, { in: 'rows' })
  await clock.settle()
  let p = await rowsOf(ui)
  expect(p.bar).toBeDefined()
  await ui.post({ scrollTo: 1 }, { in: 'rows' })
  await clock.settle()
  p = await rowsOf(ui)
  expect(ids(p)).not.toContain('S:catalog')
  await $.tool.call({ tool: 'Bash', command: 'databricks tables get main.sales.orders -o json' } as any)
  await clock.advance(50)
  p = await rowsOf(ui)
  const row = p.rows.find((r: any) => r.id === 'UC:main.sales.orders')
  expect(JSON.stringify(row)).toContain('"sh":"purple"')
  await $.tool.call({ tool: 'Bash', command: 'databricks workspace import /Shared/etl --file etl.py --language PYTHON --overwrite' } as any)
  await clock.advance(50)
  p = await rowsOf(ui)
  expect(JSON.stringify(p.rows.find((r: any) => r.id === 'WS:/Shared/etl'))).toContain('"sh":"pink"')
  await $.tool.call({ tool: 'Bash', command: 'databricks jobs run-now 105' } as any)
  await clock.advance(50)
  p = await rowsOf(ui)
  expect(JSON.stringify(p.rows.find((r: any) => r.id === 'J:105'))).toContain('"sh":"orange"')
  await $.tool.call({ tool: 'Bash', command: 'databricks schemas create staging main' } as any)
  await clock.advance(50)
  await ui.post({ scrollTo: 0 }, { in: 'rows' })
  await clock.settle()
  p = await rowsOf(ui)
  expect(ids(p)).toContain('UC:main.sales.orders')
  expect(JSON.stringify(p.rows)).not.toContain('loading')
  await ui.unmount()
})

test('Windows: objects open through rundll32 with the URL as one literal argument; databricks auth is ignored', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const clock = world(on, { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, ran, [])
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'S:compute' }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: 'CL:0123-abc', ctrl: true }, { in: 'rows' })
  await clock.settle()
  expect(ran).toContainEqual(['rundll32', 'url.dll,FileProtocolHandler', `${HOST}/compute/clusters/0123-abc`])
  const before = ran.length
  await $.tool.call({ tool: 'Bash', command: 'databricks auth login --host x' } as any)
  await clock.advance(50)
  expect(ran.length).toBe(before)
  expect(ran.some(a => ['cmd', 'setsid', 'osascript', 'uname', 'find'].includes(a[0] ?? ''))).toBe(false)
  await ui.unmount()
})

test('sidebar only: no pane in the default layout or a narrow terminal, and an inline pane closes itself', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/Users/k' }, ran, copied)
  const before = opens.length
  const main = await $.command.run({ command: PANE, args: '', origin: { kind: 'person' }, presentation: { isFullscreen: false, columns: 200 } } as any)
  expect(JSON.stringify(main)).toContain('/tui fullscreen')
  const narrow = await $.command.run({ command: PANE, args: '', origin: { kind: 'person' }, presentation: { isFullscreen: true, columns: 90 } } as any)
  expect(JSON.stringify(narrow)).toContain('110 columns')
  expect(opens.length).toBe(before)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...paneProps, placement: 'inline' } })
  await clock.settle()
  expect(closes.length).toBeGreaterThan(0)
  await ui.unmount()
  void copied
})

test('schemas list tables without column payloads, and a cut-off listing shows an error instead of an empty schema', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  truncated.add('tables list main sales')
  const ui = await open($, clock, 'terminal')
  for (const id of ['S:catalog', 'UC:main', 'UC:main.sales']) {
    await ui.post({ press: id }, { in: 'rows' })
    await clock.settle()
  }
  expect(ran.some(a => a[1] === 'tables' && a.includes('--omit-columns') && a.includes('--omit-properties'))).toBe(true)
  expect(JSON.stringify(await ui.drawn())).toContain('too much output')
  truncated.clear()
  await ui.unmount()
})

test('a listing that started under one profile does not land after Claude switches profile', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  let release = () => {}
  gate = { key: 'catalogs list', wait: new Promise<void>(r => (release = r)) }
  void ui.post({ press: 'S:catalog' }, { in: 'rows' })
  await clock.advance(20)
  await $.tool.call({ tool: 'Bash', command: 'databricks -p prod clusters list' } as any)
  await clock.advance(50)
  release()
  gate = null
  await clock.settle()
  await clock.advance(600)
  await ui.post({ press: 'S:catalog' }, { in: 'rows' })
  await clock.settle()
  expect(ran.some(a => a[1] === 'catalogs' && a.includes('prod'))).toBe(true)
  await ui.unmount()
})

test('a local file name in fs cp is not taken for a Unity Catalog table', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  const before = ran.filter(a => a[1] === 'catalogs').length
  await $.tool.call({ tool: 'Bash', command: 'databricks fs cp report.v1.csv dbfs:/tmp/report.csv' } as any)
  await clock.settle()
  expect(ran.filter(a => a[1] === 'catalogs').length).toBe(before)
  await ui.unmount()
})

test('a job Claude creates reloads the open Jobs section, and /Workspace paths match the tree', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'S:jobs' }, { in: 'rows' })
  await clock.settle()
  const jobs = () => ran.filter(a => a[1] === 'jobs' && a[2] === 'list').length
  const before = jobs()
  await $.tool.call({ tool: 'Bash', command: 'databricks jobs create --json @job.json' } as any)
  await clock.settle()
  expect(jobs() - before).toBe(1)
  await clock.advance(600)
  await ui.post({ press: 'S:workspace' }, { in: 'rows' })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'databricks workspace export /Workspace/Shared/etl --file ./etl.py' } as any)
  await clock.advance(50)
  const p = await rowsOf(ui)
  expect(JSON.stringify(p.rows.find((r: any) => r.id === 'WS:/Shared/etl'))).toContain('"sh":"teal"')
  await ui.unmount()
})

test('plain calls count under DATABRICKS_CONFIG_PROFILE and after an explicit -p DEFAULT', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k', DATABRICKS_CONFIG_PROFILE: 'dev' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  const cats = () => ran.filter(a => a[1] === 'catalogs' && a[2] === 'list').length
  await $.tool.call({ tool: 'Bash', command: 'databricks tables get main.sales.orders' } as any)
  await clock.settle()
  expect(cats()).toBe(1)
  await ui.unmount()
})

test('-p DEFAULT and plain calls address the same workspace', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  await $.tool.call({ tool: 'Bash', command: 'databricks -p DEFAULT current-user me' } as any)
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'databricks tables get main.sales.orders' } as any)
  await clock.settle()
  expect(ran.filter(a => a[1] === 'catalogs' && a[2] === 'list').length).toBe(1)
  await ui.unmount()
})

test('a schema whose volumes listing fails keeps retrying instead of showing only tables', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  failingDb.add('volumes list main sales')
  const ui = await open($, clock, 'terminal')
  for (const id of ['S:catalog', 'UC:main', 'UC:main.sales']) {
    await ui.post({ press: id }, { in: 'rows' })
    await clock.settle()
  }
  expect(JSON.stringify(await ui.drawn())).toContain('PERMISSION_DENIED')
  expect(ids(await rowsOf(ui))).not.toContain('UC:main.sales.orders')
  failingDb.clear()
  await clock.advance(600)
  await ui.post({ press: 'UC:main.sales' }, { in: 'rows' })
  await clock.settle()
  await clock.advance(600)
  await ui.post({ press: 'UC:main.sales' }, { in: 'rows' })
  await clock.settle()
  expect(ids(await rowsOf(ui))).toContain('UC:main.sales.orders')
  expect(JSON.stringify(await ui.drawn())).not.toContain('PERMISSION_DENIED')
  await ui.unmount()
})

test('job runs re-list nothing, a bundle deploy reloads the open Jobs section', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'S:jobs' }, { in: 'rows' })
  await clock.settle()
  const jobs = () => ran.filter(a => a[1] === 'jobs' && a[2] === 'list').length
  const before = jobs()
  await $.tool.call({ tool: 'Bash', command: 'databricks jobs run-now 105 && databricks jobs cancel-run 77' } as any)
  await clock.settle()
  expect(jobs()).toBe(before)
  await $.tool.call({ tool: 'Bash', command: 'databricks bundle deploy -t dev' } as any)
  await clock.settle()
  expect(jobs()).toBe(before + 1)
  await ui.unmount()
})

test('tables create targets catalog.schema.table, a started cluster refreshes Compute, and a cut-off reload shows its error', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  for (const id of ['S:catalog', 'UC:main', 'UC:main.sales']) {
    await ui.post({ press: id }, { in: 'rows' })
    await clock.settle()
  }
  const tables = () => ran.filter(a => a[1] === 'tables' && a[2] === 'list').length
  const before = tables()
  await $.tool.call({ tool: 'Bash', command: 'databricks tables create customers main sales EXTERNAL DELTA s3://b/t' } as any)
  await clock.settle()
  expect(tables()).toBe(before + 1)
  await clock.advance(600)
  await ui.post({ press: 'S:compute' }, { in: 'rows' })
  await clock.settle()
  const clusters = () => ran.filter(a => a[1] === 'clusters' && a[2] === 'list').length
  const c0 = clusters()
  await $.tool.call({ tool: 'Bash', command: 'databricks clusters start 0123-abc' } as any)
  await clock.settle()
  expect(clusters()).toBe(c0 + 1)
  truncated.add('clusters list')
  await $.tool.call({ tool: 'Bash', command: 'databricks clusters start 0123-abc' } as any)
  await clock.settle()
  truncated.clear()
  expect(JSON.stringify(await ui.drawn())).toContain('too much output')
  await ui.unmount()
})

test('follow off: Claude touching objects far away or in a catalog above never moves the view; the wheel still does', { timeoutMs: 20_000, options: { follow: 'off' } } as any, async ($: any, on: any) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'S:jobs' }, { in: 'rows' })
  await clock.settle()
  await $.ui.scroll({ component: 'Pane', requestId: PANE, by: 20 })
  await clock.settle()
  const top = (await rowsOf(ui)).rows[0]?.id
  expect(top).not.toBe('S:workspace')
  await $.tool.call({ tool: 'Bash', command: 'databricks jobs get 158' } as any)
  await clock.settle()
  expect((await rowsOf(ui)).rows[0]?.id).toBe(top)
  await $.tool.call({ tool: 'Bash', command: 'databricks tables get main.sales.orders' } as any)
  await clock.settle()
  expect((await rowsOf(ui)).rows[0]?.id).toBe(top)
  await $.ui.scroll({ component: 'Pane', requestId: PANE, by: 10 })
  await clock.settle()
  expect((await rowsOf(ui)).rows[0]?.id).not.toBe(top)
  await ui.unmount()
})

test('double-clicking a section navigates into it; home comes back; a SQL statement lights its warehouse purple', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'S:compute' }, { in: 'rows' })
  await clock.advance(100)
  await ui.post({ press: 'S:compute' }, { in: 'rows' })
  await clock.settle()
  let p = await rowsOf(ui)
  expect(ids(p)).not.toContain('S:catalog')
  expect(ids(p)).toContain('SW:wh1')
  await $.tool.call({ tool: 'Bash', command: `databricks api post /api/2.0/sql/statements --json '{"warehouse_id": "wh1", "statement": "SELECT 1"}'` } as any)
  await clock.advance(50)
  p = await rowsOf(ui)
  expect(JSON.stringify(p.rows.find((r: any) => r.id === 'SW:wh1'))).toContain('"sh":"purple"')
  await clock.settle()
  await ui.press({ key: 'home' })
  await clock.settle()
  expect(ids(await rowsOf(ui))).toContain('S:catalog')
  await ui.unmount()
})

test('plain glyphs: sections, catalog objects, navigation and buttons draw without any private-use characters', { timeoutMs: 20_000, options: { glyphs: 'plain' } } as any, async ($: any, on: any) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  for (const id of ['S:workspace', 'S:catalog', 'UC:main', 'UC:main.sales', 'S:compute', 'S:jobs']) {
    await clock.advance(600)
    await ui.post({ press: id }, { in: 'rows' })
    await clock.settle()
  }
  expect(JSON.stringify(await ui.drawn())).not.toMatch(NERD)
  await clock.advance(600)
  await ui.post({ press: 'UC:main' }, { in: 'rows' })
  await clock.advance(100)
  await ui.post({ press: 'UC:main' }, { in: 'rows' })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(NERD)
  await ui.unmount()
})

test('&> stays one redirection operator', { timeoutMs: 5_000 }, async () => {
  const tokens = tokenize('databricks catalogs list &> /dev/null')
  expect(tokens).toContain('&>')
  expect(tokens).not.toContain('&')
})

test('without the icon fonts Claude gets a one-line font hint once per session, unless fontHint is off', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  const first = JSON.stringify(await $.prompt.submit({ text: 'hi', context: [] } as any))
  expect(first).toContain('github.com/data-goblin/databricks-nf')
  expect(first).toContain('fontHint=off')
  expect(JSON.stringify(await $.prompt.submit({ text: 'hi', context: [] } as any))).not.toContain('databricks-nf')
  await ui.unmount()
})

test('fontHint off keeps the font hint out of prompts', { timeoutMs: 20_000, options: { fontHint: 'off' } } as any, async ($: any, on: any) => {
  const ran: Ran = []
  const copied: string[] = []
  const clock = world(on, { HOME: '/home/k' }, ran, copied)
  const ui = await open($, clock, 'terminal')
  expect(JSON.stringify(await $.prompt.submit({ text: 'hi', context: [] } as any))).not.toContain('databricks-nf')
  await ui.unmount()
})
