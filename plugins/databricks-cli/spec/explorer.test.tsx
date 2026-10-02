import { expect, mock, test } from 'claude-code/testing'

type Ran = string[][]
const opens: unknown[] = []
const closes: unknown[] = []
const PLUGIN = 'databricks-cli'
const PANE = 'databricks-explorer'
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
    return { value: true }
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

test('Windows: objects open through cmd start; databricks auth is ignored', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const clock = world(on, { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, ran, [])
  const ui = await open($, clock, 'terminal')
  await ui.post({ press: 'S:compute' }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: 'CL:0123-abc', ctrl: true }, { in: 'rows' })
  await clock.settle()
  expect(ran).toContainEqual(['cmd', '/c', 'start', '', `${HOST}/compute/clusters/0123-abc`])
  const before = ran.length
  await $.tool.call({ tool: 'Bash', command: 'databricks auth login --host x' } as any)
  await clock.advance(50)
  expect(ran.length).toBe(before)
  expect(ran.some(a => ['setsid', 'osascript', 'uname', 'find'].includes(a[0] ?? ''))).toBe(false)
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
