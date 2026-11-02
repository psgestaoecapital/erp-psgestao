'use client'
// BENCHMARK INTERNO DA AGÊNCIA (P&M, CEO 31/10). V1 100% INTERNO (sem dado externo, sem API paga):
// compara entre si CLIENTES, SERVIÇOS e MEMBROS da equipe pela mesma régua — margem real, receita/hora,
// horas por entrega, entregas no prazo e retrabalho (rodadas de aprovação). A média da agência é a linha de
// referência; o melhor e o pior de cada período ficam destacados. Benchmark de MERCADO externo é fase futura.
// Fonte única: fn_pm_benchmark (guarda por company_id). Tema Espresso. RD-95 ("?") / RD-96 / RD-99.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/benchmark'
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const AMBER = '#B8860B'; const VERMELHO = '#B3261E'

type Linha = {
  id: string | null; nome: string; jobs: number; receita: number; custo: number
  margem_pct: number | null; receita_hora: number | null; horas: number; entregues: number
  horas_entrega: number | null; prazo_pct: number | null; retrabalho: number
}
type Media = Omit<Linha, 'id' | 'nome'>
type Resp = {
  empty_state?: boolean; vazio_periodo?: boolean; periodo_dias?: number
  media?: Media | null; clientes?: Linha[]; servicos?: Linha[]; membros?: Linha[]
}
type Dim = 'clientes' | 'servicos' | 'membros'

const DIMS: { k: Dim; rot: string }[] = [
  { k: 'clientes', rot: 'Clientes' }, { k: 'servicos', rot: 'Serviços' }, { k: 'membros', rot: 'Equipe' },
]
const PERIODOS = [30, 90, 180, 365]

const COLS: { k: keyof Linha; rot: string; chave: string; tipo: 'rs' | 'pct' | 'num' | 'h'; destaque?: boolean }[] = [
  { k: 'jobs', rot: 'Jobs', chave: 'pm.benchmark.dimensao', tipo: 'num' },
  { k: 'receita', rot: 'Receita', chave: 'pm.benchmark.receita_hora', tipo: 'rs' },
  { k: 'margem_pct', rot: 'Margem', chave: 'pm.benchmark.margem', tipo: 'pct', destaque: true },
  { k: 'receita_hora', rot: 'R$/hora', chave: 'pm.benchmark.receita_hora', tipo: 'rs' },
  { k: 'horas_entrega', rot: 'h/entrega', chave: 'pm.benchmark.horas_entrega', tipo: 'h' },
  { k: 'prazo_pct', rot: 'No prazo', chave: 'pm.benchmark.prazo', tipo: 'pct' },
  { k: 'retrabalho', rot: 'Retrabalho', chave: 'pm.benchmark.retrabalho', tipo: 'num' },
]

const brl = (n: number) => n >= 1000 ? `R$${(n / 1000).toFixed(1).replace('.', ',')}k` : `R$${Math.round(n)}`
function fmt(v: number | null, tipo: 'rs' | 'pct' | 'num' | 'h'): string {
  if (v == null) return '—'
  if (tipo === 'rs') return brl(v)
  if (tipo === 'pct') return `${v}%`
  if (tipo === 'h') return `${v}h`
  return String(v)
}
function corMargem(v: number | null): string {
  if (v == null) return TEXTM
  if (v >= 50) return GREEN
  if (v >= 25) return AMBER
  return VERMELHO
}

