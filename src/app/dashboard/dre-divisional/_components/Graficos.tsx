'use client'

import { useMemo } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'
import { C, fmtBRL, MESES_PT } from './index'

type Linha = {
  ln_id: string
  ln_nome: string
  ebitda_pre_rateio: number
  ebitda_pos_rateio: number
}

type SerieItem = { ano: number; mes: number; ln_id: string; ln_nome: string; ebitda_pos_rateio: number }

const SERIES_CORES = [C.gold, C.espresso, '#A07050', '#7B6552', '#B89C7A', '#5C3923']

function tooltipContentValor({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div style={{ background: 'white', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(61, 35, 20, 0.1)' }}>
      <div style={{ fontWeight: 600, color: C.espresso, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{p.name}:</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{fmtBRL(Number(p.value) || 0)}</span>
        </div>
      ))}
    </div>
  )
}

export function GraficoBarrasEbitda({ linhas }: { linhas: Linha[] }) {
  const data = useMemo(() => linhas.map((l) => ({
    nome: l.ln_nome,
    pre: l.ebitda_pre_rateio,
    real: l.ebitda_pos_rateio,
  })), [linhas])

  if (data.length === 0) return null

  return (
    <section style={{ background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 20 }}>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, margin: '0 0 16px', color: C.espresso }}>
        EBITDA por Linha de Negócio
      </h2>
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 16px' }}>
        Comparação visual: barra dourada = antes do rateio · barra espresso = após absorção da estrutura SEDE.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
          <XAxis dataKey="nome" tick={{ fontSize: 12, fill: C.espresso }} stroke={C.borderLt} />
          <YAxis tick={{ fontSize: 11, fill: C.muted }} stroke={C.borderLt} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
          <Tooltip content={tooltipContentValor} cursor={{ fill: C.beigeLt, opacity: 0.4 }} />
          <Legend wrapperStyle={{ fontSize: 12, color: C.espresso }} />
          <Bar dataKey="pre" name="EBITDA Pré-Rateio" fill={C.gold} radius={[6, 6, 0, 0]} />
          <Bar dataKey="real" name="EBITDA Real" fill={C.espresso} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  )
}

export function GraficoSerie12m({ serie }: { serie: SerieItem[] }) {
  // Pivota: cada eixo X é um (ano,mes); colunas são ln_nome.
  const { dataChart, lns } = useMemo(() => {
    const byMes = new Map<string, any>()
    const lnSet = new Set<string>()
    for (const s of serie) {
      const key = `${s.ano}-${String(s.mes).padStart(2, '0')}`
      const label = `${MESES_PT[s.mes - 1].slice(0, 3)}/${String(s.ano).slice(-2)}`
      const row = byMes.get(key) || { _key: key, _label: label, _ano: s.ano, _mes: s.mes }
      row[s.ln_nome] = (row[s.ln_nome] || 0) + s.ebitda_pos_rateio
      byMes.set(key, row)
      lnSet.add(s.ln_nome)
    }
    const sorted = Array.from(byMes.values()).sort((a, b) => a._key.localeCompare(b._key))
    return { dataChart: sorted, lns: Array.from(lnSet).sort() }
  }, [serie])

  if (dataChart.length === 0) {
    return (
      <section style={{ background: 'white', borderRadius: 12, padding: 32, textAlign: 'center', color: C.muted, marginBottom: 20 }}>
        Sem histórico suficiente para a série de 12 meses.
      </section>
    )
  }

  return (
    <section style={{ background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 20 }}>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, margin: '0 0 16px', color: C.espresso }}>
        EBITDA Real — últimos 12 meses
      </h2>
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 16px' }}>
        Identifica sazonalidade. Cada linha representa uma LN.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={dataChart} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={C.borderLt} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="_label" tick={{ fontSize: 11, fill: C.espresso }} stroke={C.borderLt} />
          <YAxis tick={{ fontSize: 11, fill: C.muted }} stroke={C.borderLt} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
          <Tooltip content={tooltipContentValor} />
          <Legend wrapperStyle={{ fontSize: 12, color: C.espresso }} />
          {lns.map((ln, i) => (
            <Line
              key={ln}
              type="monotone"
              dataKey={ln}
              name={ln}
              stroke={SERIES_CORES[i % SERIES_CORES.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  )
}
