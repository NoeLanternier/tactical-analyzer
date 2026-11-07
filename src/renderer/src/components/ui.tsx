import type { ReactElement, ReactNode } from 'react'
import { itemIcon, runeIcon, type ItemInfo, type RuneInfo } from '../engine/gameData'
import { gold } from '../../../shared/i18n'

export function Card({
  title,
  right,
  children
}: {
  title?: string
  right?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
      {(title || right) && (
        <div className="mb-2 flex items-center justify-between">
          {title && (
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gold">{title}</h3>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Chip({
  children,
  tone = 'slate'
}: {
  children: ReactNode
  tone?: 'slate' | 'blue' | 'red' | 'orange' | 'green'
}): ReactElement {
  const tones = {
    slate: 'bg-slate-700/60 text-slate-300',
    blue: 'bg-lolblue/15 text-lolblue',
    red: 'bg-red-500/15 text-red-300',
    orange: 'bg-orange-500/15 text-orange-300',
    green: 'bg-emerald-500/15 text-emerald-300'
  }
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function ItemIcon({
  item,
  version,
  size = 32,
  owned = false,
  highlight = false,
  title
}: {
  item: ItemInfo
  version: string
  size?: number
  owned?: boolean
  highlight?: boolean
  title?: string
}): ReactElement {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <img
        src={itemIcon(version, item.id)}
        alt={item.label}
        title={title ?? `${item.label} — ${gold(item.total)}`}
        width={size}
        height={size}
        className={`rounded border ${highlight ? 'border-lolblue shadow-[0_0_8px_rgba(10,200,185,0.6)]' : 'border-gold/60'} ${owned ? 'opacity-40 grayscale' : ''}`}
      />
      {owned && (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-emerald-500 px-1 text-[8px] font-bold text-black">
          ✓
        </span>
      )}
    </div>
  )
}

export function RuneIcon({
  rune,
  size = 22,
  keystone = false
}: {
  rune: RuneInfo
  size?: number
  keystone?: boolean
}): ReactElement {
  return (
    <img
      src={runeIcon(rune.icon)}
      alt={rune.label}
      title={rune.label}
      width={size}
      height={size}
      className={keystone ? 'rounded-full bg-black/40' : 'rounded-full bg-black/30 p-0.5'}
    />
  )
}

export function Meter({
  label,
  value,
  tone = 'blue'
}: {
  label: string
  value: number
  tone?: 'blue' | 'red' | 'orange'
}): ReactElement {
  const color = tone === 'red' ? 'bg-red-400' : tone === 'orange' ? 'bg-orange-400' : 'bg-lolblue'
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
        <div className={`h-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums text-slate-300">{Math.round(value * 100)}</span>
    </div>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}): ReactElement {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span>
        <span className="block text-xs text-slate-200">{label}</span>
        {hint && <span className="block text-[10px] leading-snug text-slate-500">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-[#0ac8b9]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
