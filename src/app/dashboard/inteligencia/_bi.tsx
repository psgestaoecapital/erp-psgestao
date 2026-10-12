'use client'

// Peças compartilhadas das telas de detalhe do BI Agro (custo/rebanho/pasto). Prefixo "_" = não é rota.
// Identidade PS: espresso/off-white/dourado; paleta de gráfico "terrosa" (categórica, não-status).
import React from 'react'
import { useRouter } from 'next/navigation'

export const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF'
export const MUT = 'rgba(61,35,20,0.55)', VERDE = '#2E8B57'
// paleta categórica terrosa (dourado/espresso/oliva/terracota) — cores decorativas, nunca semáforo
export const PALETA = ['#C8941A', '#8A6D3B', '#A0522D', '#6B8E23', '#3D2314', '#B7791F', '#557153', '#9C6644', '#7A5A0F', '#4E6151']

export const fmtInt = (n: number) => (Number(n) || 0).toLocaleString('pt-BR')
export const fmtBRL = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
export const fmtDec = (n: number, d = 2) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })

export function BiScaffold({ area, kicker, titulo, children }: { area: string; kicker: string; titulo: string; children: React.ReactNode }) {
  const router = useRouter()
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <button onClick={() => router.push(`/dashboard/inteligencia?area=${area}`)} style={{ background: 'transparent', border: 'none', color: MUT, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← Análise de dados</button>
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>{kicker}</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>{titulo}</h1>
        </header>
        {children}
      </div>
    </div>
  )
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>{children}</div>
}
export function Kpi({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: ESP, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function Bloco({ titulo, children, span }: { titulo: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 12 }}>{titulo}</div>
      {children}
    </div>
  )
}
export function Grade({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>{children}</div>
}

// Empty state honesto (RD-58): declara o que falta, nunca inventa.
export function EmBreve({ titulo, motivo }: { titulo: string; motivo: string }) {
  return (
    <div style={{ background: 'rgba(61,35,20,0.035)', border: `0.5px dashed ${LINE}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: MUT }}>{titulo} · <span style={{ color: GOLD }}>em breve</span></div>
      <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>{motivo}</div>
    </div>
  )
}

export function Carregando() {
  return <div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
}
export function SemEmpresa() {
  return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo.</div>
}
