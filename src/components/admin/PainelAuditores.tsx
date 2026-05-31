'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { categorizeRota, colorForScore, type CategoriaArea } from '@/lib/auditores/categorizeRota'

interface Insight {
  rota: string
  score_visual: number | null
  score_funcional: number | null
  bugs_visuais_detectados: string[] | null
  recomendacoes: string[] | null
  proximo_passo_sugerido: string | null
  prioridade_atacar: string | null
  screenshot_url_analisado: string | null
  analisado_em: string | null
  claude_custo_usd: number | string | null
}

const COLORS = {
  espresso: '#3D2314',
  espressoLight: 'rgba(61,35,20,0.55)',
  espressoLighter: 'rgba(61,35,20,0.04)',
  offWhite: '#FAF7F2',
  offWhiteDark: 'rgba(61,35,20,0.08)',
  dourado: '#C8941A',
  border: '0.5px solid rgba(61,35,20,0.12)',
}

function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function horasAtras(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3600000)
  if (h < 1) return 'há min'
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

export default function PainelAuditores() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaArea | null>(null)
  const [selecionada, setSelecionada] = useState<Insight | null>(null)
  const [disparando, setDisparando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase
      .from('system_screens_insights')
      .select(
        'rota, score_visual, score_funcional, bugs_visuais_detectados, recomendacoes, proximo_passo_sugerido, prioridade_atacar, screenshot_url_analisado, analisado_em, claude_custo_usd',
      )
      .order('analisado_em', { ascending: false })
    if (error) setErro(error.message)
    else setInsights((data as Insight[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Dedup por rota (a primeira é a mais recente devido ao ORDER BY DESC)
  const latestPorRota = useMemo(() => {
    const m = new Map<string, Insight>()
    for (const row of insights) if (!m.has(row.rota)) m.set(row.rota, row)
    return m
  }, [insights])

  const latestArr = useMemo(() => Array.from(latestPorRota.values()), [latestPorRota])

  // KPIs
  const kpis = useMemo(() => {
    const total = latestArr.length
    const now = Date.now()
    const insights24h = insights.filter((r) => r.analisado_em && (now - new Date(r.analisado_em).getTime()) < 86400000).length
    const criticas = latestArr.filter((r) => (r.score_visual ?? 0) < 30).length
    const excelentes = latestArr.filter((r) => (r.score_visual ?? 0) >= 70).length
    const cutoff30d = now - 30 * 86400000
    const custo30d = insights
      .filter((r) => r.analisado_em && new Date(r.analisado_em).getTime() >= cutoff30d)
      .reduce((s, r) => s + Number(r.claude_custo_usd ?? 0), 0)
    return { total, insights24h, criticas, excelentes, custo30d }
  }, [insights, latestArr])

  // Heatmap por categoria
  const heatmap = useMemo(() => {
    const acc = new Map<CategoriaArea, { qtd: number; soma: number; criticas: number; medianas: number; excelentes: number }>()
    for (const r of latestArr) {
      const cat = categorizeRota(r.rota)
      const s = r.score_visual ?? 0
      const slot = acc.get(cat) ?? { qtd: 0, soma: 0, criticas: 0, medianas: 0, excelentes: 0 }
      slot.qtd += 1
      slot.soma += s
      if (s < 30) slot.criticas += 1
      else if (s < 70) slot.medianas += 1
      else slot.excelentes += 1
      acc.set(cat, slot)
    }
    return Array.from(acc.entries())
      .map(([cat, v]) => ({ categoria: cat, qtd: v.qtd, score_medio: v.qtd ? Math.round(v.soma / v.qtd) : 0, criticas: v.criticas, medianas: v.medianas, excelentes: v.excelentes }))
      .sort((a, b) => b.criticas - a.criticas || a.score_medio - b.score_medio)
  }, [latestArr])

  // Top 10 críticas (com filtro de categoria opcional)
  const criticas = useMemo(() => {
    const base = filtroCategoria
      ? latestArr.filter((r) => categorizeRota(r.rota) === filtroCategoria)
      : latestArr.filter((r) => (r.score_visual ?? 0) < 30)
    return base.sort((a, b) => (a.score_visual ?? 0) - (b.score_visual ?? 0)).slice(0, 10)
  }, [latestArr, filtroCategoria])

  async function dispararAuditoria() {
    if (disparando) return
    if (!confirm('Disparar auditoria de todas as áreas agora? Custo Claude pode chegar a alguns dólares.')) return
    setDisparando(true)
    setMsg(null)
    const { error } = await supabase.rpc('fn_auditor_matriz_disparar_todas_areas', {})
    setDisparando(false)
    if (error) setMsg('Erro: ' + error.message)
    else setMsg('✓ Auditoria disparada. Resultados aparecem aqui em até alguns minutos.')
  }

  return (
    <div style={{ background: COLORS.offWhite, minHeight: '100vh' }}>
      <header style={{ background: COLORS.espresso, padding: '20px 28px', color: COLORS.offWhite }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: COLORS.dourado, margin: 0, fontWeight: 700 }}>Admin</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, margin: '4px 0 0' }}>Painel Auditores</h1>
            <p style={{ fontSize: 12, color: 'rgba(250,247,242,0.7)', margin: '4px 0 0' }}>
              Análises visuais &amp; funcionais geradas pelo cron 4×/dia · {kpis.total} rotas auditadas
            </p>
          </div>
          <button
            type="button"
            onClick={dispararAuditoria}
            disabled={disparando}
            style={{ background: COLORS.dourado, color: COLORS.espresso, border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: disparando ? 'wait' : 'pointer' }}
          >
            {disparando ? 'Disparando…' : '✨ Disparar auditoria agora'}
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 28px' }}>
        {msg && (
          <div style={{ background: '#FFF7E6', border: '0.5px solid rgba(200,148,26,0.3)', color: COLORS.espresso, padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
            {msg}
          </div>
        )}
        {erro && (
          <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
            Erro ao carregar: {erro}
          </div>
        )}

        {/* Hero KPIs */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
          <KpiHero label="Rotas auditadas" valor={kpis.total} loading={loading} />
          <KpiHero label="Análises últimas 24h" valor={kpis.insights24h} loading={loading} />
          <KpiHero label="Críticas (<30)" valor={kpis.criticas} loading={loading} corValor="#A32D2D" />
          <KpiHero label="Excelentes (≥70)" valor={kpis.excelentes} loading={loading} corValor="#3B6D11" />
          <KpiHero label="Custo Claude 30d" valor={loading ? '—' : fmtUsd(kpis.custo30d)} loading={loading} corValor={COLORS.dourado} />
        </section>

        {/* Heatmap */}
        <section style={{ background: '#FFFFFF', border: COLORS.border, borderRadius: 12, padding: '18px 20px', marginBottom: 32, overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: COLORS.espressoLight, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
              Mapa de calor por área
            </span>
            {filtroCategoria && (
              <button
                type="button"
                onClick={() => setFiltroCategoria(null)}
                style={{ background: 'transparent', border: 'none', color: COLORS.dourado, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Limpar filtro ✕
              </button>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid rgba(61,35,20,0.1)' }}>
                <Th>Categoria</Th>
                <Th align="right">Rotas</Th>
                <Th align="right">Score médio</Th>
                <Th align="right">Críticas</Th>
                <Th align="right">Medianas</Th>
                <Th align="right">Excelentes</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: COLORS.espressoLight }}>Carregando…</td></tr>
              )}
              {!loading && heatmap.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: COLORS.espressoLight }}>Sem dados ainda.</td></tr>
              )}
              {heatmap.map((row) => {
                const sel = filtroCategoria === row.categoria
                const tone = colorForScore(row.score_medio)
                return (
                  <tr
                    key={row.categoria}
                    onClick={() => setFiltroCategoria(sel ? null : row.categoria)}
                    style={{ borderBottom: '0.5px solid rgba(61,35,20,0.06)', cursor: 'pointer', background: sel ? 'rgba(200,148,26,0.08)' : 'transparent' }}
                  >
                    <td style={{ padding: '10px 8px', color: COLORS.espresso, fontWeight: sel ? 700 : 500 }}>{row.categoria}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: COLORS.espresso }}>{row.qtd}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <span style={{ background: tone.bg, color: tone.text, padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                        {row.score_medio}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: row.criticas > 0 ? '#A32D2D' : COLORS.espressoLight, fontWeight: row.criticas > 0 ? 700 : 400 }}>{row.criticas}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: row.medianas > 0 ? '#854F0B' : COLORS.espressoLight }}>{row.medianas}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: row.excelentes > 0 ? '#3B6D11' : COLORS.espressoLight }}>{row.excelentes}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {/* Top 10 críticas */}
        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: 0, color: COLORS.espresso }}>
              {filtroCategoria ? `Top rotas — ${filtroCategoria}` : 'Top 10 rotas críticas'}
            </h2>
            <span style={{ fontSize: 12, color: COLORS.espressoLight }}>
              {filtroCategoria ? `${criticas.length} rota(s)` : 'score visual < 30, mais críticas primeiro'}
            </span>
          </div>

          {loading && (
            <div style={{ background: '#FFFFFF', border: COLORS.border, borderRadius: 12, padding: 40, textAlign: 'center', color: COLORS.espressoLight }}>
              Carregando…
            </div>
          )}

          {!loading && criticas.length === 0 && (
            <div style={{ background: '#FFFFFF', border: COLORS.border, borderRadius: 12, padding: 40, textAlign: 'center', color: COLORS.espressoLight }}>
              {filtroCategoria ? 'Nenhuma rota nessa categoria.' : '🎉 Nenhuma rota crítica no momento.'}
            </div>
          )}

          {!loading && criticas.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {criticas.map((r) => (
                <CardCritica key={r.rota} insight={r} onClick={() => setSelecionada(r)} />
              ))}
            </div>
          )}
        </section>
      </main>

      {selecionada && <ModalDrillDown insight={selecionada} onClose={() => setSelecionada(null)} />}
    </div>
  )
}

