'use client'

// Análise do DRE (CEO 28/10) — tela abaixo do DRE Consolidado, linha a linha e interativa.
// REUSA a MESMA fonte do DRE Consolidado (fn_psgc_dre_horizontal) → os números batem 1:1 com o DRE.
// Blocos: indicadores do período, evolução mensal (linhas), cascata, composição (rosca), despesas por tipo mês a mês
// (barras empilhadas), pessoas × mês (mapa de calor, fn_psgc_dre_analise_pessoas, LGPD) e top fornecedores.
// RD-95 "?" em tudo (chaves dre.analise.* em erp_ajuda_campo). Celular: blocos empilham. Cores do tema do DRE.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { fmtMoedaDre } from '@/lib/formatoMoedaDre'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'

const ROTA = '/dashboard/financeiro/dre-analise'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', RED = '#A32D2D', CREAM = '#F2EBDF', WHITE = '#FFFFFF', BLUE = '#2F5AA8'
const MESES_LBL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const PALETA = ['#C8941A', '#2F5AA8', '#166534', '#A32D2D', '#7A4AB8', '#1F8A8A', '#B8761F', '#555']
const pad2 = (n: number) => String(n).padStart(2, '0')
const pct1 = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')}%`

type Linha = { ordem: number; kind: string; codigo: string; nome: string; grupo_ref?: string; valores_mes?: Record<string, number> }
type Mes = { ym: string; label: string; projecao?: boolean }
type Horiz = { ok: boolean; erro?: string; meses: Mes[]; linhas: Linha[] }
type Pessoa = { pessoa: string; total: number; por_mes: Record<string, number> }
type AnalisePessoas = { ok: boolean; pode_ver_pessoas: boolean; motivo_sem_pessoas?: string; meses: string[]; total_dre: number; pessoas: Pessoa[] }

// grupos de DESPESA (para composição e barras) — magnitude absoluta
const GRUPOS_DESPESA: { codigo: string; nome: string }[] = [
  { codigo: 'CMV', nome: 'CMV / CPV' },
  { codigo: 'DESP_VARIAVEL', nome: 'Despesas variáveis' },
  { codigo: 'DESP_FIXA', nome: 'Despesas fixas' },
  { codigo: 'DEPREC_AMORT', nome: 'Depreciação' },
  { codigo: 'IMPOSTOS_VENDA', nome: 'Impostos s/ vendas' },
  { codigo: 'DEDUCOES', nome: 'Deduções' },
]
const CHIPS = [
  { key: 'tudo', nome: 'Tudo' },
  { key: 'ROB', nome: 'Receitas' },
  { key: 'CMV', nome: 'CMV/CPV' },
  { key: 'DESP_VARIAVEL', nome: 'Despesas variáveis' },
  { key: 'DESP_FIXA', nome: 'Despesas fixas' },
  { key: 'NAO_OPER', nome: 'Não-operacional' },
  { key: 'DESTINACAO', nome: 'Destinação' },
]

export default function DreAnalisePage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: MUT, background: BG, minHeight: '100vh' }}>Carregando…</div>}>
      <Inner />
    </Suspense>
  )
}

