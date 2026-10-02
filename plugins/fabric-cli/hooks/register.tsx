import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Explorer, Target, TreeNode } from '../types'
import { glyph, type Tier } from './icons'
import type { RowSpec, RowsProps, Seg } from './rows'
import { ancestors, empty, visible } from './tree'
import { modelOf, parseChildren, parseWorkspaces, PLACEHOLDER } from './fabric'
import { FAB_TONE, fabCalls, fabKind, fabPositionals, fabWorkspaces, invocations, posix, targetLabel, tokenize, useDrives } from './parse'
import { fabTouched } from './touch'

const STATE = { plugin: 'fabric-cli', key: 'explorer' } as const
const NODES = { plugin: 'fabric-cli', key: 'nodes' } as const
const PANE = 'fabric-explorer'
const TITLE = 'Fabric'
const TITLE_GLYPH = { fabric: 0xf2292, nerd: 'F', plain: 'F' }
const TITLE_COLOR = '#2dd4bf'
const HINT = 'waiting for a fab command, or /fabric-explorer'
const SORT = false
const WINDOW = 400
const DETAIL_ROWS = 12
const HEADER = '#header'
const BUSY_MAX_MS = 600_000
const FLASH_MS = 2700
const DOUBLE_MS = 450
const SHIMMER = ['#f97316', '#fb923c', '#fdba74', '#ffedd5']
const TONES: Record<string, { bright: string[]; dim: string[] }> = {
  orange: { bright: SHIMMER, dim: ['#8a4316', '#a3562a', '#bd7444', '#d29267'] },
  teal: { bright: ['#14b8a6', '#2dd4bf', '#5eead4', '#ccfbf1'], dim: ['#0f5e57', '#16786f', '#2a9488', '#4fb3a8'] },
  pink: { bright: ['#ec4899', '#f472b6', '#f9a8d4', '#fce7f3'], dim: ['#831843', '#9d174d', '#b8406f', '#cf6f93'] },
  purple: { bright: ['#a855f7', '#c084fc', '#d8b4fe', '#f3e8ff'], dim: ['#581c87', '#6b21a8', '#8b47c4', '#a874d6'] },
}
const PLAIN_SPINNER = ['|', '/', '-', '\\']
const FONT_SCRIPT =
  'if command -v fc-list >/dev/null 2>&1; then f=$(fc-list ":charset=$1" file | head -n1 | cut -d: -f1); ' +
  'else f=$(ls "$HOME"/Library/Fonts/*"$2"* /Library/Fonts/*"$2"* 2>/dev/null | head -n1); fi; ' +
  '[ -n "$f" ] || { echo missing; exit 0; }; m=$(date -r "$f" +%s 2>/dev/null || stat -f %m "$f"); p=$PPID; ' +
  'while [ -n "$p" ] && [ "$p" -gt 1 ]; do c=$(ps -o comm= -p "$p" 2>/dev/null); c=$(basename "$c" 2>/dev/null | tr -d " "); case "$c" in ' +
  'ghostty|kitty|alacritty|Alacritty|foot|footclient|wezterm-gui|konsole|gnome-terminal-|xterm|urxvt|st|Terminal|iTerm2) ' +
  'e=$(ps -o etime= -p "$p" 2>/dev/null | awk -F\'[-:]\' \'{n=NF; s=$n+60*$(n-1); if (n>2) s+=3600*$(n-2); if (n>3) s+=86400*$(n-3); print s}\'); [ -n "$e" ] && [ $(( $(date +%s) - e )) -lt "$m" ] && echo stale || echo ok; exit 0;; esac; ' +
  'p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); done; echo ok'

let lastPress = { key: '', at: 0 }
let view = { from: 0, max: 0 }
let detected: Tier = 'nerd'
let glyphSetting = 'auto'
let blink: Timer | null = null
let generation = 0
let closed = false
let noDock = false
let inflight: Promise<void> | null = null
let queued: Promise<void> | null = null
let platform: Promise<'linux' | 'darwin' | 'win32'> | null = null

function osName($: EngineInterface): Promise<'linux' | 'darwin' | 'win32'> {
  platform ??= (async () => {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
    try {
      return (await $.process.run(['uname', '-s'], { timeoutMs: 3_000 })).stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
    } catch {
      return 'linux'
    }
  })()
  return platform
}

async function openPane($: EngineInterface, args: { id: string; title: string; focus?: true }): Promise<void> {
  if (noDock && !args.focus) return
  await $.ui.open(args)
}

async function cwdOf($: EngineInterface): Promise<string> {
  return posix(await $.session.cwd())
}

