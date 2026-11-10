'use client'
// Painel Comercial v6 — cartões e blocos reaproveitados pelas abas. Cada rótulo/indicador leva o "?" (RD-95).
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { C, ROTA } from './fmt'

export function Cartao({ rot, chave, valor, sub }: { rot: string; chave: string; valor: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.esp, marginTop: 4 }}>{valor}</div>
      {sub ? <div style={{ fontSize: 12, color: C.d, marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

export function Bloco({ titulo, chave, children }: { titulo: string; chave: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>{titulo}<AjudaCampo chave={chave} rota={ROTA} /></div>
      {children}
    </div>
  )
}
