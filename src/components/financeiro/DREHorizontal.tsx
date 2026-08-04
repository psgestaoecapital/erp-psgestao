'use client'

// DRE Consolidado (Grupo).
// - resolve o grupo via fn_grupo_empresa (genérico), consolida os CNPJs;
// - SELETOR DE MESES clicável (◂ ano ▸ + Jan…Dez); clique = 1 mês, shift = intervalo;
// - intervalo > 1 mês → colunas = MESES (fn_psgc_dre_horizontal);
// - 1 mês (De = Até) → colunas = DIAS 1…31 (fn_psgc_dre_horizontal_dia), cada conta
//   com valor por dia; expandir conta-folha abre o detalhe por pessoa × dia (#813);
// - árvore colapsável; sticky; abreviado com valor cheio no title.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import Modal from '@/components/ui/Modal'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534'
const RED = '#A32D2D'
const CREAM = '#F2EBDF'

const MESES_LBL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

type Coluna = { key: string; label: string; projecao?: boolean }
type Linha = {
  ordem: number
  kind: 'grupo' | 'conta' | 'resultado' | 'fluxo'
  codigo: string
  nome: string
  grupo_ref?: string
  sinal: '+' | '-' | '±' | '='
  nivel: number
  colapsavel: boolean
  afeta_margem_bruta?: boolean
  afeta_margem_contribuicao?: boolean
  afeta_ebitda?: boolean
  valores: Record<string, number>
}
type Uni = { regime: string; empresas: number; modo: 'mes' | 'dia'; colunas: Coluna[]; linhas: Linha[]; saldoInicial?: number; diaNegativo?: string | null }

type RawLinha = Omit<Linha, 'valores'> & { valores_mes?: Record<string, number>; valores_dia?: Record<string, number> }
type MesRaw = { ym: string; label: string; projecao: boolean }
type DiaRaw = { d: number; ymd: string }

