'use client'
// Kit visual premium do Wealth (identidade PS · Espresso/off-white/dourado). Reutilizado pela lista rica,
// pela ficha 360° e pelos painéis (Suitability/IPS/Recomendações). Semáforo só em perfil/drift — nunca decorativo.
import type { CSSProperties } from 'react'

export const ESP = '#3D2314', GOLD = '#C8941A', BG = '#FAF7F2'
export const LINE = 'rgba(61,35,20,0.12)', MUT = 'rgba(61,35,20,0.6)'

export const fmtBRL = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
export const fmtBRLcompact = (n: number | null | undefined) => {
  if (n == null) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`
  return fmtBRL(v)
}
export const fmtData = (s: string | null | undefined) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—')

// Perfil de risco: cor por faixa (semáforo do perfil — conservador→agressivo).
export const PERFIL_COR: Record<string, string> = {
  conservador: '#2F5D2F', moderado: '#6B7A2B', balanceado: '#6B7A2B', arrojado: '#9A6A15', agressivo: '#7A1F1F',
}
export function PerfilChip({ perfil }: { perfil: string | null | undefined }) {
  const p = (perfil ?? '').toLowerCase()
  const cor = PERFIL_COR[p] ?? MUT
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize"
      style={{ background: `${cor}1A`, color: cor }}>
      <i style={{ width: 7, height: 7, borderRadius: 999, background: cor, display: 'inline-block' }} />
      {perfil ?? 'sem perfil'}
    </span>
  )
}

// Classes de ativo (nomenclatura dos wealth_ips_templates / wealth_assets.classe).
export const CLASSE_LABEL: Record<string, string> = {
  renda_fixa_pos: 'RF Pós', renda_fixa_pre: 'RF Pré', renda_fixa_inflacao: 'RF Inflação',
  renda_variavel: 'Renda Variável', fundos_imob: 'Fundos Imob.', exterior: 'Exterior',
  alternativos: 'Alternativos', fundos: 'Fundos', outros: 'Outros',
}
export const rotulaClasse = (c: string | null | undefined) =>
  CLASSE_LABEL[(c ?? '') as string] ?? (c ?? '—').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
export const CLASSE_COR: Record<string, string> = {
  renda_fixa_pos: '#6B4A2B', renda_fixa_pre: '#8A5A2B', renda_fixa_inflacao: '#A67C52',
  renda_variavel: '#C8941A', fundos_imob: '#D8B98C', exterior: '#E0B24A', alternativos: '#3D2314',
  fundos: '#9A6A15', outros: '#B9A38A',
}
const PALETA = ['#3D2314', '#6B4A2B', '#8A5A2B', '#C8941A', '#E0B24A', '#A67C52', '#D8B98C', '#B9A38A']
export const corDaClasse = (c: string, i = 0) => CLASSE_COR[c] ?? PALETA[i % PALETA.length]

// Pizza (conic-gradient, sem dependência).
export function Pizza({ aloc, size = 168 }: { aloc: Record<string, number>; size?: number }) {
  const entradas = Object.entries(aloc).map(([k, v]) => [k, Number(v) || 0] as const).filter(([, v]) => v > 0)
  const total = entradas.reduce((a, [, v]) => a + v, 0) || 1
  let acc = 0
  const stops = entradas.map(([k, v], i) => {
    const ini = (acc / total) * 360; acc += v; const fim = (acc / total) * 360
    return `${corDaClasse(k, i)} ${ini}deg ${fim}deg`
  }).join(', ')
  const hole = Math.round(size * 0.4)
  return (
    <div className="flex items-center justify-center">
      <div style={{ width: size, height: size, borderRadius: '50%', background: entradas.length ? `conic-gradient(${stops})` : LINE, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: (size - hole) / 2, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ fontSize: 10, color: MUT }}>alocação</span>
          <span style={{ fontSize: 18, color: ESP, fontWeight: 700 }}>{Math.round(total)}%</span>
        </div>
      </div>
    </div>
  )
}

export function LegendaClasses({ aloc }: { aloc: Record<string, number> }) {
  const entradas = Object.entries(aloc).map(([k, v]) => [k, Number(v) || 0] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (entradas.length === 0) return <p className="text-sm" style={{ color: MUT }}>Sem posições para compor a alocação.</p>
  return (
    <div className="grid gap-1.5 text-sm">
      {entradas.map(([k, v], i) => (
        <div key={k} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2" style={{ color: ESP }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: corDaClasse(k, i), display: 'inline-block' }} />{rotulaClasse(k)}
          </span>
          <span style={{ color: MUT }}>{v}%</span>
        </div>
      ))}
    </div>
  )
}

// Avatar: foto ou iniciais (fallback).
export function Avatar({ nome, foto, size = 44 }: { nome: string; foto?: string | null; size?: number }) {
  const iniciais = (nome || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  if (foto) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={foto} alt={nome} width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `1px solid ${LINE}` }} />
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${GOLD}22`, color: ESP, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.36, border: `1px solid ${LINE}` }}>
      {iniciais || '?'}
    </div>
  )
}

// Barras aderência atual × alvo (uma por classe), fora-da-banda em destaque.
export type Desvio = { classe: string; alvo_pct: number; atual_pct: number; desvio_pp: number; banda_min: number; banda_max: number; status: string }
export function BarrasAderencia({ desvios }: { desvios: Desvio[] }) {
  const ordenado = desvios.slice().sort((a, b) => Math.abs(b.desvio_pp) - Math.abs(a.desvio_pp))
  return (
    <div className="grid gap-2.5">
      {ordenado.map((d) => {
        const fora = d.status !== 'dentro_banda'
        const max = Math.max(d.alvo_pct, d.atual_pct, 1)
        return (
          <div key={d.classe}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span style={{ color: ESP, fontWeight: fora ? 700 : 400 }}>{rotulaClasse(d.classe)}</span>
              <span style={{ color: fora ? '#7A4A0F' : MUT }}>
                {d.atual_pct}% <span style={{ color: MUT }}>/ alvo {d.alvo_pct}%</span>
                {fora && <span className="ml-1">({d.desvio_pp > 0 ? '+' : ''}{d.desvio_pp}pp)</span>}
              </span>
            </div>
            <div className="relative h-3 rounded-full" style={{ background: 'rgba(61,35,20,0.06)' }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(d.atual_pct / max) * 100}%`, background: fora ? GOLD : 'rgba(61,35,20,0.35)' }} />
              <div className="absolute inset-y-0" style={{ left: `calc(${(d.alvo_pct / max) * 100}% - 1px)`, width: 2, background: ESP }} title={`alvo ${d.alvo_pct}%`} />
            </div>
          </div>
        )
      })}
      <p className="text-[11px] mt-1" style={{ color: MUT }}>Barra = atual · traço = alvo do IPS.</p>
    </div>
  )
}

export const inpStyle: CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '0.55rem 0.6rem', background: '#fff', color: ESP, fontSize: 14 }
export const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div style={toastStyle}>{msg}</div>
}
