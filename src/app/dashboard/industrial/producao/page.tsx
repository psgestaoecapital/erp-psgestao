'use client'

// BI Industrial de Produção — F1: filtro compacto + abas + Visão geral + Abate.
// Estrutura GENÉRICA (especie/planta são atributos vindos do dado, nada hardcoded); o dado é específico.
// Lê SÓ a camada neutra v_ind_producao_abate (troca atak->evento no futuro sem tocar aqui).
// Abas futuras (Peso&Rendimento, Por lote, Gente) entram em F2/F3.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import PainelGente from '@/components/inteligencia/PainelGente'
import { usePapelUsuario, ehRhIndustrial } from '@/hooks/usePapelUsuario'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const CARD: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }

const toISO = (d: Date) => d.toISOString().slice(0, 10)
const hoje = () => toISO(new Date())
const menosDias = (n: number) => toISO(new Date(Date.now() - n * 864e5))
const inicioMes = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)) }
const fmtDDMM = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)
const fmtN = (v: number, dec = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

type Linha = {
  data_abate: string; lote: string | null; camara: string | null
  peso_carcaca_kg: number | null; meia_carcaca1_kg: number | null; meia_carcaca2_kg: number | null
  arrobas: number | null; tem_rastreio: boolean; especie: string | null
}
type Aba = 'visao' | 'abate' | 'peso' | 'lote' | 'gente'
type Atalho = '1' | '7' | '30' | 'mes' | 'custom'

export default function ProducaoIndustrialPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const { papel } = usePapelUsuario()
  const soGente = ehRhIndustrial(papel) // RH industrial: só a aba Gente; Produção/Abate/Peso/Lote ocultos (por papel)

  const [aba, setAba] = useState<Aba>('visao')
  const [atalho, setAtalho] = useState<Atalho>('7')
  const [dataIni, setDataIni] = useState(menosDias(7))
  const [dataFim, setDataFim] = useState(hoje())
  const [mostraCustom, setMostraCustom] = useState(false)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [planta, setPlanta] = useState<{ nome: string; especies: string[] } | null>(null)
  const [frescor, setFrescor] = useState<{ status: string; rotulo: string } | null>(null)
  const [setores, setSetores] = useState<string[] | null>(null) // escopo LGPD da aba Gente (null = vê tudo)
  const [loading, setLoading] = useState(true)
  // filtros secundários da aba Abate
  const [fLote, setFLote] = useState('')
  const [fCamara, setFCamara] = useState('')

  function aplicaAtalho(a: Atalho) {
    setAtalho(a)
    if (a === '1') { setDataIni(hoje()); setDataFim(hoje()) }
    else if (a === '7') { setDataIni(menosDias(7)); setDataFim(hoje()) }
    else if (a === '30') { setDataIni(menosDias(30)); setDataFim(hoje()) }
    else if (a === 'mes') { setDataIni(inicioMes()); setDataFim(hoje()) }
    if (a !== 'custom') setMostraCustom(false)
  }

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const [ab, pl, fr, sc] = await Promise.all([
      // RH industrial não puxa abate (só vê Gente) — filtro por papel, não só ocultar a aba.
      soGente
        ? Promise.resolve({ data: [] as Linha[] })
        : supabase.from('v_ind_producao_abate')
            .select('data_abate,lote,camara,peso_carcaca_kg,meia_carcaca1_kg,meia_carcaca2_kg,arrobas,tem_rastreio,especie')
            .eq('company_id', companyId).gte('data_abate', dataIni).lte('data_abate', dataFim).order('data_abate'),
      supabase.from('industrial_plants').select('nome_planta,especies').eq('company_id', companyId).eq('is_active', true).limit(1),
      supabase.rpc('fn_frescor_fonte', { p_company_id: companyId, p_fonte: 'atak_abate' }),
      supabase.rpc('fn_bi_gente_setores_visiveis', { p_company_id: companyId }),
    ])
    setLinhas((ab.data as Linha[]) ?? [])
    const p0 = (pl.data as { nome_planta: string; especies: string[] }[] | null)?.[0]
    setPlanta(p0 ? { nome: p0.nome_planta, especies: p0.especies ?? [] } : null)
    const f = fr.data as { status?: string; rotulo?: string } | null
    setFrescor(f?.status ? { status: f.status, rotulo: f.rotulo ?? '' } : null)
    const scope = sc.data as { ve_tudo?: boolean; setores?: string[] } | null
    setSetores(scope?.ve_tudo ? null : (scope?.setores ?? []))
    setFLote(''); setFCamara('')
    setLoading(false)
  }, [companyId, dataIni, dataFim, soGente])

  useEffect(() => { void carregar() }, [carregar])

  // Deep-link: /dashboard/industrial/producao?aba=gente abre direto na aba (usado pelo Hub de BI).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('aba')
    if (p && ['visao', 'abate', 'peso', 'lote', 'gente'].includes(p)) setAba(p as Aba)
  }, [])

  // RH industrial só vê Gente: aba efetiva sempre 'gente' (sem effect/setState — deriva do papel).
  const abaEfetiva: Aba = soGente ? 'gente' : aba

  // ── agregações (client-side; 321 linhas é trivial) ──
  const ag = useMemo(() => {
    const n = linhas.length
    const carcaca = linhas.reduce((s, l) => s + (l.peso_carcaca_kg ?? 0), 0)
    const arrobas = linhas.reduce((s, l) => s + (l.arrobas ?? 0), 0)
    const comRastreio = linhas.filter((l) => l.tem_rastreio).length
    const dias = new Set(linhas.map((l) => l.data_abate)).size
    const porDia = new Map<string, { cab: number; kg: number; arr: number }>()
    const porDiaSem = new Array(7).fill(0)
    for (const l of linhas) {
      const d = porDia.get(l.data_abate) ?? { cab: 0, kg: 0, arr: 0 }
      d.cab++; d.kg += l.peso_carcaca_kg ?? 0; d.arr += l.arrobas ?? 0
      porDia.set(l.data_abate, d)
      porDiaSem[new Date(l.data_abate + 'T12:00:00').getDay()]++
    }
    const diasArr = [...porDia.entries()].map(([data, v]) => ({ data, ...v, medio: v.cab ? v.kg / v.cab : 0 })).sort((a, b) => a.data.localeCompare(b.data))
    return {
      n, carcaca, arrobas, dias,
      medio: n ? carcaca / n : 0,
      sisbovPct: n ? (100 * comRastreio) / n : 0,
      cabDia: n && dias ? n / dias : 0,
      arrobasCab: n ? arrobas / n : 0,
      diasArr, porDiaSem,
    }
  }, [linhas])

  const lotesUnicos = useMemo(() => [...new Set(linhas.map((l) => l.lote).filter(Boolean) as string[])].sort(), [linhas])
  const camarasUnicas = useMemo(() => [...new Set(linhas.map((l) => l.camara).filter(Boolean) as string[])].sort(), [linhas])
  const linhasAbate = useMemo(() => linhas.filter((l) => (!fLote || l.lote === fLote) && (!fCamara || l.camara === fCamara)), [linhas, fLote, fCamara])
  const agAbate = useMemo(() => {
    const porDia = new Map<string, { cab: number; kg: number; arr: number }>()
    for (const l of linhasAbate) {
      const d = porDia.get(l.data_abate) ?? { cab: 0, kg: 0, arr: 0 }
      d.cab++; d.kg += l.peso_carcaca_kg ?? 0; d.arr += l.arrobas ?? 0
      porDia.set(l.data_abate, d)
    }
    return [...porDia.entries()].map(([data, v]) => ({ data, ...v, medio: v.cab ? v.kg / v.cab : 0 })).sort((a, b) => a.data.localeCompare(b.data))
  }, [linhasAbate])

  const especie = planta?.especies?.[0] ?? linhas[0]?.especie ?? 'bovino'

  if (!companyId) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo para ver a Inteligência de Produção.</div>
  }

  const fresco = frescor?.status === 'fresco'
  const pill = (on: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    background: on ? ESP : '#FFF', color: on ? BG : ESP, border: `0.5px solid ${on ? ESP : LINE}`,
  })
  const tabStyle = (on: boolean): React.CSSProperties => ({
    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    background: on ? ESP : '#FFF', color: on ? BG : ESP, border: `0.5px solid ${on ? ESP : LINE}`,
  })

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Cabeçalho */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>
              Industrial · {especie[0].toUpperCase() + especie.slice(1)} · {planta?.nome ?? '—'}
            </div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Inteligência de Produção</h1>
          </div>
          {frescor && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '6px 12px', fontSize: 11, color: MUT }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: fresco ? '#2E8B57' : frescor.status === 'atrasado' ? '#C8941A' : '#B23B3B' }} />
              {frescor.rotulo || frescor.status}
            </div>
          )}
        </header>

        {/* Filtro compacto — 1 linha */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, ...CARD, padding: '8px 12px' }}>
          <button onClick={() => aplicaAtalho('1')} style={pill(atalho === '1')}>Hoje</button>
          <button onClick={() => aplicaAtalho('7')} style={pill(atalho === '7')}>7 dias</button>
          <button onClick={() => aplicaAtalho('30')} style={pill(atalho === '30')}>30 dias</button>
          <button onClick={() => aplicaAtalho('mes')} style={pill(atalho === 'mes')}>Mês</button>
          <span style={{ fontSize: 12, color: MUT }}>{fmtDDMM(dataIni)} – {fmtDDMM(dataFim)}</span>
          <button onClick={() => { setMostraCustom((v) => !v); setAtalho('custom') }} title="Datas personalizadas"
            style={{ ...pill(atalho === 'custom'), padding: '6px 10px' }}>🗓️</button>
          {mostraCustom && (
            <>
              <input type="date" value={dataIni} onChange={(e) => { setDataIni(e.target.value); setAtalho('custom') }}
                style={{ padding: '6px 8px', border: `0.5px solid ${LINE}`, borderRadius: 6, fontSize: 12, color: ESP }} />
              <span style={{ color: MUT }}>→</span>
              <input type="date" value={dataFim} onChange={(e) => { setDataFim(e.target.value); setAtalho('custom') }}
                style={{ padding: '6px 8px', border: `0.5px solid ${LINE}`, borderRadius: 6, fontSize: 12, color: ESP }} />
            </>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: ESP, fontWeight: 600 }}>{ag.dias} {ag.dias === 1 ? 'dia' : 'dias'} · {fmtN(ag.n)} cabeças</span>
        </div>

        {/* Abas · RH industrial vê SÓ Gente (filtro por papel); demais papéis veem tudo. */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }}>
          {!soGente && <button onClick={() => setAba('visao')} style={tabStyle(aba === 'visao')}>Visão geral</button>}
          {!soGente && <button onClick={() => setAba('abate')} style={tabStyle(aba === 'abate')}>Abate</button>}
          {!soGente && <button onClick={() => setAba('peso')} style={tabStyle(aba === 'peso')}>Peso &amp; rendimento</button>}
          {!soGente && <button onClick={() => setAba('lote')} style={tabStyle(aba === 'lote')}>Por lote</button>}
          <button onClick={() => setAba('gente')} style={tabStyle(abaEfetiva === 'gente')}>Gente</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : abaEfetiva === 'gente' ? (
          // Gente é dado independente do abate (ponto) — renderiza mesmo sem abate no período.
          <PainelGente companyId={companyId} dataIni={dataIni} dataFim={dataFim} setoresPermitidos={setores} />
        ) : ag.n === 0 ? (
          <div style={{ ...CARD, textAlign: 'center', color: MUT, fontSize: 14, padding: 40 }}>Sem abate registrado neste período.</div>
        ) : abaEfetiva === 'visao' ? (
          <VisaoGeral ag={ag} />
        ) : abaEfetiva === 'abate' ? (
          <Abate ag={agAbate} porDiaSem={ag.porDiaSem} lotes={lotesUnicos} camaras={camarasUnicas}
            fLote={fLote} fCamara={fCamara} setFLote={setFLote} setFCamara={setFCamara} n={linhasAbate.length} />
        ) : abaEfetiva === 'peso' ? (
          <PesoRendimento linhas={linhas} />
        ) : (
          <PorLote linhas={linhas} />
        )}
      </div>
    </div>
  )
}

