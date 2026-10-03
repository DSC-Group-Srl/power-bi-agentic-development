import type { TreeNode } from '../types'
import { FAB_ITEMS, PBIR_CHILDREN, PBIR_VISUALS } from './icon-data'

type Rgb = [number, number, number]
type Icon = { fabric: number; nerd: string; rgb: Rgb | null }
export type Tier = 'fabric' | 'nerd' | 'plain'

const GLYPH_DIM: Rgb = [0x6e, 0x6e, 0x7a]
const CONTAINER: Icon = { fabric: 0xf2609, nerd: '\u{f024b}', rgb: [197, 197, 197] }

const REPORT_NERD: Record<string, string> = {
  page: '\u{f0214}',
  visual: '\u{f0128}',
  reportfilter: '\u{f0232}',
  pagefilter: '\u{f0232}',
  visualfilter: '\u{f0232}',
  bookmark: '\u{f00c0}',
  theme: '\u{f03d8}',
  'data role': '\u{f0d7e}',
  field: '\u{f0835}',
  'ext measure': '\u{f00ec}',
}

const ITEM_NERD: Record<string, string> = {
  SemanticModel: '\u{f01bc}',
  Report: '\u{f0219}',
}

const PLAIN: Record<string, string> = {
  report: '▣', 'semantic model': '◆', group: '■', page: '□', visual: '▥', reportfilter: '▿', pagefilter: '▿',
  visualfilter: '▿', bookmark: '⚑', theme: '◐', 'data role': '◫', field: '│', 'ext measure': 'Σ',
}

export type Glyph = { char: string; color: string | undefined; label?: string }

function hex(rgb: Rgb | null): string | undefined {
  return rgb ? '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('') : undefined
}

function pick(icon: Icon, tier: Tier, plain: string): Glyph {
  if (tier === 'plain') return { char: plain, color: hex(icon.rgb) }
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

function item(type: string): Icon {
  const hit = FAB_ITEMS[type]
  return { fabric: hit?.[0] ?? 0, nerd: ITEM_NERD[type] ?? '\u{f0214}', rgb: hit?.[1] ? lift(hit[1]) : null }
}

export function glyph(n: TreeNode, tier: Tier): Glyph {
  const plain = PLAIN[n.kind] ?? '■'
  if (n.kind === 'report') return pick(item('Report'), tier, plain)
  if (n.kind === 'semantic model') {
    const g = pick(item('SemanticModel'), tier, plain)
    return { ...g, label: g.color }
  }
  if (REPORT_NERD[n.kind]) {
    const fabric = n.kind === 'visual' ? (PBIR_VISUALS[n.note || n.name] ?? PBIR_CHILDREN.visual) : PBIR_CHILDREN[n.kind]
    return pick({ fabric: fabric ?? 0, nerd: REPORT_NERD[n.kind] ?? CONTAINER.nerd, rgb: GLYPH_DIM }, tier, plain)
  }
  return pick(CONTAINER, tier, plain)
}