function jumpTo(ex: Explorer, query: string): Partial<Explorer> {
  const q = query.trim().toLowerCase()
  const hits = q ? ex.nodes.filter(n => n.name.toLowerCase().includes(q) || n.note.toLowerCase().includes(q)).slice(0, 10) : []
  const open = new Set(ex.expanded)
  for (const n of hits) for (const a of ancestors(ex.nodes, n.id)) open.add(a)
  return { query: '', expanded: [...open], cursor: hits[0]?.id ?? ex.cursor, scroll: null }
}

async function copyOf($: EngineInterface, text: string, surface?: string): Promise<void> {
  const done = await $.ui.copy({ text, ...(surface ? { surface: surface as 'terminal' } : {}) })
  $.ui.toast(done ? `Copied ${text}` : 'Could not copy')
}

function clean(segs: Seg[]): Seg[] {
  for (const seg of segs) for (const k of Object.keys(seg) as (keyof Seg)[]) if (seg[k] === undefined) delete seg[k]
  return segs
}

async function installed($: EngineInterface, cmd: string): Promise<boolean> {
  try {
    return (await $.process.run(['sh', '-c', 'command -v "$1" >/dev/null 2>&1', 'sh', cmd], { timeoutMs: 5_000 })).exitCode === 0
  } catch {
    return false
  }
}

async function launch($: EngineInterface, ...choices: string[][]): Promise<void> {
  for (const argv of choices) {
    if (!(await installed($, argv[0] ?? ''))) continue
    try {
      if ((await $.process.run(['setsid', '-f', 'sh', '-c', 'exec "$@" </dev/null >/dev/null 2>&1', 'sh', ...argv], { timeoutMs: 10_000 })).exitCode === 0) return
    } catch {
      break
    }
    break
  }
  $.ui.toast(`could not start ${choices.map(c => c[0] ?? '').join(' or ')}`)
}

async function openUrl($: EngineInterface, url: string): Promise<void> {
  const os = await osName($)
  if (os === 'linux') return launch($, ['gio', 'open', url], ['xdg-open', url])
  try {
    await $.process.run(os === 'darwin' ? ['open', url] : ['cmd', '/c', 'start', '', url], { timeoutMs: 10_000 })
  } catch {
    $.ui.toast(`could not open ${url}`)
  }
}

function cmdq(arg: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`
}

function shq(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

async function terminal($: EngineInterface, linux: string[], cmd: string[], cwd = ''): Promise<void> {
  const line = cmd.map(shq).join(' ')
  const os = await osName($)
  if (os === 'linux') {
    if (!(await installed($, linux[0] ?? ''))) return $.ui.toast(`${linux[0] ?? ''} is not installed`)
    return launch($, ['xdg-terminal-exec', ...linux], ['x-terminal-emulator', '-e', ...linux])
  }
  const argv =
    os === 'darwin'
      ? ['osascript', '-e', `tell application "Terminal" to do script "${(cwd ? `cd ${shq(cwd)} && ${line}` : line).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate']
      : ['cmd', '/c', 'start', '', 'cmd', '/k', cwd ? `cd /d "${cwd.replace(/\//g, '\\')}" && ${cmd.map(cmdq).join(' ')}` : cmd.map(cmdq).join(' ')]
  try {
    await $.process.run(argv, { timeoutMs: 10_000 })
  } catch {
    $.ui.toast(`could not start ${argv[0] ?? ''}`)
  }
}

async function fontState($: EngineInterface, charset: string, name: string): Promise<'ok' | 'stale' | 'missing'> {
  try {
    const out = (await $.process.run(['sh', '-c', FONT_SCRIPT, 'sh', charset, name], { timeoutMs: 5_000 })).stdout.trim()
    return out === 'stale' || out === 'missing' ? out : 'ok'
  } catch {
    return 'missing'
  }
}

