// src/app/dashboard/manual-vivo/page.tsx
// Dashboard executivo Manual Vivo — consume manual_vivo_diario.
// Mostra evolucao do sistema em 30 snapshots + insights criticos da IA.
// Pilar 3: mobile-first, Espresso/Off-white/Dourado, semaforos apenas
// para scores (verde >= 60, amarelo 30-59, vermelho < 30).

'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  cream: '#F0ECE3',
  gold: '#C8941A',
  border: '#E0D8CC',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#DC2626',
  ink: '#1A1410',
}

type Snapshot = {
  id: number
  data_snapshot: string
  hora_snapshot: string
  total_telas_capturadas: number
  score_medio_geral: number | string
  pct_evolucao_geral: number | string
  total_bugs_visuais_detectados: number
  custo_ia_brl_total_acumulado: number | string
  top_5_bugs_criticos: Array<{ rota: string; bugs: string[] }>
  top_3_telas_atacar: Array<{ rota: string; score: number; prioridade: string; proximo_passo: string }>
  proximas_acoes_recomendadas: string[]
}

const num = (v: number | string | null | undefined): number => {
  if (v == null) return 0
  return typeof v === 'string' ? parseFloat(v) : v
}

const scoreColor = (s: number): string => (s >= 60 ? C.green : s >= 30 ? C.amber : C.red)

const prioridadeColor = (p: string): string => {
  const pl = p?.toLowerCase()
  if (pl === 'critica') return C.red
  if (pl === 'alta') return C.amber
  return C.espressoM
}

const fmtDataHora = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

const fmtDataCurta = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  } catch {
    return iso
  }
}