function Procedencia({ linhas }: { linhas: number }) {
  return <div style={{ fontSize: 10, color: MUT, marginTop: 8 }}>fonte: v_ind_producao_abate · {fmtN(linhas)} linhas</div>
}

function Card({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <div style={CARD}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 600 }}>{titulo}</div>
      <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: ESP, marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Barras({ dados, max, cor = GOLD }: { dados: { rotulo: string; valor: number; extra?: string }[]; max: number; cor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, overflowX: 'auto', paddingTop: 8 }}>
      {dados.map((d, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 34, flex: '1 0 auto' }}>
          <div style={{ fontSize: 10, color: ESP, fontWeight: 600 }}>{d.valor ? fmtN(d.valor) : ''}</div>
          <div style={{ width: '70%', maxWidth: 28, background: cor, borderRadius: '4px 4px 0 0', height: `${max ? Math.max(2, (d.valor / max) * 120) : 2}px` }} title={d.extra} />
          <div style={{ fontSize: 10, color: MUT, marginTop: 4 }}>{d.rotulo}</div>
        </div>
      ))}
    </div>
  )
}

function VisaoGeral({ ag }: { ag: { n: number; carcaca: number; arrobas: number; medio: number; sisbovPct: number; cabDia: number; arrobasCab: number; diasArr: { data: string; cab: number }[] } }) {
  const maxCab = Math.max(1, ...ag.diasArr.map((d) => d.cab))
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Card titulo="Cabeças abatidas" valor={fmtN(ag.n)} sub={`média ${fmtN(ag.cabDia)}/dia`} />
        <Card titulo="Carcaça total" valor={`${fmtN(ag.carcaca / 1000, 1)} t`} sub={`${fmtN(ag.arrobas, 0)} @`} />
        <Card titulo="Peso médio carcaça" valor={`${fmtN(ag.medio, 0)} kg`} sub={`${fmtN(ag.arrobasCab, 1)} @/cab`} />
        <Card titulo="Rastreabilidade" valor={`${fmtN(ag.sisbovPct, 0)}%`} sub="SISBOV informado" />
      </div>
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 4 }}>Cabeças por dia</div>
        <Barras dados={ag.diasArr.map((d) => ({ rotulo: fmtDDMM(d.data), valor: d.cab }))} max={maxCab} />
        <Procedencia linhas={ag.n} />
      </div>
    </div>
  )
}