const pad2 = (n: number) => String(n).padStart(2, '0')
function abrev(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`
  if (a >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
const cheio = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function DREHorizontal() {
  const { sel, companyIds, selInfo, loading: loadingSel } = useCompanyIds()
  const now = useMemo(() => new Date(), [])
  const anoAtual = now.getFullYear()

  const [regime, setRegime] = useState<'competencia' | 'caixa' | 'previsto'>('competencia')
  const [diaDrill, setDiaDrill] = useState<string | null>(null) // previsto: ymd do dia clicado → títulos a vencer
  const [ano, setAno] = useState<number>(anoAtual)
  const [selIni, setSelIni] = useState<number>(1)                       // 1..12
  const [selFim, setSelFim] = useState<number>(now.getMonth() + 1)      // YTD por padrão
  const [colapsados, setColapsados] = useState<Set<string>>(new Set())
  const [tudoAberto, setTudoAberto] = useState(false)
  const [contaAberta, setContaAberta] = useState<string | null>(null)

  const [membros, setMembros] = useState<string[]>([])
  const [grupoNome, setGrupoNome] = useState<string>('')
  const [data, setData] = useState<Uni | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const umMes = selIni === selFim

  // Resolve o grupo da empresa selecionada (fonte única, genérica).
  const empresaUnica = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : null
  useEffect(() => {
    let alive = true
    if (empresaUnica) {
      void supabase.rpc('fn_grupo_empresa', { p_company_id: empresaUnica }).then(({ data: g, error }) => {
        if (!alive) return
        const r = g as { ok?: boolean; grupo_nome?: string; company_ids?: string[] } | null
        if (error || !r?.ok) { setMembros([empresaUnica]); setGrupoNome(selInfo.nome); return }
        setMembros(r.company_ids ?? [empresaUnica]); setGrupoNome(r.grupo_nome ?? selInfo.nome)
      })
    } else {
      setMembros(companyIds); setGrupoNome(selInfo.nome)
    }
    return () => { alive = false }
  }, [empresaUnica, companyIds, selInfo.nome])

  const carregar = useCallback(async () => {
    if (!membros.length) return
    setLoading(true); setErro(null)
    // Previsto (fluxo por vencimento) é sempre por DIA — mesmo se um intervalo estiver selecionado, usa o 1º mês.
    if (selIni === selFim || regime === 'previsto') {
      // 1 mês → DIAS no cabeçalho
      const { data: res, error } = await supabase.rpc('fn_psgc_dre_horizontal_dia', {
        p_company_ids: membros, p_ano: ano, p_mes: selIni, p_regime: regime,
      })
      const r = res as { ok?: boolean; erro?: string; regime: string; empresas: number; dias: DiaRaw[]; linhas: RawLinha[]; saldo_inicial?: number; dia_negativo?: string | null } | null
      if (error) { setErro(error.message); setData(null) }
      else if (!r || r.ok === false) { setErro(r?.erro || 'Sem acesso'); setData(null) }
      else setData({
        regime: r.regime, empresas: r.empresas, modo: 'dia',
        colunas: (r.dias ?? []).map((x) => ({ key: x.ymd, label: String(x.d) })),
        linhas: (r.linhas ?? []).map((l) => ({ ...l, valores: l.valores_dia ?? {} })),
        saldoInicial: r.saldo_inicial, diaNegativo: r.dia_negativo ?? null,
      })
    } else {
      // intervalo → MESES
      const { data: res, error } = await supabase.rpc('fn_psgc_dre_horizontal', {
        p_company_ids: membros, p_mes_ini: `${ano}-${pad2(selIni)}-01`, p_mes_fim: `${ano}-${pad2(selFim)}-01`, p_regime: regime,
      })
      const r = res as { ok?: boolean; erro?: string; regime: string; empresas: number; meses: MesRaw[]; linhas: RawLinha[] } | null
      if (error) { setErro(error.message); setData(null) }
      else if (!r || r.ok === false) { setErro(r?.erro || 'Sem acesso'); setData(null) }
      else setData({
        regime: r.regime, empresas: r.empresas, modo: 'mes',
        colunas: (r.meses ?? []).map((m) => ({ key: m.ym, label: m.label, projecao: m.projecao })),
        linhas: (r.linhas ?? []).map((l) => ({ ...l, valores: l.valores_mes ?? {} })),
      })
    }
    setLoading(false)
  }, [membros, ano, selIni, selFim, regime])

  useEffect(() => { void carregar() }, [carregar])

  useEffect(() => {
    if (!data) return
    setContaAberta(null)
    if (tudoAberto) { setColapsados(new Set()); return }
    setColapsados(new Set(data.linhas.filter((l) => l.kind === 'grupo').map((l) => l.codigo)))
  }, [data, tudoAberto])

  function toggleGrupo(codigo: string) {
    setColapsados((prev) => { const n = new Set(prev); if (n.has(codigo)) n.delete(codigo); else n.add(codigo); return n })
  }

  // Seletor de meses: clique = 1 mês; shift+clique = intervalo a partir do início atual.
  function clicaMes(m: number, shift: boolean) {
    if (shift) { const base = selIni; setSelIni(Math.min(base, m)); setSelFim(Math.max(base, m)) }
    else { setSelIni(m); setSelFim(m) }
  }
  const atalhoMes = () => { setAno(anoAtual); setSelIni(now.getMonth() + 1); setSelFim(now.getMonth() + 1) }
  const atalhoTri = () => { setSelIni(Math.max(1, selFim - 2)) }
  const atalhoAno = () => { setSelIni(1); setSelFim(12) }

  const colunas = useMemo(() => data?.colunas ?? [], [data])
  const linhasVisiveis = useMemo(() => {
    if (!data) return []
    return data.linhas.filter((l) => l.kind !== 'conta' || !colapsados.has(l.grupo_ref ?? ''))
  }, [data, colapsados])
  const totalLinha = useCallback((l: Linha) => colunas.reduce((s, c) => s + (l.valores[c.key] ?? 0), 0), [colunas])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Financeiro · Grupo</p>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 4px' }}>DRE Consolidado</h1>
        <p style={{ fontSize: 12, color: MUT, margin: '0 0 18px' }}>
          Escolha 1 mês (dias no cabeçalho) ou um intervalo (meses no cabeçalho), consolidando os CNPJs do grupo. Competência × Caixa.
        </p>

        {/* Controles: grupo + regime + seletor de meses */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <label style={lbl}>{membros.length > 1 ? 'Grupo' : 'Empresa'}</label>
            <div style={{ ...inp, minWidth: 190, display: 'flex', alignItems: 'center', gap: 6, background: CREAM, fontWeight: 700 }}>
              {grupoNome || '—'}{membros.length > 1 && <span style={{ fontWeight: 500, color: MUT }}>· {membros.length} CNPJs</span>}
            </div>
          </div>
          <div style={{ display: 'flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" onClick={() => setRegime('competencia')} style={regime === 'competencia' ? segOn : segOff}>Competência</button>
            <button type="button" onClick={() => setRegime('caixa')} style={regime === 'caixa' ? segOn : segOff}>Caixa</button>
            <button type="button" onClick={() => { setRegime('previsto'); setSelFim(selIni) }} style={regime === 'previsto' ? segOn : segOff} title="Fluxo de caixa por vencimento (previsão)">Previsto</button>
          </div>
          <button type="button" onClick={() => setTudoAberto((v) => !v)} style={btnSec}>
            {tudoAberto ? '▾ Recolher tudo' : '▸ Expandir tudo'}
          </button>
          {data && <span style={{ fontSize: 11, color: MUT, marginLeft: 'auto' }}>{data.empresas} empresa(s) · {data.modo === 'dia' ? 'diário' : 'mensal'} · {data.regime}</span>}
        </div>

        {/* Seletor de ano + meses clicável */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" onClick={() => setAno((a) => Math.max(2024, a - 1))} style={navBtn} aria-label="Ano anterior">◂</button>
            <span style={{ fontSize: 15, fontWeight: 800, color: ESP, minWidth: 52, textAlign: 'center' }}>{ano}</span>
            <button type="button" onClick={() => setAno((a) => Math.min(anoAtual + 1, a + 1))} style={navBtn} aria-label="Próximo ano">▸</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, flex: 1, minWidth: 260 }}>
            {MESES_LBL.map((lbl_, i) => {
              const m = i + 1
              const ativo = m >= selIni && m <= selFim
              return (
                <button key={m} type="button"
                  onClick={(e) => clicaMes(m, e.shiftKey)}
                  title="Clique = 1 mês · Shift+clique = intervalo"
                  style={{ ...mesBtn, ...(ativo ? mesBtnOn : null) }}>
                  {lbl_}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={atalhoMes} style={chip}>Mês atual</button>
            <button type="button" onClick={atalhoTri} style={chip}>Trimestre</button>
            <button type="button" onClick={atalhoAno} style={chip}>Ano</button>
          </div>
        </div>

        {erro && <div style={{ background: '#FCEBEB', color: RED, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

        {/* PREVISTO · fluxo de caixa: saldo inicial + alerta de dia negativo (mesma lógica da projeção) */}
        {data && data.regime === 'previsto' && (
          <div style={{ marginBottom: 12 }}>
            {data.diaNegativo && (
              <div style={{ background: '#FCEBEB', color: RED, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                ⚠️ Caixa do grupo fica negativo em {data.diaNegativo.slice(8, 10)}/{data.diaNegativo.slice(5, 7)}.
              </div>
            )}
            <div style={{ background: CREAM, color: ESP, padding: '8px 14px', borderRadius: 8, fontSize: 12 }}>
              Previsão por <b>vencimento</b> (não é resultado — é fluxo de caixa). Saldo inicial ={' '}
              <b>{cheio(data.saldoInicial ?? 0)}</b> (saldo atual dos bancos do grupo)
              {(data.saldoInicial ?? 0) === 0 && <span style={{ color: MUT }}> · nenhum saldo bancário cadastrado — a projeção parte de zero</span>}. Clique num <b>dia</b> pra ver os títulos a vencer.
            </div>
          </div>
        )}

        {loading || loadingSel ? (
          <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: MUT }}>Carregando DRE…</div>
        ) : !data || data.linhas.length === 0 ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '32px 20px', textAlign: 'center', color: MUT, fontSize: 13 }}>
            Sem DRE para o grupo/período. Ajuste o período ou verifique se o grupo tem empresas com dados (2024+).
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 10, background: '#FFF' }}>
            {/* w-full: ocupa a largura toda (sem faixa vazia à direita); minWidth garante scroll só quando não couber (RD-41) */}
            <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...thConta, position: 'sticky', left: 0, zIndex: 3, background: CREAM }}>
                    {data.modo === 'dia' ? `Conta · ${MESES_LBL[selIni - 1]}/${ano} (dias)` : 'Conta'}
                  </th>
                  {colunas.map((c) => {
                    const drillDia = data.regime === 'previsto'
                    return (
                      <th key={c.key}
                        onClick={drillDia ? () => setDiaDrill(c.key) : undefined}
                        title={drillDia ? 'Ver títulos a vencer neste dia' : undefined}
                        style={{ ...thMes, ...(c.projecao ? projStyle : null), ...(data.modo === 'dia' ? thDiaCol : null), ...(drillDia ? { cursor: 'pointer', textDecoration: 'underline', textDecorationColor: MUT } : null) }}>
                        {c.label}
                        {c.projecao && <div style={{ fontSize: 8, fontWeight: 700, color: GOLD, letterSpacing: 0.5 }}>PROJ.</div>}
                      </th>
                    )
                  })}
                  <th style={{ ...thMes, borderLeft: `2px solid ${LINE}`, background: CREAM }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.map((l) => {
                  const isRes = l.kind === 'resultado'
                  const isGrp = l.kind === 'grupo'
                  const isConta = l.kind === 'conta'
                  const bold = isRes || isGrp
                  // Previsto: linhas de ENTRADA (grupo/conta) verdes, de SAÍDA vermelhas (via grupo_ref);
                  // Movimento/Saldo (resultado) coloridos por sinal.
                  const isPrevisto = data.regime === 'previsto'
                  const prevEnt = isPrevisto && (l.codigo === 'PREV_ENT' || l.grupo_ref === 'PREV_ENT')
                  const prevSai = isPrevisto && (l.codigo === 'PREV_SAI' || l.grupo_ref === 'PREV_SAI')
                  const total = totalLinha(l)
                  // SALDO é acumulado → o "Total" do mês é o SALDO do ÚLTIMO dia (saldo final projetado),
                  // não a soma dos saldos diários. Entradas/Saídas/Movimento: a soma faz sentido.
                  const totalDisplay = isPrevisto && l.codigo === 'SALDO'
                    ? (colunas.length ? (l.valores[colunas[colunas.length - 1].key] ?? 0) : 0)
                    : total
                  const corTotal = prevEnt ? (totalDisplay > 0 ? GREEN : MUT)
                    : prevSai ? (totalDisplay > 0 ? RED : MUT)
                    : isRes ? (totalDisplay < 0 ? RED : totalDisplay > 0 ? GREEN : MUT)
                    : ESP
                  const contaDrillavel = isConta && umMes            // folha + 1 mês → drill por pessoa
                  const aberta = contaDrillavel && contaAberta === l.codigo
                  return (
                    <Fragment key={`${l.kind}-${l.codigo}-${l.ordem}`}>
                    <tr style={{ borderTop: `0.5px solid ${LINE}`, background: isRes || aberta ? '#FBF7EF' : '#FFF' }}>
                      <td style={{
                        ...tdConta, position: 'sticky', left: 0, zIndex: 2,
                        background: isRes || aberta ? '#FBF7EF' : '#FFF',
                        paddingLeft: 12 + l.nivel * 18, fontWeight: bold ? 700 : 500, color: ESP,
                        cursor: contaDrillavel ? 'pointer' : 'default',
                      }} onClick={contaDrillavel ? () => setContaAberta(aberta ? null : l.codigo) : undefined}>
                        {l.colapsavel ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggleGrupo(l.codigo) }} style={caret} aria-label="expandir/recolher">
                            {colapsados.has(l.codigo) ? '▸' : '▾'}
                          </button>
                        ) : contaDrillavel ? (
                          <span style={{ ...caret, display: 'inline-block' }} aria-hidden>{aberta ? '▾' : '▸'}</span>
                        ) : <span style={{ display: 'inline-block', width: 16 }} />}
                        {l.nome}
                      </td>
                      {colunas.map((c) => {
                        const v = l.valores[c.key]
                        // entradas verdes, saídas vermelhas (previsto); resultado por sinal; demais espresso.
                        // dia em que o SALDO acumulado fica negativo → célula com fundo vermelho (alerta visual).
                        const corCel = v == null ? ESP
                          : prevEnt ? (v > 0 ? GREEN : MUT)
                          : prevSai ? (v > 0 ? RED : MUT)
                          : isRes ? (v < 0 ? RED : v > 0 ? GREEN : MUT)
                          : ESP
                        const saldoNeg = isPrevisto && l.codigo === 'SALDO' && v != null && v < 0
                        return (
                          <td key={c.key} title={v != null ? cheio(v) : ''} style={{
                            ...tdVal, ...(data.modo === 'dia' ? tdDiaCol : null),
                            ...(c.projecao ? { background: isRes ? '#FBF4E6' : '#FDFAF3' } : null),
                            ...(saldoNeg ? { background: '#FCEBEB' } : null),
                            fontWeight: bold ? 700 : 400,
                            color: corCel,
                          }}>
                            {v != null ? abrev(v) : ''}
                          </td>
                        )
                      })}
                      <td title={cheio(totalDisplay)} style={{
                        ...tdVal, borderLeft: `2px solid ${LINE}`, background: isRes ? '#FBF4E6' : CREAM,
                        fontWeight: 700, color: corTotal,
                      }}>
                        {abrev(totalDisplay)}
                      </td>
                    </tr>
                    {/* Drill como LINHAS da MESMA tabela (mesmas colunas do topo) → dia N sempre sob dia N. */}
                    {aberta && (
                      <DrillDiario membros={membros} codigo={l.codigo} nome={l.nome} ano={ano} mes={selIni} regime={regime} colunas={colunas} />
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 11, color: MUT, margin: '12px 2px 0', fontStyle: 'italic' }}>
          Valores abreviados (toque/hover mostra o valor cheio).
          {data?.regime === 'previsto'
            ? <> <b>Previsto</b> = fluxo de caixa por <b>vencimento</b> (entradas − saídas → saldo acumulado). Não é DRE: previsão não tem lucro/EBITDA, tem <b>quanto vou ter em caixa</b>. Clique num <b>dia</b> (cabeçalho) pra ver os títulos a vencer.</>
            : umMes
            ? <> Sinais já aplicados: receitas somam, deduções/custos/despesas subtraem. Mostrando <b>{MESES_LBL[selIni - 1]}/{ano} por dia</b> — clique numa conta pra ver <b>clientes/fornecedores × dia</b>. A soma dos dias = o total da conta no mês.</>
            : <> Sinais já aplicados: receitas somam, deduções/custos/despesas subtraem. Intervalo com <b>meses</b> no cabeçalho. Clique <b>1 mês só</b> (ou use “Mês atual”) pra ver o diário.</>}
        </p>

        {/* PREVISTO · drill por dia: quem vou receber / quem vou pagar naquele vencimento (Parte B.3) */}
        <Modal open={!!diaDrill} onClose={() => setDiaDrill(null)}
          title="Títulos a vencer no dia"
          subtitle={diaDrill ? `${diaDrill.slice(8, 10)}/${diaDrill.slice(5, 7)}/${diaDrill.slice(0, 4)} · ${grupoNome}` : ''}
          maxWidth={620}>
          {diaDrill && <DiaPrevistoDrill membros={membros} ymd={diaDrill} />}
        </Modal>
      </div>
    </div>
  )
}

// ── Modo Diário: grade dias × pessoa (cliente/fornecedor) de uma conta (#813) ──
type DiarioPessoa = { pessoa_id: string | null; pessoa_nome: string; valores_dia: Record<string, number>; total: number }
type DiarioResult = { ok: boolean; erro?: string; is_receita: boolean; ano: number; mes: number; regime: string; dias_no_mes: number; dre_mes: number | null; total: number; pessoas: DiarioPessoa[] }

// Drill = LINHAS (<tr>) da MESMA tabela do topo. Recebe `colunas` do pai e usa a MESMA chave (ymd) por
// coluna → a coluna do dia N do detalhe fica exatamente sob a coluna do dia N do cabeçalho e do
// totalizador (impossível divergir, pois é uma tabela só). Régua de dias continua só no topo (#867).
function DrillDiario({ membros, codigo, nome, ano, mes, regime, colunas }: {
  membros: string[]; codigo: string; nome: string; ano: number; mes: number; regime: string; colunas: Coluna[]
}) {
  const [d, setD] = useState<DiarioResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const nCols = colunas.length + 2 // 1 rótulo + N dias + 1 total

  useEffect(() => {
    let alive = true
    setLoading(true); setErro(null)
    void supabase.rpc('fn_psgc_dre_diario', {
      p_company_ids: membros, p_psgc_codigo: codigo, p_ano: ano, p_mes: mes, p_regime: regime,
    }).then(({ data, error }) => {
      if (!alive) return
      const r = data as DiarioResult | null
      if (error) setErro(error.message)
      else if (r && r.ok === false) setErro(r.erro || 'erro')
      else setD(r)
      setLoading(false)
    })
    return () => { alive = false }
  }, [membros, codigo, ano, mes, regime])

  const msgRow = (texto: string, cor: string) => (
    <tr><td colSpan={nCols} style={{ padding: '10px 12px', fontSize: 12, color: cor, background: '#FCFAF5' }}>{texto}</td></tr>
  )
  if (loading) return msgRow('Carregando diário…', MUT)
  if (erro) return msgRow(erro, RED)
  if (!d || d.pessoas.length === 0) return msgRow('Sem lançamentos classificados nesta conta no mês.', MUT)

  const rotulo = d.is_receita ? 'Cliente' : 'Fornecedor'
  const ehPrevisto = d.regime === 'previsto'
  const diff = d.dre_mes == null ? 0 : Math.round((d.total - d.dre_mes) * 100) / 100
  const subtotalDia = (key: string) => d.pessoas.reduce((s, p) => s + (p.valores_dia[key] ?? 0), 0)
  const labelPad = 12 + 2 * 18 // recuo do detalhe (abaixo de grupo/conta)

  return (
    <>
      {/* legenda do drill — linha full-width (não é dia-alinhada) */}
      <tr style={{ background: '#FBF7EF' }}>
        <td colSpan={nCols} style={{ padding: '6px 12px', fontSize: 11, color: MUT, position: 'sticky', left: 0 }}>
          {rotulo}s por dia · <b style={{ color: ESP }}>{nome}</b> · total <b style={{ color: ESP }}>{cheio(d.total)}</b>
          {ehPrevisto
            ? <span style={{ color: MUT, marginLeft: 6 }}>· a vencer (previsão de fluxo, por vencimento)</span>
            : Math.abs(diff) < 0.01
            ? <span style={{ color: GREEN, marginLeft: 6, fontWeight: 700 }}>✓ fecha com o DRE</span>
            : <span style={{ color: RED, marginLeft: 6, fontWeight: 700 }}>⚠ difere do DRE ({cheio(d.dre_mes ?? 0)}) em {cheio(diff)} — há título fora do de-para</span>}
        </td>
      </tr>
      {/* cliente/fornecedor × dia — MESMAS colunas do topo */}
      {d.pessoas.map((p, i) => (
        <tr key={p.pessoa_id ?? `x${i}`} style={{ borderTop: `0.5px solid ${LINE}`, background: '#FCFAF5' }}>
          <td style={{ ...tdConta, position: 'sticky', left: 0, zIndex: 2, background: '#FCFAF5', paddingLeft: labelPad, color: ESP, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }} title={p.pessoa_nome}>
            {p.pessoa_nome}
          </td>
          {colunas.map((c) => {
            const v = p.valores_dia[c.key]
            return <td key={c.key} title={v != null ? cheio(v) : ''} style={{ ...tdVal, ...tdDiaCol, color: ESP }}>{v != null ? abrev(v) : ''}</td>
          })}
          <td title={cheio(p.total)} style={{ ...tdVal, borderLeft: `2px solid ${LINE}`, background: CREAM, fontWeight: 700 }}>{abrev(p.total)}</td>
        </tr>
      ))}
      {/* subtotal do dia — também dia-alinhado */}
      <tr style={{ borderTop: `1.5px solid ${LINE}`, background: '#FBF7EF' }}>
        <td style={{ ...tdConta, position: 'sticky', left: 0, zIndex: 2, background: '#FBF7EF', paddingLeft: labelPad, fontWeight: 700, color: ESP }}>Subtotal do dia</td>
        {colunas.map((c) => { const s = subtotalDia(c.key); return <td key={c.key} title={s ? cheio(s) : ''} style={{ ...tdVal, ...tdDiaCol, fontWeight: 700, color: ESP }}>{s ? abrev(s) : ''}</td> })}
        <td style={{ ...tdVal, borderLeft: `2px solid ${LINE}`, background: CREAM, fontWeight: 800, color: ESP }}>{abrev(d.total)}</td>
      </tr>
    </>
  )
}

// ── Previsto · títulos a vencer num dia (receber/pagar) — lê pela RLS do usuário (empresas do grupo).
// RD-26: sem RPC nova de fluxo; consulta direta às tabelas (mesmo padrão do "ver conta existente").
type TituloDia = { id: string; nome: string; valor: number; descricao: string | null; doc: string | null }

function DiaPrevistoDrill({ membros, ymd }: { membros: string[]; ymd: string }) {
  const [receber, setReceber] = useState<TituloDia[]>([])
  const [pagar, setPagar] = useState<TituloDia[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    const abertoR = (s: unknown) => !['pago', 'recebido', 'cancelado'].includes(String(s ?? '').toLowerCase())
    const abertoP = (s: unknown) => !['pago', 'cancelado'].includes(String(s ?? '').toLowerCase())
    const map = (arr: Array<Record<string, unknown>> | null, campoNome: string): TituloDia[] =>
      (arr ?? []).map((x) => ({
        id: String(x.id), nome: (x[campoNome] as string) || 'sem nome', valor: Number(x.valor) || 0,
        descricao: (x.descricao as string) ?? null, doc: (x.numero_documento as string) ?? null,
      }))
    void Promise.all([
      supabase.from('erp_receber').select('id, cliente_nome, valor, descricao, numero_documento, status').in('company_id', membros).eq('data_vencimento', ymd),
      supabase.from('erp_pagar').select('id, fornecedor_nome, valor, descricao, numero_documento, status').in('company_id', membros).eq('data_vencimento', ymd),
    ]).then(([r1, r2]) => {
      if (!alive) return
      setReceber(map((r1.data as Array<Record<string, unknown>>)?.filter((x) => abertoR(x.status)) ?? null, 'cliente_nome'))
      setPagar(map((r2.data as Array<Record<string, unknown>>)?.filter((x) => abertoP(x.status)) ?? null, 'fornecedor_nome'))
      setLoading(false)
    })
    return () => { alive = false }
  }, [membros, ymd])

  if (loading) return <div style={{ fontSize: 12, color: MUT }}>Carregando…</div>
  const totR = receber.reduce((s, x) => s + x.valor, 0)
  const totP = pagar.reduce((s, x) => s + x.valor, 0)

  return (
    <div>
      <SecaoDia titulo="A receber (entradas)" cor={GREEN} total={totR} itens={receber} vazio="Nenhum título a receber neste dia." />
      <div style={{ height: 14 }} />
      <SecaoDia titulo="A pagar (saídas)" cor={RED} total={totP} itens={pagar} vazio="Nenhum título a pagar neste dia." />
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, color: ESP }}>
        <span>Movimento do dia</span>
        <span style={{ color: totR - totP < 0 ? RED : GREEN }}>{cheio(totR - totP)}</span>
      </div>
    </div>
  )
}

function SecaoDia({ titulo, cor, total, itens, vazio }: { titulo: string; cor: string; total: number; itens: TituloDia[]; vazio: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: cor }}>{titulo}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: cor }}>{cheio(total)}</span>
      </div>
      {itens.length === 0 ? (
        <div style={{ fontSize: 12, color: MUT }}>{vazio}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {itens.map((x) => (
            <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: ESP, borderBottom: `0.5px solid ${LINE}`, paddingBottom: 4 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b>{x.nome}</b>{x.descricao ? <span style={{ color: MUT }}> · {x.descricao}</span> : ''}{x.doc ? <span style={{ color: MUT }}> · {x.doc}</span> : ''}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 600 }}>{cheio(x.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const segOn: React.CSSProperties = { padding: '9px 14px', background: GOLD, color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
const segOff: React.CSSProperties = { padding: '9px 14px', background: '#FFF', color: MUT, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnSec: React.CSSProperties = { padding: '9px 14px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const navBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 6, border: `1px solid ${LINE}`, background: '#FFF', color: ESP, fontSize: 15, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }
const mesBtn: React.CSSProperties = { padding: '7px 4px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#FFF', color: MUT, fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const mesBtnOn: React.CSSProperties = { background: GOLD, color: '#fff', borderColor: GOLD, fontWeight: 800 }
const chip: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, border: `1px solid ${LINE}`, background: 'transparent', color: ESP, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
// width:1% + nowrap = coluna CONTA encolhe pro conteúdo; a sobra vai pras colunas de dia/mês (distribuem e preenchem)
const thConta: React.CSSProperties = { position: 'sticky', top: 0, textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, minWidth: 240, width: '1%', whiteSpace: 'nowrap' }
const thMes: React.CSSProperties = { position: 'sticky', top: 0, textAlign: 'right', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: ESP, background: CREAM, whiteSpace: 'nowrap', minWidth: 78 }
const thDiaCol: React.CSSProperties = { minWidth: 46, padding: '8px 7px' }
const projStyle: React.CSSProperties = { fontStyle: 'italic', color: '#8A6A1E' }
const tdConta: React.CSSProperties = { padding: '8px 12px', whiteSpace: 'nowrap', minWidth: 240, width: '1%' }
const tdVal: React.CSSProperties = { padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const tdDiaCol: React.CSSProperties = { padding: '8px 7px', minWidth: 46 }
const caret: React.CSSProperties = { width: 16, marginRight: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: GOLD, fontSize: 11, padding: 0 }
// Parte C (#867) + alinhamento do drill: o detalhe (cliente/fornecedor × dia) usa as MESMAS colunas
// da tabela do topo (tdConta/tdVal/tdDiaCol) — régua de dias só no topo, e cada dia N sob o dia N.