export default function BenchmarkPage() {
  const { companyIds } = useCompanyIds()
  const [dias, setDias] = useState(90)
  const [dim, setDim] = useState<Dim>('clientes')
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyIds.length) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_pm_benchmark', { p_company_ids: companyIds, p_dias: dias })
    if (error) { setErro(error.message); setResp(null) } else { setResp((data ?? {}) as Resp) }
    setLoading(false)
  }, [companyIds, dias])
  useEffect(() => { void carregar() }, [carregar])

  const linhas = useMemo<Linha[]>(() => (resp?.[dim] as Linha[] | undefined) ?? [], [resp, dim])
  const media = resp?.media ?? null
  const melhorId = linhas[0]?.id ?? null
  const piorId = linhas.length > 1 ? linhas[linhas.length - 1].id : null

  if (!companyIds.length) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 16px', color: ESPRESSO }}>
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        <header style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>📊 P&amp;M · Desempenho</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0', display: 'flex', alignItems: 'center' }}>
            Benchmark interno<AjudaCampo chave="pm.benchmark.tela" rota={ROTA} />
          </h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '6px 0 0', maxWidth: 660 }}>
            Compare entre si os seus clientes, serviços e a equipe pela mesma régua. A referência é a <b>média da sua agência</b> —
            quem está acima rende mais, quem está abaixo pede atenção. Sem comparação com o mercado externo (fase futura).
          </p>
        </header>

        {/* Controles: período + dimensão */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: TEXTM, marginRight: 4 }}>Período</span>
            <AjudaCampo chave="pm.benchmark.periodo" rota={ROTA} />
            <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
              {PERIODOS.map((p) => (
                <button key={p} onClick={() => setDias(p)} style={chip(dias === p)}>{p}d</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: TEXTM, marginRight: 4 }}>Comparar por</span>
            <AjudaCampo chave="pm.benchmark.dimensao" rota={ROTA} />
            <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
              {DIMS.map((d) => (
                <button key={d.k} onClick={() => setDim(d.k)} style={chip(dim === d.k)}>{d.rot}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Média da agência (referência) */}
        {media && (
          <section style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: '12px 16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Média da agência</span>
              <AjudaCampo chave="pm.benchmark.media" rota={ROTA} />
              <span style={{ marginLeft: 'auto', fontSize: 11, color: TEXTM }}>{media.jobs} jobs no período</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <Kpi rot="Margem" val={fmt(media.margem_pct, 'pct')} cor={corMargem(media.margem_pct)} />
              <Kpi rot="R$/hora" val={fmt(media.receita_hora, 'rs')} />
              <Kpi rot="h/entrega" val={fmt(media.horas_entrega, 'h')} />
              <Kpi rot="No prazo" val={fmt(media.prazo_pct, 'pct')} />
              <Kpi rot="Retrabalho" val={fmt(media.retrabalho, 'num')} />
            </div>
          </section>
        )}

        {/* Ranking */}
        <section style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 36, textAlign: 'center', color: TEXTM }}>Carregando…</div>
            : erro ? <div style={{ padding: 20, color: VERMELHO, fontSize: 13 }}>Não foi possível carregar: {erro}</div>
            : !linhas.length ? <div style={{ padding: 36, textAlign: 'center', color: TEXTM, fontSize: 13 }}>Sem jobs neste período para comparar. Troque o período acima.</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                  <thead>
                    <tr style={{ background: OFFWHITE, textAlign: 'left' }}>
                      <th style={{ ...th, position: 'sticky', left: 0, background: OFFWHITE }}>{DIMS.find((d) => d.k === dim)?.rot.replace(/s$/, '')}</th>
                      {COLS.map((c) => (
                        <th key={c.k} style={{ ...th, textAlign: 'right' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}>{c.rot}<AjudaCampo chave={c.chave} rota={ROTA} alinhar="fim" /></span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const melhor = l.id != null && l.id === melhorId
                      const pior = l.id != null && l.id === piorId
                      return (
                        <tr key={l.id ?? l.nome} style={{ borderTop: `1px solid ${OFFWHITE}`, background: melhor ? '#F3F8F0' : pior ? '#FBF1F0' : '#fff' }}>
                          <td style={{ ...td, position: 'sticky', left: 0, background: 'inherit', fontWeight: 700 }}>
                            {melhor && <span title="Melhor do período" style={{ marginRight: 4 }}>🏆</span>}
                            {pior && <span title="Precisa de atenção" style={{ marginRight: 4 }}>⚠️</span>}
                            {l.nome}
                          </td>
                          {COLS.map((c) => {
                            const v = l[c.k] as number | null
                            const cor = c.k === 'margem_pct' ? corMargem(v) : ESPRESSO
                            return <td key={c.k} style={{ ...td, textAlign: 'right', color: cor, fontWeight: c.destaque ? 700 : 400 }}>{fmt(v, c.tipo)}</td>
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <p style={{ fontSize: 11, color: TEXTM, marginTop: 12, fontStyle: 'italic' }}>
          Margem = (receita − custo das horas) ÷ receita. Linhas com margem muito alta e sem custo costumam ser jobs cujas
          horas ainda não foram apontadas. O ranking é ordenado pela margem; toque no &ldquo;?&rdquo; de cada coluna para a fórmula e a fonte.
        </p>
      </div>
    </div>
  )
}

function Kpi({ rot, val, cor }: { rot: string; val: string; cor?: string }) {
  return (
    <div style={{ border: `1px solid ${BORDA}`, borderRadius: 10, padding: '8px 10px', background: OFFWHITE }}>
      <div style={{ fontSize: 11, color: TEXTM }}>{rot}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: cor ?? ESPRESSO }}>{val}</div>
    </div>
  )
}
function chip(ativo: boolean): CSSProperties {
  return { background: ativo ? ESPRESSO : '#fff', color: ativo ? '#fff' : TEXTM, border: `1px solid ${ativo ? ESPRESSO : BORDA}`, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
}
const th: CSSProperties = { padding: '10px 12px', fontSize: 11.5, fontWeight: 700, color: TEXTM, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' }
