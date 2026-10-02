import type { Target } from '../types'

export type Invocation = { tool: 'fab'; args: string[]; cwd: string; env: Record<string, string> }

const SEPARATORS = new Set(['&&', '||', ';', '|', '&', '\n', '(', ')', '`'])
const PREFIXES = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'time', '{', 'env', 'command', 'builtin', 'exec', 'nohup', 'sudo', 'nice', 'xargs', 'uvx', 'pipx', 'timeout'])
const PREFIX_VALUED = new Set(['--from', '--with', '-u', '-n', '-I', '-k', '-s', '-P'])
const REDIRECT = /^(\d*>>?|\d*<|\d*>&\d*|&>>?)$/

let drives = false

export function useDrives(on: boolean): void {
  drives = on
}

export function posix(path: string): string {
  if (!drives) return path
  return path.replace(/\\/g, '/').replace(/^\/([A-Za-z])(\/|$)/, (_, d: string) => `${d.toUpperCase()}:/`)
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/') || (drives && /^[A-Za-z]:\//.test(path))
}

export function tokenize(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  let has = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    if (!quote && ch === '#' && !has && !cur) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
      continue
    }
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i] ?? ''
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (ch === '\\' && i + 1 < command.length) {
      cur += command[++i] ?? ''
      has = true
    } else if (ch === '\n') {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
      out.push('\n')
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else if (ch === '>' || ch === '<') {
      let op = /^\d+$/.test(cur) && !has ? cur : /^\d+$/.test(cur) ? cur : ''
      if (!op && (has || cur)) out.push(cur)
      op += ch
      while (command[i + 1] === '>' || command[i + 1] === '&' || /\d/.test(command[i + 1] ?? '')) {
        if (command[i + 1] === '&' && op.endsWith('&')) break
        op += command[++i]
      }
      out.push(op)
      cur = ''
      has = false
    } else if (ch === '(' || ch === ')' || ch === '`') {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
      out.push(ch)
    } else if (ch === ';' || ch === '|' || ch === '&') {
      if (ch === '&' && command[i + 1] === '>') {
        if (has || cur) out.push(cur)
        cur = '&'
        has = false
        continue
      }
      if (has || cur) out.push(cur)
      cur = ''
      has = false
      const two = command.slice(i, i + 2)
      if (two === '&&' || two === '||') {
        out.push(two)
        i++
      } else out.push(ch)
    } else {
      cur += ch
      has = true
    }
  }
  if (has || cur) out.push(cur)
  if (!quote) return out
  return command
    .split(/(&&|\|\||[;|\n])/)
    .flatMap(part => (/^(&&|\|\||[;|\n])$/.test(part) ? [part] : part.trim().split(/\s+/).filter(Boolean)))
}

export function join(base: string, raw: string): string {
  const path = posix(raw)
  if (isAbsolute(path)) return path
  if (path.startsWith('~/')) return path
  const parts = base.split('/')
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/') || '/'
}