async function detectGlyphs($: EngineInterface): Promise<void> {
  if ((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY'))) {
    detected = 'nerd'
    return
  }
  detected = (await fontState($, 'f2621', 'FabricSymbols')) === 'ok' ? 'fabric' : (await fontState($, 'f04eb', 'Nerd')) === 'ok' ? 'nerd' : 'plain'
}

function tierFor(surface: string): Tier {
  if (glyphSetting === 'fabric' || glyphSetting === 'nerd' || glyphSetting === 'plain') return glyphSetting
  return surface === 'desktop' ? 'plain' : detected
}

function titleGlyph(tier: Tier): string {
  return tier === 'fabric' ? String.fromCodePoint(TITLE_GLYPH.fabric) : tier === 'nerd' ? TITLE_GLYPH.nerd : TITLE_GLYPH.plain
}

function titleFor(target: Target | null): string {
  return `${titleGlyph(tierFor('terminal'))} ${target ? targetLabel(target) : TITLE}`
}

async function get($: EngineInterface): Promise<Explorer> {
  const [view, tree] = await Promise.all([$.state.get(STATE), $.state.get(NODES)])
  return { ...empty(), ...view.value, nodes: tree.value ?? [] }
}

async function put($: EngineInterface, fn: (ex: Explorer) => Explorer): Promise<void> {
  for (let i = 0; ; i++) {
    const last = i >= 20
    const [view, tree] = await Promise.all([$.state.get(STATE), $.state.get(NODES)])
    const cur: Explorer = { ...empty(), ...view.value, nodes: tree.value ?? [] }
    const next = fn(cur)
    if (next.nodes !== cur.nodes) {
      const done = await $.state.set(NODES, next.nodes, last ? {} : { ifVersion: tree.version })
      if (!done.isSet && !last) continue
    }
    const keys = Object.keys(next) as (keyof Explorer)[]
    if (!keys.some(k => k !== 'nodes' && next[k] !== cur[k])) return
    const { nodes: _nodes, ...rest } = next
    const done = await $.state.set(STATE, { ...rest, nodes: [] }, last ? {} : { ifVersion: view.version })
    if (done.isSet || last) return
  }
}

function patch($: EngineInterface, fn: (ex: Explorer) => Partial<Explorer>) {
  return put($, ex => ({ ...ex, ...fn(ex) }))
}

const sameTarget = (a: Target | null, b: Target | null) => JSON.stringify(a) === JSON.stringify(b)

function refresh($: EngineInterface): Promise<void> {
  if (inflight) {
    const rerun = () => {
      queued = null
      return refresh($)
    }
    queued ??= inflight.then(rerun, rerun)
    return queued
  }
  inflight = doRefresh($).finally(() => {
    inflight = null
  })
  return inflight
}

async function flash($: EngineInterface, ids: string[], alsoLit: string[] = [], tone = 'orange'): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return
  const mine = ++generation
  blink?.cancel()
  blink = null
  const ex = await get($)
  await patch($, cur => {
    const byId = new Map(cur.nodes.map(n => [n.id, n]))
    const open = new Set(cur.expanded)
    const bright = new Set([...(cur.flashOn ? cur.flash.filter(id => !unique.includes(id)) : []), ...unique])
    const dim = new Set(alsoLit)
    const tones: Record<string, string> = cur.flashOn ? { ...cur.flashTones } : {}
    if (cur.flashOn) {
      for (const id of cur.flashDim) dim.add(id)
    }
    for (const id of [...unique, ...alsoLit]) tones[id] = tone
    for (const id of unique) {
      const chain = ancestors(cur.nodes, id, byId)
      if (!chain.some(a => !open.has(a))) continue
      for (const a of chain) {
        if (!open.has(a)) {
          dim.add(a)
          tones[a] ??= tone
        }
        open.add(a)
      }
    }
    for (const id of bright) dim.delete(id)
    return { flash: [...bright], flashDim: [...dim], flashTones: tones, flashOn: true, expanded: [...open], scroll: null }
  })
  if (generation !== mine) return
  blink = $.clock.after(FLASH_MS, () => {
    if (generation !== mine) return
    blink = null
    void patch($, cur => (generation === mine ? { flash: [], flashDim: [], flashOn: false, flashTones: {} } : {}))
  })
  if (ex.target && !closed) await openPane($, { id: PANE, title: titleFor(ex.target) })
}

async function markBusy($: EngineInterface, ids: string[], tone: string): Promise<void> {
  if (ids.length === 0) return
  const at = await $.clock.now()
  await patch($, cur => {
    const map = { ...cur.busy }
    for (const id of ids) map[id] = { tone, n: (map[id]?.n ?? 0) + 1, at }
    return { busy: map }
  })
}

async function clearBusy($: EngineInterface, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await patch($, cur => {
    const map = { ...cur.busy }
    for (const id of ids) {
      const left = (map[id]?.n ?? 1) - 1
      const entry = map[id]
      if (left > 0 && entry) map[id] = { ...entry, n: left }
      else delete map[id]
    }
    return { busy: map }
  })
}