function Abate({ ag, porDiaSem, lotes, camaras, fLote, fCamara, setFLote, setFCamara, n }: {
  ag: { data: string; cab: number; kg: number; arr: number; medio: number }[]
  porDiaSem: number[]; lotes: string[]; camaras: string[]
  fLote: string; fCamara: string; setFLote: (v: string) => void; setFCamara: (v: string) => void; n: number
}) {
  const maxCab = Math.max(1, ...ag.map((d) => d.cab))
  const maxDiaSem = Math.max(1, ...porDiaSem)
  const sel: React.CSSProperties = { padding: '6px 10px', border: `0.5px solid ${LINE}`, borderRadius: 6, fontSize: 12, color: ESP, background: '#FFF' }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: MUT }}>Filtrar:</span>
        <select value={fLote} onChange={(e) => setFLote(e.target.value)} style={sel}>
          <option value="">Todos os lotes ({lotes.length})</option>
          {lotes.map((l) => <option key={l} value={l}>Lote {l}</option>)}
        </select>
        <select value={fCamara} onChange={(e) => setFCamara(e.target.value)} style={sel}>
          <option value="">Todas as câmaras ({camaras.length})</option>
          {camaras.map((c) => <option key={c} value={c}>Câmara {c}</option>)}
        </select>
        <span style={{ fontSize: 12, color: MUT }}>{fmtN(n)} cabeças no recorte</span>
      </div>

      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 4 }}>Cabeças por dia · peso médio (kg) no topo</div>
        <Barras dados={ag.map((d) => ({ rotulo: fmtDDMM(d.data), valor: d.cab, extra: `${fmtN(d.medio, 0)} kg médio` }))} max={maxCab} />
        <Procedencia linhas={n} />
      </div>

      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 4 }}>Distribuição por dia da semana</div>
        <Barras dados={porDiaSem.map((v, i) => ({ rotulo: DIAS_SEM[i], valor: v }))} max={maxDiaSem} cor={ESP} />
      </div>

      <div style={{ ...CARD, overflowX: 'auto' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 8 }}>Por dia</div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: MUT, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Dia</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Cabeças</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Carcaça (kg)</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Peso médio</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Arrobas</th>
            </tr>
          </thead>
          <tbody>
            {ag.map((d) => (
              <tr key={d.data} style={{ borderTop: `0.5px solid ${LINE}`, color: ESP }}>
                <td style={{ padding: '6px 8px' }}>{fmtDDMM(d.data)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(d.cab)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(d.kg, 1)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(d.medio, 0)} kg</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(d.arr, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Procedencia linhas={n} />
      </div>

      {/* Placeholder honesto: tipificação não vem da origem hoje (RD-58, não mostra vazio como se fosse 0) */}
      <div style={{ ...CARD, background: 'rgba(200,148,26,0.06)', borderStyle: 'dashed' }}>
        <div style={{ fontSize: 12, color: MUT }}>Tipificação de carcaça (acabamento/carne magra) — <strong>aguardando origem</strong>. O ATAK não envia esses campos hoje; a aba os acomoda quando começarem a chegar. (Confirmar com a TI Frioeste.)</div>
      </div>
    </div>
  )
}

// ── F2 · PESO & RENDIMENTO ──
function PesoRendimento({ linhas }: { linhas: Linha[] }) {
  const dados = useMemo(() => {
    const pesos = linhas.map((l) => l.peso_carcaca_kg).filter((v): v is number => v != null)
    // histograma em faixas de 20kg (do dado, não fixo em nada de espécie)
    const FAIXA = 20
    const bins = new Map<number, number>()
    for (const p of pesos) { const b = Math.floor(p / FAIXA) * FAIXA; bins.set(b, (bins.get(b) ?? 0) + 1) }
    const hist = [...bins.entries()].map(([b, n]) => ({ rotulo: `${b}–${b + FAIXA}`, valor: n })).sort((a, b) => parseInt(a.rotulo) - parseInt(b.rotulo))
    // peso médio por lote
    const porLote = new Map<string, { kg: number; n: number }>()
    for (const l of linhas) { if (!l.lote) continue; const d = porLote.get(l.lote) ?? { kg: 0, n: 0 }; d.kg += l.peso_carcaca_kg ?? 0; d.n++; porLote.set(l.lote, d) }
    const medioLote = [...porLote.entries()].map(([lote, v]) => ({ rotulo: lote, valor: v.n ? Math.round(v.kg / v.n) : 0 })).sort((a, b) => b.valor - a.valor)
    // meia-carcaça 1 vs 2
    const m1 = linhas.reduce((s, l) => s + (l.meia_carcaca1_kg ?? 0), 0)
    const m2 = linhas.reduce((s, l) => s + (l.meia_carcaca2_kg ?? 0), 0)
    const c1 = linhas.filter((l) => l.meia_carcaca1_kg != null).length
    const c2 = linhas.filter((l) => l.meia_carcaca2_kg != null).length
    return { hist, medioLote, m1: c1 ? m1 / c1 : 0, m2: c2 ? m2 / c2 : 0, n: pesos.length }
  }, [linhas])
  const maxH = Math.max(1, ...dados.hist.map((d) => d.valor))
  const maxL = Math.max(1, ...dados.medioLote.map((d) => d.valor))
  const difMeia = dados.m1 && dados.m2 ? (100 * Math.abs(dados.m1 - dados.m2)) / ((dados.m1 + dados.m2) / 2) : 0
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 4 }}>Distribuição de peso de carcaça (faixas de 20 kg)</div>
        <Barras dados={dados.hist} max={maxH} />
        <Procedencia linhas={dados.n} />
      </div>
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 4 }}>Peso médio por lote (kg) — melhor rendimento à esquerda</div>
        <Barras dados={dados.medioLote} max={maxL} cor={ESP} />
        <Procedencia linhas={dados.n} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Card titulo="Meia-carcaça 1 (média)" valor={`${fmtN(dados.m1, 1)} kg`} />
        <Card titulo="Meia-carcaça 2 (média)" valor={`${fmtN(dados.m2, 1)} kg`} />
        <Card titulo="Diferença entre meias" valor={`${fmtN(difMeia, 1)}%`} sub={difMeia <= 3 ? 'equilíbrio bom' : 'verificar desossa'} />
      </div>
      <div style={{ ...CARD, background: 'rgba(200,148,26,0.06)', borderStyle: 'dashed' }}>
        <div style={{ fontSize: 12, color: MUT }}>Tipificação / % carne magra — <strong>aguardando origem</strong> (o ATAK não envia hoje). A aba acomoda quando chegar.</div>
      </div>
    </div>
  )
}