function Inner() {
  const { sel, selInfo } = useCompanyIds()
  const params = useSearchParams()
  const now = useMemo(() => new Date(), [])
  const [regime, setRegime] = useState<'competencia' | 'caixa' | 'previsto'>(() => {
    const r = params.get('regime'); return r === 'caixa' || r === 'previsto' ? r : 'competencia'
  })
  const [ano, setAno] = useState<number>(() => Number(params.get('ano')) || now.getFullYear())
  const [selIni, setSelIni] = useState<number>(() => Number(params.get('mi')) || 1)
  const [selFim, setSelFim] = useState<number>(() => Number(params.get('mf')) || now.getMonth() + 1)
  const [chip, setChip] = useState<string>('tudo')
  const [busca, setBusca] = useState('')
  const [contaSel, setContaSel] = useState<string | null>(null)

  const [membros, setMembros] = useState<string[]>([])
  const [hz, setHz] = useState<Horiz | null>(null)
  const [hzAnt, setHzAnt] = useState<Horiz | null>(null)
  const [pessoas, setPessoas] = useState<AnalisePessoas | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const empresaUnica = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : null

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!empresaUnica) { if (alive) setMembros([]); return }
      const { data: g } = await supabase.rpc('fn_grupo_empresa', { p_company_id: empresaUnica })
      if (!alive) return
      const r = g as { ok?: boolean; company_ids?: string[] } | null
      setMembros(r?.ok && r.company_ids?.length ? r.company_ids : [empresaUnica])
    })()
    return () => { alive = false }
  }, [empresaUnica])

  // período atual + período anterior de mesmo tamanho (para a variação)
  const nMeses = selFim - selIni + 1
  const antFim = selIni - 1
  const antIni = antFim - nMeses + 1
  const anoAnt = antIni < 1 ? ano - 1 : ano
  const [antIniN, antFimN] = antIni < 1 ? [antIni + 12, antFim < 1 ? antFim + 12 : antFim] : [antIni, antFim]

  const carregar = useCallback(async () => {
    if (!membros.length) { setHz(null); setPessoas(null); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_psgc_dre_horizontal', { p_company_ids: membros, p_mes_ini: `${ano}-${pad2(selIni)}-01`, p_mes_fim: `${ano}-${pad2(selFim)}-01`, p_regime: regime })
    const prev = await supabase.rpc('fn_psgc_dre_horizontal', { p_company_ids: membros, p_mes_ini: `${anoAnt}-${pad2(antIniN)}-01`, p_mes_fim: `${anoAnt}-${pad2(antFimN)}-01`, p_regime: regime })
    setLoading(false)
    if (error || !(data as Horiz)?.ok) { setErro('Não deu para carregar o DRE agora.'); return }
    setHz(data as Horiz); setHzAnt((prev.data as Horiz)?.ok ? (prev.data as Horiz) : null)
  }, [membros, ano, selIni, selFim, regime, anoAnt, antIniN, antFimN])
  useEffect(() => { let a = true; void (async () => { if (a) await carregar() })(); return () => { a = false } }, [carregar])

  // pessoas × mês quando uma conta é escolhida
  useEffect(() => {
    let alive = true
    void (async () => {
      if (!membros.length || !contaSel) { if (alive) setPessoas(null); return }
      const { data } = await supabase.rpc('fn_psgc_dre_analise_pessoas', { p_company_ids: membros, p_mes_ini: `${ano}-${pad2(selIni)}-01`, p_mes_fim: `${ano}-${pad2(selFim)}-01`, p_regime: regime, p_psgc_codigos: [contaSel], p_top: 15 })
      if (alive) setPessoas((data as AnalisePessoas)?.ok ? (data as AnalisePessoas) : null)
    })()
    return () => { alive = false }
  }, [membros, contaSel, ano, selIni, selFim, regime])

  const somaLinha = useCallback((pred: (l: Linha) => boolean, h: Horiz | null): number => {
    if (!h) return 0
    const l = h.linhas.find(pred); if (!l?.valores_mes) return 0
    return Object.values(l.valores_mes).reduce((s, v) => s + (v ?? 0), 0)
  }, [])
  const resultado = useCallback((cod: string, h: Horiz | null) => somaLinha((l) => l.kind === 'resultado' && l.codigo === cod, h), [somaLinha])
  const grupo = useCallback((cod: string, h: Horiz | null) => somaLinha((l) => l.kind === 'grupo' && l.codigo === cod, h), [somaLinha])

  const rl = resultado('RL', hz), ebitda = resultado('EBITDA', hz), ll = resultado('LL', hz)
  const custosDesp = rl - ebitda
  const rlAnt = resultado('RL', hzAnt), ebitdaAnt = resultado('EBITDA', hzAnt), llAnt = resultado('LL', hzAnt)
  const variacao = (a: number, b: number) => (b === 0 ? null : (a - b) / Math.abs(b))

  const serieEvolucao = useMemo(() => (hz?.meses ?? []).map((m) => {
    const val = (cod: string, kind = 'resultado') => hz!.linhas.find((l) => l.kind === kind && l.codigo === cod)?.valores_mes?.[m.ym] ?? 0
    return { mes: m.label, 'Receita líquida': val('RL'), 'Custos + despesas': val('RL') - val('EBITDA'), EBITDA: val('EBITDA'), 'Lucro líquido': val('LL') }
  }), [hz])

  const composicao = useMemo(() => GRUPOS_DESPESA.map((g) => ({ nome: g.nome, codigo: g.codigo, valor: Math.abs(grupo(g.codigo, hz)) })).filter((x) => x.valor > 0.005), [hz, grupo])

  const barrasTipo = useMemo(() => (hz?.meses ?? []).map((m) => {
    const row: Record<string, number | string> = { mes: m.label }
    for (const g of GRUPOS_DESPESA) row[g.nome] = Math.abs(hz!.linhas.find((l) => l.kind === 'grupo' && l.codigo === g.codigo)?.valores_mes?.[m.ym] ?? 0)
    return row
  }), [hz])

  const cascata = useMemo(() => {
    if (!hz) return []
    const rb = grupo('ROB', hz)
    const passos = [
      { nome: 'Receita bruta', v: rb, tipo: 'base' },
      { nome: '(−) Deduções', v: grupo('DEDUCOES', hz), tipo: 'neg' },
      { nome: '(−) Impostos', v: grupo('IMPOSTOS_VENDA', hz), tipo: 'neg' },
      { nome: '(−) CMV/CPV', v: grupo('CMV', hz), tipo: 'neg' },
      { nome: '(−) Variáveis', v: grupo('DESP_VARIAVEL', hz), tipo: 'neg' },
      { nome: '(−) Fixas', v: grupo('DESP_FIXA', hz), tipo: 'neg' },
      { nome: '= EBITDA', v: ebitda, tipo: 'total' },
      { nome: '(±) Não-op/Fin', v: grupo('NAO_OPER', hz) + grupo('RESULT_FIN', hz) + grupo('DEPREC_AMORT', hz) + grupo('IR_CSLL', hz), tipo: 'mix' },
      { nome: '= Lucro líquido', v: ll, tipo: 'total' },
      { nome: '(−) Destinação', v: grupo('DESTINACAO', hz), tipo: 'neg' },
      { nome: '= Lucro retido', v: ll + grupo('DESTINACAO', hz), tipo: 'total' },
    ]
    return passos.map((p) => ({ ...p, valorAbs: Math.abs(p.v) }))
  }, [hz, grupo, ebitda, ll])

  // contas para a busca/seleção (linhas kind=conta), filtradas pelo chip e pela busca
  const contas = useMemo(() => {
    const ls = (hz?.linhas ?? []).filter((l) => l.kind === 'conta')
    return ls.filter((l) => (chip === 'tudo' || l.grupo_ref === chip))
      .filter((l) => !busca || l.nome.toLowerCase().includes(busca.toLowerCase()) || l.codigo.includes(busca))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  }, [hz, chip, busca])

  const limpar = () => { setChip('tudo'); setBusca(''); setContaSel(null) }
  const clicarMes = (e: React.MouseEvent, m: number) => {
    if (e.shiftKey) { setSelIni(Math.min(m, selIni)); setSelFim(Math.max(m, selFim)) } else { setSelIni(m); setSelFim(m) }
  }

  if (!empresaUnica) return <div style={{ padding: 40, color: MUT, background: BG, minHeight: '100vh' }}>Selecione uma empresa para analisar o DRE.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '18px 16px 60px' }} data-testid="dre-analise">
      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: ESP, margin: 0 }}>Análise do DRE <span style={{ fontSize: 13, fontWeight: 600, color: MUT }}>· {selInfo.nome}</span></h1>
          <Link href="/dashboard/financeiro/dre-consolidado" style={{ color: BLUE, textDecoration: 'none', fontSize: 13 }}>← DRE Consolidado</Link>
        </div>

        {/* Filtros */}
        <section style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['competencia', 'caixa', 'previsto'] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRegime(r)} style={chipBtn(regime === r)}>{r === 'competencia' ? 'Competência' : r === 'caixa' ? 'Caixa' : 'Previsto'}</button>
            ))}
            <Aj k="dre.analise.regime" />
            <span style={{ width: 1, height: 18, background: LINE, margin: '0 4px' }} />
            <button type="button" onClick={() => setAno(ano - 1)} style={navBtn}>◂</button>
            <span style={{ fontWeight: 700, color: ESP, minWidth: 44, textAlign: 'center' }}>{ano}</span>
            <button type="button" onClick={() => setAno(ano + 1)} style={navBtn}>▸</button>
            <Aj k="dre.analise.periodo" />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {MESES_LBL.map((lbl, i) => {
              const m = i + 1, on = m >= selIni && m <= selFim
              return <button key={lbl} type="button" onClick={(e) => clicarMes(e, m)} style={{ ...chipBtn(on), padding: '5px 9px', fontSize: 12 }}>{lbl}</button>
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {CHIPS.map((c) => <button key={c.key} type="button" onClick={() => { setChip(c.key); setContaSel(null) }} style={{ ...chipBtn(chip === c.key), fontSize: 12 }}>{c.nome}</button>)}
            <Aj k="dre.analise.chips_tipo" />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: MUT }}>Conta <Aj k="dre.analise.busca_conta" /></span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conta (ex.: Pessoal)" aria-label="Buscar conta"
              style={{ padding: '7px 9px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 7, background: WHITE, color: ESP, minWidth: 200 }} />
            {contas.slice(0, 8).map((c) => <button key={c.codigo} type="button" onClick={() => setContaSel(contaSel === c.codigo ? null : c.codigo)} style={{ ...chipBtn(contaSel === c.codigo), fontSize: 12 }}>{c.nome}</button>)}
            <button type="button" onClick={limpar} style={{ ...navBtn, marginLeft: 'auto' }}>Limpar filtros <Aj k="dre.analise.limpar" /></button>
          </div>
        </section>

        {erro && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FCEBEB', color: RED, fontSize: 13 }}>{erro}</div>}
        {loading && <div style={{ color: MUT, fontSize: 13 }}>Carregando o DRE…</div>}

        {!loading && hz && (
          <>
            {/* 1. Indicadores */}
            <Card titulo="Indicadores do período" ajuda="dre.analise.indicadores">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
                {[
                  { nome: 'Receita líquida', v: rl, base: rl, ant: rlAnt },
                  { nome: 'Custos + despesas', v: custosDesp, base: rl, ant: rlAnt - ebitdaAnt },
                  { nome: 'EBITDA', v: ebitda, base: rl, ant: ebitdaAnt },
                  { nome: 'Lucro líquido', v: ll, base: rl, ant: llAnt },
                ].map((k) => {
                  const varp = variacao(k.v, k.ant)
                  return (
                    <div key={k.nome} style={{ border: `1px solid ${CREAM}`, borderRadius: 10, padding: '10px 12px', background: BG }} data-testid={`ind-${k.nome}`}>
                      <div style={{ fontSize: 11.5, color: MUT }}>{k.nome}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: k.v < 0 ? RED : ESP }}>{fmtMoedaDre(k.v)}</div>
                      <div style={{ fontSize: 11, color: MUT }}>{k.base ? pct1(k.v / k.base) : '—'} da RL{varp != null && <span style={{ color: varp >= 0 ? GREEN : RED }}> · {varp >= 0 ? '▲' : '▼'} {pct1(Math.abs(varp))} vs período anterior</span>}</div>
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* 2. Evolução mensal */}
            <Card titulo="Evolução mensal" ajuda="dre.analise.evolucao">
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={serieEvolucao} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CREAM} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11, fill: MUT }} />
                    <YAxis tick={{ fontSize: 11, fill: MUT }} tickFormatter={(v) => fmtMoedaDre(Number(v))} width={90} />
                    <Tooltip formatter={(v) => fmtMoedaDre(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="Receita líquida" stroke={GOLD} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Custos + despesas" stroke={RED} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="EBITDA" stroke={BLUE} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Lucro líquido" stroke={GREEN} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* 3. Cascata */}
            <Card titulo="Cascata do período" ajuda="dre.analise.cascata">
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={cascata} margin={{ top: 8, right: 12, bottom: 50, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CREAM} />
                    <XAxis dataKey="nome" tick={{ fontSize: 10, fill: MUT }} angle={-35} textAnchor="end" interval={0} height={60} />
                    <YAxis tick={{ fontSize: 11, fill: MUT }} tickFormatter={(v) => fmtMoedaDre(Number(v))} width={90} />
                    <Tooltip formatter={(v) => fmtMoedaDre(Number(v))} />
                    <Bar dataKey="valorAbs" radius={[4, 4, 0, 0]}>
                      {cascata.map((p, i) => <Cell key={i} fill={p.tipo === 'total' ? GOLD : p.tipo === 'base' ? BLUE : RED} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
              {/* 4. Composição */}
              <Card titulo="Composição das despesas" ajuda="dre.analise.composicao">
                {composicao.length === 0 ? <div style={{ color: MUT, fontSize: 13 }}>Sem despesas neste período.</div> : (
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={composicao} dataKey="valor" nameKey="nome" cx="50%" cy="50%" innerRadius={55} outerRadius={95}
                          onClick={(d) => { const cod = (d as unknown as { codigo?: string })?.codigo; if (cod && CHIPS.some((c) => c.key === cod)) setChip(cod) }}>
                          {composicao.map((c, i) => <Cell key={c.codigo} fill={PALETA[i % PALETA.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fmtMoedaDre(Number(v))} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
              {/* 5. Barras empilhadas */}
              <Card titulo="Despesas por tipo, mês a mês" ajuda="dre.analise.barras_tipo">
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={barrasTipo} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CREAM} />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: MUT }} />
                      <YAxis tick={{ fontSize: 11, fill: MUT }} tickFormatter={(v) => fmtMoedaDre(Number(v))} width={90} />
                      <Tooltip formatter={(v) => fmtMoedaDre(Number(v))} />
                      {GRUPOS_DESPESA.map((g, i) => <Bar key={g.codigo} dataKey={g.nome} stackId="d" fill={PALETA[i % PALETA.length]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            {/* 6/7. Pessoas × mês + Top */}
            <Card titulo={`Pessoas × mês${contaSel ? ` · ${(hz.linhas.find((l) => l.codigo === contaSel)?.nome) ?? contaSel}` : ''}`} ajuda="dre.analise.pessoas_mes">
              {!contaSel ? (
                <div style={{ color: MUT, fontSize: 13 }}>Escolha uma conta acima (ex.: Pessoal — Folha e Encargos) para ver as pessoas mês a mês.</div>
              ) : !pessoas ? (
                <div style={{ color: MUT, fontSize: 13 }}>Carregando…</div>
              ) : !pessoas.pode_ver_pessoas ? (
                <div style={{ color: MUT, fontSize: 13 }}>{pessoas.motivo_sem_pessoas ?? 'Os nomes por pessoa são dados sensíveis (LGPD) — visíveis apenas para sócio, administrador e financeiro.'} Total da conta: <b>{fmtMoedaDre(pessoas.total_dre)}</b>.</div>
              ) : pessoas.pessoas.length === 0 ? (
                <div style={{ color: MUT, fontSize: 13 }}>Sem lançamentos nesta conta e período.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                    <thead>
                      <tr><th style={thL}>Pessoa</th>{pessoas.meses.map((m) => <th key={m} style={th}>{MESES_LBL[Number(m.slice(5, 7)) - 1]}</th>)}<th style={th}>Total</th></tr>
                    </thead>
                    <tbody>
                      {pessoas.pessoas.map((p) => {
                        const max = Math.max(1, ...pessoas.pessoas.flatMap((q) => Object.values(q.por_mes).map(Math.abs)))
                        return (
                          <tr key={p.pessoa}>
                            <td style={tdL}>{p.pessoa}</td>
                            {pessoas.meses.map((m) => { const v = p.por_mes[m] ?? 0; const int = Math.min(0.85, Math.abs(v) / max); return <td key={m} style={{ ...td, background: v ? `rgba(200,148,26,${0.08 + int * 0.55})` : 'transparent' }}>{v ? fmtMoedaDre(v) : ''}</td> })}
                            <td style={{ ...td, fontWeight: 700 }}>{fmtMoedaDre(p.total)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 11, color: MUT, marginTop: 6 }}>Total da conta no DRE: <b>{fmtMoedaDre(pessoas.total_dre)}</b> (a soma das pessoas fecha com esta linha).</div>
                </div>
              )}
            </Card>
          </>
        )}
        <div style={{ fontSize: 11, color: MUT }}>Os números vêm da mesma fonte do DRE Consolidado (fn_psgc_dre_horizontal) — batem 1:1 com a tela do DRE.</div>
      </div>
    </div>
  )
}

function Card({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <section style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 16px' }}>
      <h2 style={{ fontSize: 14, fontWeight: 800, color: ESP, margin: '0 0 10px' }}>{titulo} <Aj k={ajuda} /></h2>
      {children}
    </section>
  )
}

const chipBtn = (on: boolean): React.CSSProperties => ({ padding: '6px 11px', fontSize: 13, fontWeight: 600, borderRadius: 999, border: `1px solid ${on ? GOLD : LINE}`, background: on ? GOLD : WHITE, color: on ? WHITE : ESP, cursor: 'pointer' })
const navBtn: React.CSSProperties = { padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: `1px solid ${LINE}`, background: WHITE, color: ESP, cursor: 'pointer' }
const th: React.CSSProperties = { padding: '5px 7px', borderBottom: `1px solid ${LINE}`, textAlign: 'right', color: MUT, fontWeight: 600, whiteSpace: 'nowrap' }
const thL: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '4px 7px', borderBottom: `1px solid ${CREAM}`, textAlign: 'right', color: ESP, whiteSpace: 'nowrap' }
const tdL: React.CSSProperties = { ...td, textAlign: 'left', fontWeight: 600 }