async function point($: EngineInterface, target: Target | null, opened: 'asked' | 'unasked', fresh = false): Promise<boolean> {
  const moved = !sameTarget((await get($)).target, target)
  if (moved) await put($, () => ({ ...empty(), target }))
  else if (fresh) await patch($, () => ({ expanded: [], query: '', selected: '', detail: [], cursor: '' }))
  if (opened === 'asked' || (moved && target)) {
    const title = titleFor(target)
    if (opened === 'asked') {
      closed = false
      await openPane($, { id: PANE, title, focus: true })
    } else if (!closed) await openPane($, { id: PANE, title })
  }
  return moved
}

async function press($: EngineInterface, n: TreeNode): Promise<void> {
  const now = await $.clock.now()
  const isDouble = lastPress.key === n.id && now - lastPress.at < DOUBLE_MS
  lastPress = { key: isDouble ? '' : n.id, at: now }
  if (isDouble) await openLocal($, await get($), n)
  else await select($, n)
}

async function openWeb($: EngineInterface, ex: Explorer, n: TreeNode): Promise<void> {
  const url = webUrl(ex, n)
  if (url) await openUrl($, url)
  else $.ui.toast('no Fabric link for this object')
}

async function fabLs($: EngineInterface, path?: string): Promise<string> {
  const argv = path ? ['fab', 'ls', path, '-l', '--output_format', 'json'] : ['fab', 'ls', '-l', '--output_format', 'json']
  const run = await $.process.run(argv, { timeoutMs: 60_000 })
  if (run.exitCode !== 0) throw new Error((run.stderr || run.stdout).trim().split('\n')[0] || 'fab ls failed')
  return run.stdout
}

const loading = new Map<string, Promise<boolean>>()

function errorText(err: unknown): string {
  return `error: ${err instanceof Error ? err.message : String(err)}`
}

function wsNode(nodes: TreeNode[], workspace: string): TreeNode | undefined {
  const want = `W:${workspace}`.toLowerCase()
  return nodes.find(n => n.id.toLowerCase() === want)
}

function wsId(nodes: TreeNode[], workspace: string): string {
  return wsNode(nodes, workspace)?.id ?? `W:${workspace}`
}

async function pool<T>(items: T[], fn: (item: T) => Promise<unknown>, size = 4): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
    }),
  )
}

async function expandOpen($: EngineInterface, root = ''): Promise<void> {
  const failed = new Set<string>()
  for (let pass = 0; pass < 8; pass++) {
    const ex = await get($)
    const open = new Set(ex.expanded)
    const pending = new Set(ex.nodes.filter(c => c.kind === PLACEHOLDER).map(c => c.parent))
    const byId = new Map(ex.nodes.map(n => [n.id, n]))
    const todo = ex.nodes.filter(n => open.has(n.id) && pending.has(n.id) && !failed.has(n.id) && (!root || ancestors(ex.nodes, n.id, byId).includes(root)))
    if (todo.length === 0) return
    await pool(todo, async n => {
      if (!(await expandFabric($, n))) failed.add(n.id)
    })
  }
}

async function doRefresh($: EngineInterface): Promise<void> {
  const target = (await get($)).target
  if (!target) return
  await patch($, () => ({ status: 'loading' }))
  try {
    const nodes = parseWorkspaces(await fabLs($))
    await patch($, cur => (sameTarget(cur.target, target) ? { nodes, expanded: cur.nodes.length ? cur.expanded : [], status: '' } : {}))
    await expandOpen($)
  } catch (err) {
    await patch($, cur => (sameTarget(cur.target, target) ? { status: errorText(err) } : {}))
  }
}

const rerun = new Map<string, Promise<boolean>>()

function reloadWorkspace($: EngineInterface, workspace: string): Promise<boolean> {
  const key = `reload:${workspace.toLowerCase()}`
  const running = loading.get(key)
  if (running) {
    const next =
      rerun.get(key) ??
      running.then(() => {
        rerun.delete(key)
        return reloadWorkspace($, workspace)
      })
    rerun.set(key, next)
    return next
  }
  const job = (async () => {
    const ex = await get($)
    const ws = wsNode(ex.nodes, workspace)
    if (!ws || !ex.nodes.some(c => c.parent === ws.id && c.kind !== PLACEHOLDER)) return true
    try {
      const kids = parseChildren(await fabLs($, ws.path), ws, ex.nodes)
      await patch($, cur => {
        const byId = new Map(cur.nodes.map(n => [n.id, n]))
        const keep = cur.nodes.filter(n => n.id === ws.id || !ancestors(cur.nodes, n.id, byId).includes(ws.id))
        return { nodes: [...keep, ...kids] }
      })
    } catch {
      return false
    }
    await expandOpen($, ws.id)
    return true
  })().finally(() => loading.delete(key))
  loading.set(key, job)
  return job
}

