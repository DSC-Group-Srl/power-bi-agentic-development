import type { TreeNode } from '../types'
import { FAB_ITEMS } from './icon-data'

type Rgb = [number, number, number]
type Icon = { fabric: number; nerd: string; rgb: Rgb | null; plain?: string }
export type Tier = 'fabric' | 'nerd' | 'plain'

const GLYPH_DIM: Rgb = [0x6e, 0x6e, 0x7a]
const WORKSPACE: Rgb = [0xcf, 0xe9, 0xe7]
const CONTAINER: Icon = { fabric: 0xf2609, nerd: '\u{f024b}', rgb: [197, 197, 197] }

const ITEM_NERD: Record<string, string> = {
  SemanticModel: '\u{f01bc}',
  Report: '\u{f0219}',
  Notebook: '\u{f082e}',
  Lakehouse: '\u{f0a0b}',
  Warehouse: '\u{f0a0b}',
}

export type Glyph = { char: string; color: string | undefined; label?: string }

function hex(rgb: Rgb | null): string | undefined {
  return rgb ? '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('') : undefined
}

const PLAIN: Record<string, string> = {
  table: '▦', 'calc group': '◈', column: '│', 'calc column': '┆', measure: 'Σ', hierarchy: '≡', level: '·',
  partition: '◫', 'calc item': '◇', folder: '■', expression: 'ƒ', role: '◉', perspective: '◎', relationship: '↔',
  workspace: '◫', 'fabric folder': '■', report: '▣', page: '□', visual: '▥', reportfilter: '▿', pagefilter: '▿',
  visualfilter: '▿', bookmark: '⚑', theme: '◐', 'data role': '◦', field: '·', 'ext measure': 'Σ', 'semantic model': '◆',
  SemanticModel: '◆', group: '■',
}

let current: { tier: Tier; kind: string } = { tier: 'nerd', kind: '' }

function pick(icon: Icon, tier: Tier): Glyph {
  if (tier === 'plain') return { char: icon.plain ?? PLAIN[current.kind] ?? '•', color: hex(icon.rgb) }
  return { char: tier === 'fabric' && icon.fabric ? String.fromCodePoint(icon.fabric) : icon.nerd, color: hex(icon.rgb) }
}

function hls(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(v => v / 255) as Rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const range = max - min
  if (range < 1e-6) return [0, l, 0]
  const s = l <= 0.5 ? range / (max + min) : range / (2 - max - min)
  const rc = (max - r) / range
  const gc = (max - g) / range
  const bc = (max - b) / range
  const h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc
  return [(((h / 6) % 1) + 1) % 1, l, s]
}

function component(m1: number, m2: number, hue: number): number {
  const h = ((hue % 1) + 1) % 1
  if (h < 1 / 6) return m1 + (m2 - m1) * h * 6
  if (h < 0.5) return m2
  if (h < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - h) * 6
  return m1
}

function lift(rgb: Rgb): Rgb {
  const [h, l0, s] = hls(rgb)
  const l = Math.max(l0, 0.62)
  if (s < 1e-6) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)]
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const m1 = 2 * l - m2
  return [h + 1 / 3, h, h - 1 / 3].map(x => Math.round(component(m1, m2, x) * 255)) as Rgb
}

const items = new Map<string, Icon>()

function item(type: string): Icon {
  const known = items.get(type)
  if (known) return known
  const hit = FAB_ITEMS[type]
  const made = { fabric: hit?.[0] ?? 0, nerd: ITEM_NERD[type] ?? '\u{f0214}', rgb: hit?.[1] ? lift(hit[1]) : null }
  items.set(type, made)
  return made
}

export function glyph(n: TreeNode, tier: Tier): Glyph {
  current = { tier, kind: n.kind }
  const fabricFont: Tier = tier
  if (n.kind === 'placeholder') return { char: '…', color: hex(GLYPH_DIM) }
  if (n.kind === 'workspace') return { ...pick({ fabric: 0xf203e, nerd: '\u{f0253}', rgb: GLYPH_DIM }, fabricFont), label: hex(WORKSPACE) }
  if (n.kind === 'fabric folder') return pick({ fabric: 0, nerd: '\u{f024b}', rgb: GLYPH_DIM }, fabricFont)
  if (FAB_ITEMS[n.kind]) {
    const g = pick(item(n.kind), fabricFont)
    return { ...g, label: g.color }
  }
  return pick(CONTAINER, fabricFont)
}