// ── F2 · POR LOTE ──
function PorLote({ linhas }: { linhas: Linha[] }) {
  const { lotes, camaras } = useMemo(() => {
    const map = new Map<string, { n: number; kg: number; arr: number; camaras: Map<string, number>; datas: Set<string> }>()
    const cam = new Map<string, number>()
    for (const l of linhas) {
      if (l.camara) cam.set(l.camara, (cam.get(l.camara) ?? 0) + 1)
      if (!l.lote) continue
      const d = map.get(l.lote) ?? { n: 0, kg: 0, arr: 0, camaras: new Map(), datas: new Set() }
      d.n++; d.kg += l.peso_carcaca_kg ?? 0; d.arr += l.arrobas ?? 0
      if (l.camara) d.camaras.set(l.camara, (d.camaras.get(l.camara) ?? 0) + 1)
      d.datas.add(l.data_abate)
      map.set(l.lote, d)
    }
    const lotes = [...map.entries()].map(([lote, v]) => {
      const camPred = [...v.camaras.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      const datas = [...v.datas].sort()
      return { lote, cab: v.n, medio: v.n ? v.kg / v.n : 0, kg: v.kg, arr: v.arr, camPred, data: datas.length > 1 ? `${fmtDDMM(datas[0])}–${fmtDDMM(datas[datas.length - 1])}` : fmtDDMM(datas[0] ?? '') }
    }).sort((a, b) => b.medio - a.medio)
    const camaras = [...cam.entries()].map(([rotulo, valor]) => ({ rotulo: `Câm ${rotulo}`, valor })).sort((a, b) => a.rotulo.localeCompare(b.rotulo))
    return { lotes, camaras }
  }, [linhas])
  const maxCam = Math.max(1, ...camaras.map((c) => c.valor))
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 4 }}>Ocupação por câmara</div>
        <Barras dados={camaras} max={maxCam} cor={GOLD} />
        <Procedencia linhas={linhas.length} />
      </div>
      <div style={{ ...CARD, overflowX: 'auto' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 8 }}>{lotes.length} lotes · ranking por peso médio</div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: MUT, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>#</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Lote</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Cabeças</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Peso médio</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Carcaça (kg)</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Arrobas</th>
              <th style={{ textAlign: 'center', padding: '6px 8px' }}>Câmara</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Data</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l, i) => (
              <tr key={l.lote} style={{ borderTop: `0.5px solid ${LINE}`, color: ESP }}>
                <td style={{ padding: '6px 8px', color: MUT }}>{i + 1}</td>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{l.lote}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(l.cab)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(l.medio, 0)} kg</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(l.kg, 1)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtN(l.arr, 1)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>{l.camPred}</td>
                <td style={{ padding: '6px 8px' }}>{l.data}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Procedencia linhas={linhas.length} />
      </div>
    </div>
  )
}