function expandFabric($: EngineInterface, n: TreeNode): Promise<boolean> {
  const running = loading.get(n.id)
  if (running) return running
  const job = (async () => {
    const ex = await get($)
    if (!ex.nodes.some(c => c.parent === n.id && c.kind === PLACEHOLDER)) return true
    try {
      const kids = parseChildren(await fabLs($, n.path), n, ex.nodes)
      await patch($, cur => ({ nodes: cur.nodes.flatMap(x => (x.parent === n.id && x.kind === PLACEHOLDER ? kids : [x])), ...(cur.status.startsWith('error') ? { status: '' } : {}) }))
      return true
    } catch (err) {
      await patch($, () => ({ status: errorText(err) }))
      return false
    }
  })().finally(() => loading.delete(n.id))
  loading.set(n.id, job)
  return job
}

async function reveal($: EngineInterface, workspace: string): Promise<void> {
  const n = wsNode((await get($)).nodes, workspace)
  if (!n) return
  await patch($, cur => ({ expanded: [...new Set([...cur.expanded, n.id])] }))
  await expandFabric($, n)
}

async function revealPath($: EngineInterface, path: string): Promise<void> {
  const segs = path.replace(/^\//, '').replace(/\/$/, '').split('/')
  for (let i = 2; i < segs.length; i++) {
    const want = segs.slice(0, i).join('/').toLowerCase()
    const n = (await get($)).nodes.find(x => x.path.toLowerCase() === want)
    if (!n) return
    await expandFabric($, n)
  }
}

function webUrl(_ex: Explorer, n: TreeNode): string {
  return n.url || ''
}

async function openLocal($: EngineInterface, ex: Explorer, n: TreeNode): Promise<void> {
  const model = modelOf(n)
  if (model) await terminal($, ['te', 'interactive', '-s', model.server, '-d', model.database], ['te', 'interactive', '-s', model.server, '-d', model.database])
  else if (webUrl(ex, n)) await openUrl($, webUrl(ex, n))
}

async function select($: EngineInterface, n: TreeNode): Promise<void> {
  if (n.kind === PLACEHOLDER) return
  const ex = await get($)
  const isLeaf = !ex.nodes.some(c => c.parent === n.id)
  await patch($, cur => {
    const open = new Set(cur.expanded)
    if (!isLeaf) open.has(n.id) ? open.delete(n.id) : open.add(n.id)
    return { expanded: [...open], cursor: n.id, selected: n.path ? n.id : cur.selected }
  })
  if (!isLeaf && (await expandFabric($, n))) await expandOpen($, n.id)
  const detail = [`${n.kind} ${n.name}`, `fab path: ${n.path}`]
  const model = modelOf(n)
  if (model) detail.push(`model explorer: /model-explorer "${model.server}" "${model.database}"`)
  await patch($, () => ({ detail }))
}

function contextFor(ex: Explorer, n: TreeNode): string {
  return [
    'The user has this Fabric item selected in the Fabric explorer; "this", "it" or "the selected" in the prompt likely refers to it.',
    `${n.kind}: ${n.name}`,
    `fab path: ${n.path}`,
    ...ex.detail.slice(2),
  ].join('\n')
}

export const register: Register = (on, options) => {
  glyphSetting = typeof options?.glyphs === 'string' ? options.glyphs : 'auto'

  on('session.start', async ($, e, next) => {
    useDrives((await $.env.get('OS')) === 'Windows_NT')
    void detectGlyphs($)
    await patch($, () => ({ flash: [], flashDim: [], flashOn: false, flashTones: {}, busy: {} }))
    await $.command.register({ name: PANE, description: 'Open the Fabric explorer; args: [workspace]' })
    const ex = await get($)
    if (ex.target) void openPane($, { id: PANE, title: titleFor(ex.target) })
    return next(e)
  })

  on('command.run', { command: PANE }, async ($, e) => {
    if (e.presentation && !e.presentation.isFullscreen) return { text: 'The Fabric explorer shows in the sidebar, which needs the fullscreen layout. Run /tui fullscreen, then /fabric-explorer.' }
    if (e.presentation && e.presentation.columns < 110) return { text: 'The Fabric explorer shows in the sidebar, which needs a terminal at least 110 columns wide. Widen it, then run /fabric-explorer.' }
    noDock = false
    await detectGlyphs($)
    const [workspace] = tokenize(e.args ?? '')
    await point($, { kind: 'fabric' }, 'asked', true)
    await refresh($)
    if (workspace) await reveal($, workspace.replace(/\.Workspace$/i, ''))
    return { text: workspace ? `Fabric explorer on ${workspace}.` : 'Fabric explorer open.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = e.tool === 'Bash' ? e.command : ''
    if (!/\bfab\b/.test(command)) return next(e)
    const calls = fabCalls(invocations(command, await cwdOf($)).filter(i => i.tool === 'fab'))
    if (calls.length === 0) return next(e)
    const ex = await get($)
    const marks = calls.map(inv => ({ ids: [HEADER, ...fabWorkspaces(inv).map(w => wsId(ex.nodes, w)), ...fabTouched(inv, ex.nodes)], tone: FAB_TONE[fabKind(inv)] }))
    let result: Awaited<ReturnType<typeof next>>
    try {
      for (const m of marks) await markBusy($, m.ids, m.tone)
      result = await next(e)
    } finally {
      for (const m of marks) await clearBusy($, m.ids)
    }
    if (result.deny || result.isError || closed || noDock) return result
    void (async () => {
      const moved = await point($, { kind: 'fabric' }, 'unasked')
      if (moved || (await get($)).nodes.length === 0) await refresh($)
      const prior = await get($)
      const before = new Set(prior.expanded)
      const loaded = new Set(prior.nodes.filter(n => n.kind !== PLACEHOLDER).map(n => n.parent))
      const lower = (xs: string[]) => [...new Map(xs.map(x => [x.toLowerCase(), x])).values()]
      const changes = calls.filter(inv => fabKind(inv) === 'modify' || fabKind(inv) === 'upload')
      const whole = new Set(changes.flatMap(inv => fabPositionals(inv.args.slice(1)).filter(a => /^\/?[^/]+\.Workspace\/?$/i.test(a)).flatMap(a => fabWorkspaces({ ...inv, args: ['', a] }))).map(w => w.toLowerCase()))
      if (whole.size) await refresh($)
      await pool(lower(calls.flatMap(fabWorkspaces).filter(w => !whole.has(w.toLowerCase()))), w => reveal($, w))
      await pool(
        lower(changes.flatMap(fabWorkspaces).filter(w => !whole.has(w.toLowerCase()) && loaded.has(wsId(prior.nodes, w)))),
        w => reloadWorkspace($, w),
      )
      for (const a of lower(calls.flatMap(inv => inv.args.slice(1).filter(x => /\.Workspace\//i.test(x))))) await revealPath($, a)
      const fresh = await get($)
      for (const inv of calls) {
        const touched = fabTouched(inv, fresh.nodes)
        const opened = touched.length ? fabWorkspaces(inv).map(w => wsId(fresh.nodes, w)).filter(id => !before.has(id)) : []
        await flash($, touched, opened, FAB_TONE[fabKind(inv)])
      }
    })().catch(() => undefined)
    return result
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') closed = true
    return result
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'rows' || !e.data || typeof e.data !== 'object') return next(e)
    const data = e.data as { press?: unknown; key?: unknown; ctrl?: unknown; shift?: unknown; scrollTo?: unknown; copy?: unknown }
    const ex = await get($)
    if (typeof data.scrollTo === 'number') {
      const to = Math.round(Math.max(0, Math.min(1, data.scrollTo)) * view.max)
      if (to !== ex.scroll) await patch($, () => ({ scroll: to }))
      return {}
    }
    if (typeof data.copy === 'string') {
      const n = ex.nodes.find(x => x.id === data.copy)
      if (n) await copyOf($, n.path || n.name, e.surface)
      return {}
    }
    if (typeof data.press === 'string') {
      const n = ex.nodes.find(x => x.id === data.press)
      if (!n) return {}
      if (ex.scroll === null) await patch($, () => ({ scroll: view.from }))
      if (data.ctrl) await openWeb($, ex, n)
      else if (data.shift) await openLocal($, ex, n)
      else await press($, n)
      return {}
    }
    if (typeof data.key !== 'string') return {}
    const rows = visible(ex, SORT)
    const at = rows.findIndex(r => r.node.id === ex.cursor)
    const cur = rows[at]
    const move = (d: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + d))]
      return target ? patch($, () => ({ cursor: target.node.id, scroll: null })) : Promise.resolve()
    }
    if (data.key === 'up' || data.key === 'k') await move(-1)
    else if (data.key === 'down' || data.key === 'j') await move(1)
    else if (data.key === 'pageup') await move(-10)
    else if (data.key === 'pagedown') await move(10)
    else if (data.key === 'home') await move(-rows.length)
    else if (data.key === 'end') await move(rows.length)
    else if (cur && (data.key === 'y' || data.key === 'Y')) await copyOf($, cur.node.path || cur.node.name, e.surface)
    else if (cur && (data.key === 'right' || data.key === 'l') && !cur.leaf && !cur.open) await select($, cur.node)
    else if (cur && (data.key === 'left' || data.key === 'h')) {
      if (!cur.leaf && cur.open) await patch($, x => ({ expanded: x.expanded.filter(id => id !== cur.node.id) }))
      else if (cur.node.parent) await patch($, () => ({ cursor: cur.node.parent }))
    } else if (cur && (data.key === ' ' || data.key === 'return')) await (data.key === 'return' && cur.leaf ? openLocal($, ex, cur.node) : select($, cur.node))
    return {}
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ex = await get($)
    const to = Math.max(0, Math.min(view.max, (ex.scroll ?? view.from) + Math.sign(e.by) * Math.max(3, Math.abs(e.by))))
    if (to !== ex.scroll) await patch($, () => ({ scroll: to }))
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    const ex = await get($)
    const n = ex.nodes.find(x => x.id === ex.selected)
    if (!n || !ex.target || closed || noDock) return next(e)
    return next({ ...e, context: [...(e.context ?? []), contextFor(ex, n)] })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.surface === 'terminal' && e.props.placement === 'inline') {
      noDock = true
      void $.ui.close({ id: PANE }).catch(() => undefined)
      const { Box: Empty } = $.ui.resolve(e)
      return <Empty />
    }
    const tier = tierFor(e.surface)
    const { Box, Text, Button, Input, Client } = $.ui.resolve(e)
    const ex = await get($)
    const now = await $.clock.now()
    const busyTone = (id: string) => {
      const b = ex.busy[id]
      return b && now - b.at < BUSY_MAX_MS ? b.tone : ''
    }
    const brightSet = new Set(ex.flashOn ? ex.flash : [])
    const dimSet = new Set(ex.flashOn ? ex.flashDim : [])
    const width = Math.max(20, e.props.bodyColumns)
    const rows = visible(ex, SORT)
    const detailRows = ex.detail.length ? Math.min(ex.detail.length, DETAIL_ROWS) + 2 : 0
    const room = Math.max(5, Math.min(WINDOW, (e.props.scroll?.bodyRows ?? 40) - 4 - detailRows))
    const focusId = ex.flashOn && ex.flash.length ? (ex.flash[ex.flash.length - 1] ?? ex.cursor) : ex.cursor
    const at = Math.max(0, rows.findIndex(r => r.node.id === focusId))
    const isLit = (id: string) => brightSet.has(id) || dimSet.has(id)
    const lit = ex.flashOn ? rows.findIndex(r => isLit(r.node.id)) : -1
    const fits = lit >= 0 && at - lit < room - 2
    let from = Math.max(0, Math.min(fits ? Math.max(0, lit - 1) : at - Math.floor(room / 2), rows.length - room))
    const cap = Math.max(1, Math.floor(room / 3))
    let pinned = ex.flashOn ? rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap) : []
    if (pinned.length) {
      const rest = Math.max(3, room - pinned.length)
      from = Math.max(0, Math.min(at - Math.floor(rest / 2), rows.length - rest))
      pinned = rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap)
    }
    const max = Math.max(0, rows.length - room)
    if (ex.scroll !== null) {
      from = Math.max(0, Math.min(ex.scroll, max))
      pinned = []
    }
    view = { from, max }
    const shown = rows.slice(from, from + room - pinned.length)
    const sel = ex.nodes.find(n => n.id === ex.selected)
    const clip = (s: string, max = width) => (s.length > max ? s.slice(0, max - 1) + '…' : s)
    const spin = (tone: string): Seg => ({ t: ' ', spin: true, b: true, c: TONES[tone]?.bright[1] ?? SHIMMER[1] })
    const rowSpec = (r: (typeof rows)[number]): RowSpec => {
      const n = r.node
      const g = glyph(n, tier)
      const arrow = r.leaf ? '  ' : tier === 'plain' ? (r.open ? '▾ ' : '▸ ') : r.open ? '\u{f47c} ' : '\u{f460} '
      const note = n.note ? ` ${n.note}` : ''
      const cols = Math.max(4, width - r.depth * 2 - 6 - note.length)
      const isBright = brightSet.has(n.id)
      const isDim = !isBright && dimSet.has(n.id)
      const name = clip(n.name, cols)
      const faded = n.hidden || n.kind === 'placeholder'
      const tone = ex.flashTones[n.id] ?? 'orange'
      const busy = busyTone(n.id)
      const left: Seg[] = [
        { t: '  '.repeat(r.depth) },
        { t: arrow, c: '#7a7a86' },
        isBright || isDim ? { t: g.char + ' ', sh: tone, dim: isDim, one: true } : { t: g.char + ' ', c: faded ? '#6e6e7a' : g.color },
        isBright || isDim ? { t: name, sh: tone, dim: isDim, b: isBright } : { t: name, c: faded ? '#6e6e7a' : g.label, b: n.id === ex.selected },
      ]
      if (busy) left.push(spin(busy))
      return { id: n.kind === 'placeholder' ? '' : n.id, left: clean(left), right: note ? [{ t: note, c: '#6e6e7a' }] : [] }
    }
    const note = (text: string): RowSpec => ({ id: '', left: [{ t: text, c: '#6e6e7a' }], right: [] })
    const specs: RowSpec[] = [...pinned.map(rowSpec), ...(pinned.length > 0 ? [note('  ⋮')] : []), ...shown.map(rowSpec)]
    const barSize = Math.max(1, Math.round((specs.length * shown.length) / Math.max(1, rows.length)))
    const bar =
      rows.length > shown.length + pinned.length
        ? { pos: max ? Math.round((from / max) * (specs.length - barSize)) : 0, size: barSize, thumb: '#5b9bd5', track: '#4a4a56' }
        : undefined
    const icon = (nerd: string, fallback: string) => (tier === 'plain' ? fallback : nerd)
    const head: RowSpec = {
      id: '',
      left: clean([
        { t: `${titleGlyph(tier)} `, c: TITLE_COLOR },
        { t: ex.target ? targetLabel(ex.target) : TITLE, b: true },
        ...(ex.status ? [{ t: `  ${ex.status}`, c: '#6e6e7a' }] : []),
        ...(busyTone(HEADER) ? [spin(busyTone(HEADER))] : []),
      ]),
      right: [],
    }
    const spinner = tier === 'plain' ? PLAIN_SPINNER : []
    return (
      <Box flexDirection="column" minHeight={Math.max(1, e.props.scroll?.bodyRows ?? 1)}>
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>
            <Client key="head" module="./rows.tsx" props={{ rows: [head], active: '', activeBg: '', hoverBg: '', tones: TONES, spinner } satisfies RowsProps} />
          </Box>
          <Box flexDirection="row" gap={2}>
            <Button key="refresh" plain dimColor label={icon('\u{f0450}', '↻')} onPress={() => void refresh($)} />
            <Button key="collapse" plain dimColor label={icon('\u{eac5}', '⊟')} onPress={() => void patch($, () => ({ expanded: [] }))} />
            {sel && <Button key="clear" plain label={icon('\u{f0156}', '✕')} onPress={() => void patch($, () => ({ selected: '', detail: [] }))} />}
            <Text> </Text>
          </Box>
        </Box>
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <Input
              key="q"
              label="/ "
              placeholder="search"
              submitLabel="jump"
              autoFocus
              value={ex.query}
              onInput={(v: string) => void patch($, () => ({ query: v }))}
              onSubmit={(v: string) => void patch($, cur => jumpTo(cur, v))}
            />
          </Box>
          {ex.query ? <Button key="clearq" plain dimColor label={tier === 'plain' ? '×' : '\u{f0156}'} onPress={() => void patch($, () => ({ query: '' }))} /> : null}
        </Box>
        {ex.nodes.length === 0 && <Text dimColor>{ex.target ? 'nothing loaded yet' : HINT}</Text>}
        <Client key="rows" module="./rows.tsx" props={{ rows: specs, active: ex.cursor, activeBg: '#6b7280', hoverBg: '#79808e', tones: TONES, spinner, ...(bar ? { bar } : {}) } satisfies RowsProps} />
        {ex.detail.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {ex.detail.slice(0, DETAIL_ROWS).map((l, i) => (
              <Text dimColor={i > 0} bold={i === 0} wrap="truncate-end">
                {l.replace(/\s+/g, ' ')}
              </Text>
            ))}
            {sel && (
              <Box flexDirection="row" gap={2}>
                {modelOf(sel) && <Button key="open" plain label={`${icon('\u{f0379}', '↗')} open in te`} onPress={() => void openLocal($, ex, sel)} />}
                {webUrl(ex, sel) && <Button key="web" plain label={`${icon('\u{f059f}', '◎')} open in Fabric`} onPress={() => void openWeb($, ex, sel)} />}
              </Box>
            )}
          </Box>
        )}
        <Box flexGrow={1} />
        {sel && (
          <Text dimColor wrap="truncate-start">
            selected: {sel.path || sel.name}
          </Text>
        )}
      </Box>
    )
  })
}