function KpiHero({ label, valor, loading, corValor }: { label: string; valor: number | string; loading: boolean; corValor?: string }) {
  return (
    <div style={{ background: '#FFFFFF', border: COLORS.border, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: COLORS.espressoLight, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: corValor ?? COLORS.espresso, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {loading ? '…' : valor}
      </div>
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{ textAlign: align ?? 'left', padding: '8px', color: COLORS.espressoLight, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {children}
    </th>
  )
}

function CardCritica({ insight, onClick }: { insight: Insight; onClick: () => void }) {
  const score = insight.score_visual ?? 0
  const tone = colorForScore(score)
  const bugsCount = insight.bugs_visuais_detectados?.length ?? 0

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: '#FFFFFF', border: COLORS.border, borderLeft: '4px solid #A32D2D', borderRadius: 10, padding: '14px 16px', cursor: 'pointer', textAlign: 'left', font: 'inherit', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ background: tone.bg, color: tone.text, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {score}/100
          </span>
          <span style={{ fontSize: 13, color: COLORS.espresso, fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {insight.rota}
          </span>
          <span style={{ fontSize: 11, color: COLORS.espressoLight }}>{horasAtras(insight.analisado_em)}</span>
        </div>
        {insight.proximo_passo_sugerido && (
          <div style={{ fontSize: 12, color: COLORS.espresso, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: COLORS.dourado, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>Próximo passo · </span>
            {insight.proximo_passo_sugerido}
          </div>
        )}
        {bugsCount > 0 && (
          <div style={{ fontSize: 11, color: '#A32D2D' }}>
            {bugsCount} bug{bugsCount > 1 ? 's' : ''} visual{bugsCount > 1 ? 'is' : ''} detectado{bugsCount > 1 ? 's' : ''}
          </div>
        )}
      </div>
      <span style={{ fontSize: 11, color: COLORS.dourado, fontWeight: 700, alignSelf: 'center' }}>Detalhes →</span>
    </button>
  )
}

function ModalDrillDown({ insight, onClose }: { insight: Insight; onClose: () => void }) {
  const score = insight.score_visual ?? 0
  const tone = colorForScore(score)

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.offWhite, borderRadius: 12, maxWidth: 920, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ background: COLORS.espresso, color: COLORS.offWhite, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, zIndex: 1, gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: COLORS.dourado, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>Drill-down</div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginTop: 2 }}>
              {insight.rota}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: COLORS.offWhite, border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ background: tone.bg, color: tone.text, padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              Visual: {insight.score_visual ?? '—'}
            </span>
            <span style={{ background: colorForScore(insight.score_funcional ?? 0).bg, color: colorForScore(insight.score_funcional ?? 0).text, padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              Funcional: {insight.score_funcional ?? '—'}
            </span>
            {insight.prioridade_atacar && (
              <span style={{ background: 'rgba(200,148,26,0.15)', color: '#854F0B', padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Prioridade: {insight.prioridade_atacar}
              </span>
            )}
            <span style={{ fontSize: 12, color: COLORS.espressoLight, alignSelf: 'center' }}>{horasAtras(insight.analisado_em)}</span>
          </div>

          {insight.proximo_passo_sugerido && (
            <div style={{ background: COLORS.espresso, color: COLORS.offWhite, borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: COLORS.dourado, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 4 }}>Próximo passo sugerido</div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{insight.proximo_passo_sugerido}</div>
            </div>
          )}

          {insight.screenshot_url_analisado && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: COLORS.espressoLight, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, fontWeight: 700 }}>Screenshot analisado</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={insight.screenshot_url_analisado}
                alt={`Screenshot de ${insight.rota}`}
                style={{ width: '100%', maxHeight: 420, objectFit: 'contain', background: '#FFFFFF', border: COLORS.border, borderRadius: 8 }}
              />
            </div>
          )}

          <ListaArray titulo="Bugs visuais detectados" cor="#A32D2D" items={insight.bugs_visuais_detectados} emptyLabel="Nenhum bug visual." />
          <ListaArray titulo="Recomendações" cor={COLORS.dourado} items={insight.recomendacoes} emptyLabel="Sem recomendações específicas." />

          <div style={{ fontSize: 11, color: COLORS.espressoLight, marginTop: 12 }}>
            Custo da análise: <strong>{fmtUsd(Number(insight.claude_custo_usd ?? 0))}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function ListaArray({ titulo, cor, items, emptyLabel }: { titulo: string; cor: string; items: string[] | null; emptyLabel: string }) {
  const arr = items ?? []
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: cor, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, fontWeight: 700 }}>
        {titulo}
        {arr.length > 0 && <span style={{ color: COLORS.espressoLight, marginLeft: 6, fontWeight: 500 }}>({arr.length})</span>}
      </div>
      {arr.length === 0 ? (
        <div style={{ fontSize: 12, color: COLORS.espressoLight }}>{emptyLabel}</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: COLORS.espresso, lineHeight: 1.5 }}>
          {arr.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