function substitutions(command: string): string[] {
  const out: string[] = []
  for (let i = command.indexOf('$('); i >= 0; i = command.indexOf('$(', i + 2)) {
    let depth = 0
    for (let j = i + 1; j < command.length; j++) {
      if (command[j] === '(') depth++
      else if (command[j] === ')' && --depth === 0) {
        out.push(command.slice(i + 2, j))
        break
      }
    }
  }
  for (const m of command.matchAll(/`([^`]+)`/g)) out.push(m[1] ?? '')
  return out
}

function expand(args: string[], loops: { name: string; words: string[] }[]): string[][] {
  let out = [args]
  for (const { name, words } of loops) {
    const source = `\\$\\{${name}\\}|\\$${name}(?![A-Za-z0-9_])`
    const used = new RegExp(source)
    const ref = new RegExp(source, 'g')
    if (!out.some(a => a.some(x => used.test(x)))) continue
    out = out.flatMap(a => words.slice(0, 20).map(w => a.map(x => x.replace(ref, w))))
  }
  return out
}

function skipFlags(toks: string[], j: number): number {
  while (j < toks.length && (toks[j] ?? '').startsWith('-') && !SEPARATORS.has(toks[j] ?? '')) j += PREFIX_VALUED.has(toks[j] ?? '') ? 2 : 1
  return j
}

export function invocations(command: string, sessionCwd: string): Invocation[] {
  const toks = tokenize(command)
  const found: Invocation[] = []
  const loops: { name: string; words: string[] }[] = []
  let cwd = sessionCwd
  let start = true
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] ?? ''
    if (SEPARATORS.has(t)) {
      start = true
      continue
    }
    if (!start) continue
    start = false
    const env: Record<string, string> = {}
    let j = i
    for (;;) {
      const tok = toks[j] ?? ''
      const assign = tok.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s)
      const word = tok.split('/').pop() ?? ''
      if (assign) {
        env[assign[1] ?? ''] = assign[2] ?? ''
        j++
      } else if (word === 'uv' && toks[j + 1] === 'run') j = skipFlags(toks, j + 2)
      else if (word === 'timeout') {
        j = skipFlags(toks, j + 1)
        if (/^\d/.test(toks[j] ?? '')) j++
      } else if (PREFIXES.has(word)) j = skipFlags(toks, j + 1)
      else break
    }
    const head = toks[j]?.split('/').pop()
    const dir = toks[j + 1]
    if (head === 'for' && toks[j + 2] === 'in' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(dir ?? '')) {
      const words: string[] = []
      for (let k = j + 3; k < toks.length && !SEPARATORS.has(toks[k] ?? '') && toks[k] !== 'do'; k++) words.push(toks[k] ?? '')
      loops.push({ name: dir ?? '', words })
      continue
    }
    if (head === 'done') {
      loops.pop()
      continue
    }
    if (head === 'cd' && dir && !SEPARATORS.has(dir)) {
      cwd = join(cwd, dir)
      continue
    }
    if (head !== 'fab') continue
    const args: string[] = []
    let k = j + 1
    while (k < toks.length && !SEPARATORS.has(toks[k] ?? '')) {
      const tok = toks[k++] ?? ''
      if (REDIRECT.test(tok)) {
        if (!/&\d*$/.test(tok) || tok.startsWith('&')) k++
        continue
      }
      args.push(tok)
    }
    for (const each of expand(args, loops)) found.push({ tool: head, args: each, cwd, env })
    i = k - 1
  }
  const seen = new Set(found.map(f => f.args.join('\0')))
  for (const body of substitutions(command)) {
    for (const inv of invocations(body, cwd)) {
      const key = inv.args.join('\0')
      if (seen.has(key)) continue
      seen.add(key)
      found.push(inv)
    }
  }
  return found
}

export function targetLabel(t: Target | null): string {
  return t ? 'Fabric tenant' : 'no target'
}

export function fabWorkspaces(inv: Invocation): string[] {
  const out: string[] = []
  for (const a of inv.args.slice(1)) {
    const m = a.match(/^\/?([^/]+)\.Workspace(\/|$)/i)
    if (m?.[1]) out.push(m[1])
  }
  return out
}

export type FabKind = 'read' | 'download' | 'upload' | 'modify'

const FAB_READ = new Set(['ls', 'dir', 'get', 'exists', 'find', 'open', 'pwd', 'cd'])
const FAB_IGNORE = new Set(['auth', 'config', 'help', 'version', 'desc', '--help', '--version', '-h', '-v'])
const FAB_SUB_READ = new Set(['ls', 'list', 'get', 'run-list', 'run-status', 'schema', 'status'])
const FAB_VALUE_FLAGS = new Set(['-X', '--method', '-H', '--headers', '-i', '--input', '-A', '--audience', '-q', '--query', '-P', '--params', '-o', '--output', '-f', '--format'])
const ITEM_SUFFIX = /\.(Workspace|Capacity|Connection|Gateway|Domain|Lakehouse|Warehouse|SemanticModel|Report|Notebook|DataPipeline|Dataflow|Environment|KQLDatabase|Eventhouse|SQLDatabase|MirroredDatabase|SparkJobDefinition|PaginatedReport|Dashboard|AppBackend|UserDataFunction|Folder)(\/|$)/i

export function fabPositionals(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (a.startsWith('-')) {
      if (FAB_VALUE_FLAGS.has(a)) i++
      continue
    }
    out.push(a)
  }
  return out
}

function isLocal(arg: string): boolean {
  return /^(\.{1,2}\/|~|\/(?!.*\.Workspace))/.test(arg) || !ITEM_SUFFIX.test(arg)
}

export function fabKind(inv: Invocation): FabKind {
  const verb = inv.args[0] ?? ''
  const rest = inv.args.slice(1)
  const pos = fabPositionals(rest)
  if (verb === 'export' || verb === 'bulk-export') return 'download'
  if (verb === 'import' || verb === 'deploy' || verb === 'publish') return 'upload'
  if (verb === 'cp' || verb === 'copy') {
    const src = pos[0] ?? ''
    const dst = pos[pos.length - 1] ?? ''
    if (!isLocal(src) && isLocal(dst)) return 'download'
    if (isLocal(src) && !isLocal(dst)) return 'upload'
    return 'modify'
  }
  if (verb === 'api') {
    const eq = rest.find(a => a.startsWith('--method='))?.split('=')[1]
    const at = rest.findIndex(a => a === '-X' || a === '--method')
    const method = (eq ?? (at >= 0 ? rest[at + 1] : undefined) ?? 'get').toLowerCase()
    const url = pos[0] ?? ''
    if (/getdefinition/i.test(url)) return 'download'
    if (/updatedefinition/i.test(url)) return 'upload'
    return method === 'get' ? 'read' : 'modify'
  }
  if (verb === 'get' && rest.some(a => a === '-o' || a === '--output')) return 'download'
  if (verb === 'acl' || verb === 'label' || verb === 'job' || verb === 'table') return FAB_SUB_READ.has(pos[0] ?? '') ? 'read' : 'modify'
  return FAB_READ.has(verb) ? 'read' : 'modify'
}

export const FAB_TONE: Record<FabKind, string> = { read: 'purple', download: 'teal', upload: 'pink', modify: 'orange' }

function fabCd(cwd: string, target: string | undefined): string {
  if (!target || target === '~' || target === '/') return ''
  const parts = target.startsWith('/') ? [] : cwd.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export function fabCalls(calls: Invocation[]): Invocation[] {
  let cwd = ''
  const out: Invocation[] = []
  for (const inv of calls) {
    const verb = inv.args[0] ?? ''
    if (!verb || FAB_IGNORE.has(verb)) continue
    const args = cwd
      ? inv.args.map((a, i) => (i > 0 && !a.startsWith('-') && !a.startsWith('/') && ITEM_SUFFIX.test(a) && !/^[^/]+\.Workspace(\/|$)/i.test(a) && !isLocalPath(a) ? `${cwd}/${a}` : a))
      : inv.args
    if (verb === 'cd') cwd = fabCd(cwd, fabPositionals(inv.args.slice(1))[0])
    out.push({ ...inv, args })
  }
  return out
}

function isLocalPath(arg: string): boolean {
  return /^(\.{1,2}\/|~)/.test(arg)
}
