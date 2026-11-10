'use client'
// Aba Logística do painel v7 (SPEC §2.7). Só desenha: números de calcularLogisticaV7 (logisticaV7.ts).
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { LogisticaV7 } from './logisticaV7'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel-v6'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const kg = (v: number) => `${int(v)} kg`
const pct = (v: number) => `${nf({ maximumFractionDigits: 1 }).format(v)}%`

type Props = { log: LogisticaV7 }

export function AbaLogisticaV7({ log }: Props) {
  const [ord, setOrd] = useState<{ k: keyof LogisticaV7['transportadoras'][number]; dir: 1 | -1 }>({ k: 'kg', dir: -1 })
  const tabela = useMemo(() => [...log.transportadoras].sort((a, b) => {
    const va = a[ord.k] as unknown as number | string
    const vb = b[ord.k] as unknown as number | string
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * ord.dir
    return ((va as number) - (vb as number)) * ord.dir
  }), [log.transportadoras, ord])
  const seta = (k: keyof LogisticaV7['transportadoras'][number]) => ord.k === k ? (ord.dir === -1 ? ' ↓' : ' ↑') : ''

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 15, margin: 0 }}>
        <b>{int(log.cargas)} cargas</b> montadas no período, <b>{kg(log.kgMedCarga)}</b> por carga em média.
      </p>

      {/* 4 cards (SPEC §2.7) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Cargas montadas<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{int(log.cargas)}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Peso médio por carga<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{kg(log.kgMedCarga)}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Clientes por carga<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{nf({ maximumFractionDigits: 1 }).format(log.cliMedCarga)}</div>
          <div style={{ fontSize: 12, color: C.m }}>entregas em média</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Notas sem carga<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{int(log.notasSem)}</div>
          <div style={{ fontSize: 12, color: C.m }}>{kg(log.kgSem)} retirados ou sem romaneio</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {/* Peso das cargas: histograma */}
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Peso das cargas<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={log.pesoFaixas.map((f) => ({ rot: f.faixa, n: f.cargas }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.bd} />
                <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: C.m }} width={40} />
                <Tooltip formatter={(v) => `${int(Number(v))} cargas`} />
                <Bar dataKey="n" fill={C.esp} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cargas por dia da semana */}
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Cargas por dia da semana<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={log.diaSemana.map((d) => ({ rot: d.rot, n: d.cargas }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.bd} />
                <XAxis dataKey="rot" tick={{ fontSize: 12, fill: C.m }} />
                <YAxis tick={{ fontSize: 11, fill: C.m }} width={40} />
                <Tooltip formatter={(v) => `${int(Number(v))} cargas`} />
                <Bar dataKey="n" fill={C.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Transportadoras: TODAS, ordenáveis */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Transportadoras ({int(tabela.length)})<AjudaCampo chave="com.painel.logistica" rota={ROTA} /></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
            <thead>
              <tr style={{ color: C.m, textAlign: 'left' }}>
                {([['Transportador', 'nome'], ['Cargas', 'cargas'], ['Participação', 'part'], ['Volume', 'kg'], ['Notas', 'notas'], ['Clientes', 'clientes']] as [string, keyof LogisticaV7['transportadoras'][number]][]).map(([rot, k]) => (
                  <th key={rot} style={{ padding: '6px 4px', textAlign: k === 'nome' ? 'left' : 'right' }}>
                    <button type="button" onClick={() => setOrd((o) => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : -1 }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.m, fontWeight: 600, fontSize: 13, padding: 0 }}>{rot}{seta(k)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabela.map((t) => (
                <tr key={t.nome} style={{ borderTop: `1px solid ${C.bd}` }}>
                  <td style={{ padding: '6px 4px' }}>{t.nome}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(t.cargas)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{pct(t.part)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{kg(t.kg)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(t.notas)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(t.clientes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