export default function ManualVivoPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setErro(null)
      try {
        const { data, error } = await supabase
          .from('manual_vivo_diario')
          .select(
            'id, data_snapshot, hora_snapshot, total_telas_capturadas, score_medio_geral, pct_evolucao_geral, total_bugs_visuais_detectados, custo_ia_brl_total_acumulado, top_5_bugs_criticos, top_3_telas_atacar, proximas_acoes_recomendadas',
          )
          .order('data_snapshot', { ascending: false })
          .order('hora_snapshot', { ascending: false })
          .limit(30)
        if (error) throw error
        if (alive) setSnapshots((data ?? []) as Snapshot[])
      } catch (e: any) {
        if (alive) setErro(e?.message || 'Falha ao carregar snapshots')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const ultimo = snapshots[0]
  const chartData = useMemo(() => {
    return [...snapshots].reverse().map((s) => ({
      label: fmtDataCurta(s.hora_snapshot),
      pct: num(s.pct_evolucao_geral),
      score: num(s.score_medio_geral),
    }))
  }, [snapshots])

  if (loading) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)', textAlign: 'center', color: C.espressoM }}>
        Carregando Manual Vivo…
      </div>
    )
  }

  if (erro) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ background: '#FCE8E8', color: C.red, padding: 14, borderRadius: 10, fontSize: 13 }}>
          {erro}
        </div>
      </div>
    )
  }

  if (!ultimo) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)', textAlign: 'center', color: C.espressoM }}>
        Nenhum snapshot Manual Vivo registrado ainda.
      </div>
    )
  }

  return (
    <div style={{ background: C.offWhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px)' }}>
        {/* Header */}
        <header style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: C.gold, margin: 0 }}>
            Admin · Auditor 24/7
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 400, margin: '4px 0 6px', color: C.espresso }}>
            Manual Vivo
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: C.espressoM }}>
            Último snapshot: <strong>{fmtDataHora(ultimo.hora_snapshot)}</strong> · {snapshots.length} captura
            {snapshots.length === 1 ? '' : 's'} no histórico
          </p>
        </header>

        {/* KPIs */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <Kpi
            label="Score médio geral"
            value={num(ultimo.score_medio_geral).toFixed(1)}
            accent={scoreColor(num(ultimo.score_medio_geral))}
          />
          <Kpi
            label="% Evolução geral"
            value={`${num(ultimo.pct_evolucao_geral).toFixed(1)}%`}
            accent={scoreColor(num(ultimo.pct_evolucao_geral))}
          />
          <Kpi label="Bugs visuais" value={String(ultimo.total_bugs_visuais_detectados)} accent={C.espresso} />
          <Kpi
            label="Custo IA acumulado"
            value={`R$ ${num(ultimo.custo_ia_brl_total_acumulado).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            accent={C.gold}
          />
        </section>

        {/* Chart evolução */}
        {chartData.length > 1 && (
          <section
            style={{
              background: '#FFFFFF',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 1px 3px rgba(61,35,20,0.06)',
              marginBottom: 24,
            }}
          >
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.espressoL, margin: '0 0 12px' }}>
              Evolução — últimos {chartData.length} snapshots
            </h2>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.espressoM }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: C.espressoM }} domain={[0, 100]} />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => [`${Number(value).toFixed(1)}${name === 'pct' ? '%' : ''}`, name === 'pct' ? '% evolução' : 'score']}
                    labelStyle={{ color: C.espresso, fontSize: 12 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}` }}
                  />
                  <Line type="monotone" dataKey="pct" stroke={C.gold} strokeWidth={2} dot={{ r: 3, fill: C.gold }} />
                  <Line type="monotone" dataKey="score" stroke={C.espresso} strokeWidth={1.5} dot={{ r: 2, fill: C.espresso }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Top 5 bugs críticos */}
        <Section title="Top 5 bugs críticos">
          {ultimo.top_5_bugs_criticos?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ultimo.top_5_bugs_criticos.map((b, i) => (
                <Card key={`${b.rota}-${i}`} borderColor={C.red}>
                  <code style={{ fontSize: 12, fontWeight: 600, color: C.espresso }}>{b.rota}</code>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: C.espressoM, fontSize: 13, lineHeight: 1.5 }}>
                    {b.bugs.map((bug, j) => (
                      <li key={j}>{bug}</li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          ) : (
            <p style={{ color: C.espressoL, fontSize: 13, fontStyle: 'italic' }}>Sem bugs registrados neste snapshot.</p>
          )}
        </Section>

        {/* Top 3 telas a atacar */}
        <Section title="Top 3 telas a atacar">
          {ultimo.top_3_telas_atacar?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ultimo.top_3_telas_atacar.map((t, i) => (
                <Card key={`${t.rota}-${i}`} borderColor={prioridadeColor(t.prioridade)}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <code style={{ fontSize: 12, fontWeight: 600, color: C.espresso }}>{t.rota}</code>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: prioridadeColor(t.prioridade) + '22',
                        color: prioridadeColor(t.prioridade),
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {t.prioridade}
                    </span>
                    <span style={{ fontSize: 11, color: C.espressoL }}>score {t.score}</span>
                  </div>
                  <p style={{ margin: '8px 0 0', color: C.espressoM, fontSize: 13, lineHeight: 1.5 }}>{t.proximo_passo}</p>
                </Card>
              ))}
            </div>
          ) : (
            <p style={{ color: C.espressoL, fontSize: 13, fontStyle: 'italic' }}>Sem prioridades cadastradas neste snapshot.</p>
          )}
        </Section>

        {/* Próximas ações */}
        <Section title="Próximas ações recomendadas">
          {ultimo.proximas_acoes_recomendadas?.length ? (
            <ol style={{ margin: 0, paddingLeft: 22, color: C.espressoM, fontSize: 14, lineHeight: 1.7 }}>
              {ultimo.proximas_acoes_recomendadas.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          ) : (
            <p style={{ color: C.espressoL, fontSize: 13, fontStyle: 'italic' }}>Sem ações sugeridas neste snapshot.</p>
          )}
        </Section>

        <footer style={{ marginTop: 24, fontSize: 11, color: C.espressoL, textAlign: 'center' }}>
          Snapshot ID #{ultimo.id} · {ultimo.total_telas_capturadas} telas capturadas
        </footer>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: C.espressoL }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.espressoL, margin: '0 0 10px' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Card({ children, borderColor }: { children: React.ReactNode; borderColor: string }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: 10,
        padding: 14,
        borderLeft: `4px solid ${borderColor}`,
        boxShadow: '0 1px 3px rgba(61,35,20,0.06)',
      }}
    >
      {children}
    </div>
  )
}
