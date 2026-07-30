'use client'

// DRE Horizontal Consolidado (Grupo) — F1.
// - resolve o grupo da empresa via fn_grupo_empresa (genérico), consolida os CNPJs;
// - meses nas colunas (sticky header) + conta em árvore (sticky 1ª coluna);
// - linhas colapsáveis por grupo do DRE; subtotais/resultado em negrito;
// - projeção (meses futuros) marcada; toggle Competência × Caixa;
// - números abreviados (R$ 31,5 mi) com valor cheio no title.
// Drill cliente/fornecedor = F2; coluna por CNPJ + export = F3.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534'
const RED = '#A32D2D'
const CREAM = '#F2EBDF'

type Mes = { ym: string; ano: number; mes: number; label: string; projecao: boolean }
type Linha = {
  ordem: number
  kind: 'grupo' | 'conta' | 'resultado'
  codigo: string
  nome: string
  grupo_ref?: string
  sinal: '+' | '-' | '±' | '='
  nivel: number
  colapsavel: boolean
  afeta_margem_bruta?: boolean
  afeta_margem_contribuicao?: boolean
  afeta_ebitda?: boolean
  valores_mes: Record<string, number>
}
type DreResult = { ok: boolean; erro?: string; regime: string; empresas: number; meses: Mes[]; linhas: Linha[] }

// primeiro dia do mês, deslocado por n meses
const monthShift = (n: number) => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}
const toYM = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const ymToDate = (ym: string) => `${ym}-01`

// R$ abreviado: 31,5 mi · 812,3 mil · 940 — com valor cheio no title
function abrev(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`
  if (a >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
const cheio = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function DREHorizontal() {
  const { sel, companyIds, selInfo, loading: loadingSel } = useCompanyIds()

  const [regime, setRegime] = useState<'competencia' | 'caixa'>('competencia')
  const [mesIni, setMesIni] = useState<string>(toYM(monthShift(-11))) // 12 realizados
  const [mesFim, setMesFim] = useState<string>(toYM(monthShift(6)))   // + projeção
  const [colapsados, setColapsados] = useState<Set<string>>(new Set())
  const [tudoAberto, setTudoAberto] = useState(false)
  const [contaAberta, setContaAberta] = useState<string | null>(null) // drill diário (1 mês)

  // Modo Diário só quando 1 mês está filtrado (mês_ini = mês_fim). Aí expandir uma
  // conta-folha abre a grade de dias × pessoa (cliente/fornecedor).
  const umMes = mesIni === mesFim
  const drillAno = Number(mesIni.slice(0, 4))
  const drillMes = Number(mesIni.slice(5, 7))

  const [membros, setMembros] = useState<string[]>([])
  const [grupoNome, setGrupoNome] = useState<string>('')
  const [data, setData] = useState<DreResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Resolve o grupo da empresa selecionada via fn_grupo_empresa (fonte única,
  // genérica). Se a seleção global for consolidado/grupo (sem 1 empresa), usa
  // os companyIds já resolvidos pelo seletor. Nunca hardcode de empresa.
  const empresaUnica = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : null
  useEffect(() => {
    let alive = true
    if (empresaUnica) {
      void supabase.rpc('fn_grupo_empresa', { p_company_id: empresaUnica }).then(({ data: g, error }) => {
        if (!alive) return
        const r = g as { ok?: boolean; grupo_nome?: string; company_ids?: string[] } | null
        if (error || !r?.ok) { setMembros(empresaUnica ? [empresaUnica] : []); setGrupoNome(selInfo.nome); return }
        setMembros(r.company_ids ?? [empresaUnica])
        setGrupoNome(r.grupo_nome ?? selInfo.nome)
      })
    } else {
      setMembros(companyIds)
      setGrupoNome(selInfo.nome)
    }
    return () => { alive = false }
  }, [empresaUnica, companyIds, selInfo.nome])

  const carregar = useCallback(async () => {
    if (!membros.length) return
    setLoading(true); setErro(null)
    const { data: res, error } = await supabase.rpc('fn_psgc_dre_horizontal', {
      p_company_ids: membros,
      p_mes_ini: ymToDate(mesIni),
      p_mes_fim: ymToDate(mesFim),
      p_regime: regime,
    })
    const r = res as DreResult | null
    if (error) { setErro(error.message); setData(null) }
    else if (r && r.ok === false) { setErro(r.erro || 'Sem acesso'); setData(null) }
    else setData(r)
    setLoading(false)
  }, [membros, mesIni, mesFim, regime])

  useEffect(() => { void carregar() }, [carregar])

  // colapso: por padrão todos os grupos recolhidos (mostra a espinha do DRE)
  useEffect(() => {
    if (!data) return
    setContaAberta(null) // novo período/regime → fecha o drill diário aberto
    if (tudoAberto) { setColapsados(new Set()); return }
    setColapsados(new Set(data.linhas.filter((l) => l.kind === 'grupo').map((l) => l.codigo)))
  }, [data, tudoAberto])

  function toggleGrupo(codigo: string) {
    setColapsados((prev) => {
      const n = new Set(prev)
      if (n.has(codigo)) n.delete(codigo); else n.add(codigo)
      return n
    })
  }

  const meses = useMemo(() => data?.meses ?? [], [data])
  const linhasVisiveis = useMemo(() => {
    if (!data) return []
    return data.linhas.filter((l) => l.kind !== 'conta' || !colapsados.has(l.grupo_ref ?? ''))
  }, [data, colapsados])

  // total por linha (soma dos meses do range)
  const totalLinha = useCallback((l: Linha) => meses.reduce((s, m) => s + (l.valores_mes[m.ym] ?? 0), 0), [meses])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Financeiro · Grupo</p>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 4px' }}>DRE Horizontal Consolidado</h1>
        <p style={{ fontSize: 12, color: MUT, margin: '0 0 18px' }}>
          Demonstrativo gerencial com meses no cabeçalho, consolidando os CNPJs do grupo. Competência × Caixa · projeção marcada.
        </p>

        {/* Controles */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <label style={lbl}>{membros.length > 1 ? 'Grupo' : 'Empresa'}</label>
            <div style={{ ...inp, minWidth: 200, display: 'flex', alignItems: 'center', gap: 6, background: CREAM, fontWeight: 700 }}>
              {grupoNome || '—'}{membros.length > 1 && <span style={{ fontWeight: 500, color: MUT }}>· {membros.length} CNPJs</span>}
            </div>
          </div>
          <div>
            <label style={lbl}>De</label>
            <input type="month" value={mesIni} onChange={(e) => setMesIni(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>Até</label>
            <input type="month" value={mesFim} onChange={(e) => setMesFim(e.target.value)} style={inp} />
          </div>
          <div style={{ display: 'flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" onClick={() => setRegime('competencia')} style={regime === 'competencia' ? segOn : segOff}>Competência</button>
            <button type="button" onClick={() => setRegime('caixa')} style={regime === 'caixa' ? segOn : segOff}>Caixa</button>
          </div>
          <button type="button" onClick={() => setTudoAberto((v) => !v)} style={btnSec}>
            {tudoAberto ? '▾ Recolher tudo' : '▸ Expandir tudo'}
          </button>
          {data && <span style={{ fontSize: 11, color: MUT, marginLeft: 'auto' }}>{data.empresas} empresa(s) · regime {data.regime}</span>}
        </div>

        {erro && <div style={{ background: '#FCEBEB', color: RED, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

        {loading || loadingSel ? (
          <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: MUT }}>Carregando DRE…</div>
        ) : !data || data.linhas.length === 0 ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '32px 20px', textAlign: 'center', color: MUT, fontSize: 13 }}>
            Sem DRE calculado para o grupo/período. Ajuste o intervalo ou verifique se o grupo tem empresas com dados (2024+).
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 10, background: '#FFF' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...thConta, position: 'sticky', left: 0, zIndex: 3, background: CREAM }}>Conta</th>
                  {meses.map((m) => (
                    <th key={m.ym} style={{ ...thMes, ...(m.projecao ? projStyle : null) }}>
                      {m.label}
                      {m.projecao && <div style={{ fontSize: 8, fontWeight: 700, color: GOLD, letterSpacing: 0.5 }}>PROJ.</div>}
                    </th>
                  ))}
                  <th style={{ ...thMes, borderLeft: `2px solid ${LINE}`, background: CREAM }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.map((l) => {
                  const isRes = l.kind === 'resultado'
                  const isGrp = l.kind === 'grupo'
                  const isConta = l.kind === 'conta'
                  const bold = isRes || isGrp
                  const total = totalLinha(l)
                  const contaDrillavel = isConta && umMes            // folha + 1 mês → drill diário
                  const aberta = contaDrillavel && contaAberta === l.codigo
                  return (
                    <Fragment key={`${l.kind}-${l.codigo}-${l.ordem}`}>
                    <tr style={{ borderTop: `0.5px solid ${LINE}`, background: isRes ? '#FBF7EF' : aberta ? '#FBF7EF' : '#FFF' }}>
                      <td style={{
                        ...tdConta, position: 'sticky', left: 0, zIndex: 2,
                        background: isRes ? '#FBF7EF' : aberta ? '#FBF7EF' : '#FFF',
                        paddingLeft: 12 + l.nivel * 18,
                        fontWeight: bold ? 700 : 500,
                        color: ESP,
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
                      {meses.map((m) => {
                        const v = l.valores_mes[m.ym]
                        return (
                          <td key={m.ym} title={v != null ? cheio(v) : ''} style={{
                            ...tdVal,
                            ...(m.projecao ? { background: isRes ? '#FBF4E6' : '#FDFAF3' } : null),
                            fontWeight: bold ? 700 : 400,
                            color: isRes ? (v != null && v < 0 ? RED : v != null && v > 0 ? GREEN : MUT) : ESP,
                          }}>
                            {v != null ? abrev(v) : ''}
                          </td>
                        )
                      })}
                      <td title={cheio(total)} style={{
                        ...tdVal, borderLeft: `2px solid ${LINE}`, background: isRes ? '#FBF4E6' : CREAM,
                        fontWeight: 700,
                        color: isRes ? (total < 0 ? RED : total > 0 ? GREEN : MUT) : ESP,
                      }}>
                        {abrev(total)}
                      </td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={meses.length + 2} style={{ padding: 0, background: BG }}>
                          <DrillDiario membros={membros} codigo={l.codigo} nome={l.nome} ano={drillAno} mes={drillMes} regime={regime} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 11, color: MUT, margin: '12px 2px 0', fontStyle: 'italic' }}>
          Valores abreviados (toque/hover mostra o valor cheio). Sinais já aplicados: receitas somam, deduções/custos/despesas subtraem.
          Meses marcados <b style={{ color: GOLD }}>PROJ.</b> são projeção (títulos com vencimento futuro). Verde/vermelho só nas linhas de resultado.
          {umMes
            ? <> Com <b>1 mês</b> filtrado, clique numa conta pra abrir o <b>Modo Diário</b> (dias × cliente/fornecedor).</>
            : <> Filtre <b>1 mês só</b> (De = Até) pra habilitar o Modo Diário por conta.</>}
        </p>
      </div>
    </div>
  )
}

// ── Modo Diário: grade dias × pessoa (cliente/fornecedor) de uma conta ──────
type DiarioPessoa = { pessoa_id: string | null; pessoa_nome: string; valores_dia: Record<string, number>; total: number }
type DiarioResult = { ok: boolean; erro?: string; is_receita: boolean; ano: number; mes: number; regime: string; dias_no_mes: number; dre_mes: number; total: number; pessoas: DiarioPessoa[] }

function DrillDiario({ membros, codigo, nome, ano, mes, regime }: {
  membros: string[]; codigo: string; nome: string; ano: number; mes: number; regime: string
}) {
  const [d, setD] = useState<DiarioResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

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

  if (loading) return <div style={{ padding: 12, fontSize: 12, color: MUT }}>Carregando diário…</div>
  if (erro) return <div style={{ padding: 12, fontSize: 12, color: RED }}>{erro}</div>
  if (!d || d.pessoas.length === 0) return <div style={{ padding: 12, fontSize: 12, color: MUT }}>Sem lançamentos classificados nesta conta no mês.</div>

  const dias = Array.from({ length: d.dias_no_mes }, (_, i) => i + 1)
  const ymd = (dia: number) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  const rotulo = d.is_receita ? 'Cliente' : 'Fornecedor'
  const subtotalDia = (dia: number) => d.pessoas.reduce((s, p) => s + (p.valores_dia[ymd(dia)] ?? 0), 0)
  const diff = Math.round((d.total - d.dre_mes) * 100) / 100

  return (
    <div style={{ padding: '8px 8px 12px' }}>
      <div style={{ fontSize: 11, color: MUT, marginBottom: 6 }}>
        {rotulo}s por dia · <b style={{ color: ESP }}>{nome}</b> · total <b style={{ color: ESP }}>{cheio(d.total)}</b>
        {Math.abs(diff) < 0.01
          ? <span style={{ color: GREEN, marginLeft: 6, fontWeight: 700 }}>✓ fecha com o DRE</span>
          : <span style={{ color: RED, marginLeft: 6, fontWeight: 700 }}>⚠ difere do DRE ({cheio(d.dre_mes)}) em {cheio(diff)} — há título fora do de-para</span>}
      </div>
      <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8, background: '#FFF' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr>
              <th style={thDiaPessoa}>{rotulo}</th>
              {dias.map((dia) => <th key={dia} style={thDia}>{dia}</th>)}
              <th style={{ ...thDia, borderLeft: `2px solid ${LINE}` }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {d.pessoas.map((p, i) => (
              <tr key={p.pessoa_id ?? `x${i}`} style={{ borderTop: `0.5px solid ${LINE}` }}>
                <td style={tdPessoa} title={p.pessoa_nome}>{p.pessoa_nome}</td>
                {dias.map((dia) => {
                  const v = p.valores_dia[ymd(dia)]
                  return <td key={dia} title={v != null ? cheio(v) : ''} style={tdDia}>{v != null ? abrev(v) : ''}</td>
                })}
                <td title={cheio(p.total)} style={{ ...tdDia, borderLeft: `2px solid ${LINE}`, background: CREAM, fontWeight: 700 }}>{abrev(p.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `1.5px solid ${LINE}`, background: '#FBF7EF' }}>
              <td style={{ ...tdPessoa, fontWeight: 700, background: '#FBF7EF' }}>Subtotal do dia</td>
              {dias.map((dia) => { const s = subtotalDia(dia); return <td key={dia} title={s ? cheio(s) : ''} style={{ ...tdDia, fontWeight: 700 }}>{s ? abrev(s) : ''}</td> })}
              <td style={{ ...tdDia, borderLeft: `2px solid ${LINE}`, background: CREAM, fontWeight: 800 }}>{abrev(d.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const segOn: React.CSSProperties = { padding: '9px 14px', background: GOLD, color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
const segOff: React.CSSProperties = { padding: '9px 14px', background: '#FFF', color: MUT, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnSec: React.CSSProperties = { padding: '9px 14px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const thConta: React.CSSProperties = { position: 'sticky', top: 0, textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, minWidth: 240 }
const thMes: React.CSSProperties = { position: 'sticky', top: 0, textAlign: 'right', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: ESP, background: CREAM, whiteSpace: 'nowrap', minWidth: 78 }
const projStyle: React.CSSProperties = { fontStyle: 'italic', color: '#8A6A1E' }
const tdConta: React.CSSProperties = { padding: '8px 12px', whiteSpace: 'nowrap', minWidth: 240 }
const tdVal: React.CSSProperties = { padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const caret: React.CSSProperties = { width: 16, marginRight: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: GOLD, fontSize: 11, padding: 0 }
const thDiaPessoa: React.CSSProperties = { position: 'sticky', left: 0, top: 0, zIndex: 2, background: CREAM, textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: MUT, minWidth: 170 }
const thDia: React.CSSProperties = { padding: '6px 8px', textAlign: 'right', fontSize: 10.5, fontWeight: 700, color: ESP, background: CREAM, minWidth: 46, whiteSpace: 'nowrap' }
const tdPessoa: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: '#FFF', padding: '6px 10px', whiteSpace: 'nowrap', minWidth: 170, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', color: ESP, fontWeight: 500 }
const tdDia: React.CSSProperties = { padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: ESP }
