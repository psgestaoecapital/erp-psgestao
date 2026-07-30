'use client'

// DRE Horizontal Consolidado (Grupo) — F1.
// - lê o grupo (dashboard_grupos + dashboard_grupos_empresas), consolida os CNPJs;
// - meses nas colunas (sticky header) + conta em árvore (sticky 1ª coluna);
// - linhas colapsáveis por grupo do DRE; subtotais/resultado em negrito;
// - projeção (meses futuros) marcada; toggle Competência × Caixa;
// - números abreviados (R$ 31,5 mi) com valor cheio no title.
// Drill cliente/fornecedor = F2; coluna por CNPJ + export = F3.

import { useCallback, useEffect, useMemo, useState } from 'react'
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
type Grupo = { id: string; nome: string; is_padrao: boolean; membros: string[] }

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
  const { sel, loading: loadingSel } = useCompanyIds()

  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [grupoId, setGrupoId] = useState<string>('')
  const [regime, setRegime] = useState<'competencia' | 'caixa'>('competencia')
  const [mesIni, setMesIni] = useState<string>(toYM(monthShift(-11))) // 12 realizados
  const [mesFim, setMesFim] = useState<string>(toYM(monthShift(6)))   // + projeção
  const [colapsados, setColapsados] = useState<Set<string>>(new Set())
  const [tudoAberto, setTudoAberto] = useState(false)

  const [data, setData] = useState<DreResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Carrega os grupos do usuário (matriz → membros via dashboard_grupos_empresas)
  useEffect(() => {
    let alive = true
    void supabase
      .from('dashboard_grupos')
      .select('id, nome, is_padrao, dashboard_grupos_empresas(company_id)')
      .order('ordem')
      .then(({ data: gs, error }) => {
        if (!alive) return
        if (error) { setErro(error.message); return }
        const lista: Grupo[] = (gs ?? []).map((g: Record<string, unknown>) => ({
          id: g.id as string,
          nome: g.nome as string,
          is_padrao: !!g.is_padrao,
          membros: ((g.dashboard_grupos_empresas as { company_id: string }[]) ?? []).map((m) => m.company_id),
        })).filter((g) => g.membros.length > 0)
        setGrupos(lista)
      })
    return () => { alive = false }
  }, [])

  // Default: grupo que contém a empresa selecionada → padrão → 1º
  useEffect(() => {
    if (!grupos.length || grupoId) return
    const contendo = sel && sel !== 'consolidado' && !sel.startsWith('group_')
      ? grupos.find((g) => g.membros.includes(sel))
      : undefined
    const escolha = contendo ?? grupos.find((g) => g.is_padrao) ?? grupos[0]
    setGrupoId(escolha.id)
  }, [grupos, sel, grupoId])

  const grupoSel = useMemo(() => grupos.find((g) => g.id === grupoId) ?? null, [grupos, grupoId])

  const carregar = useCallback(async () => {
    if (!grupoSel) return
    setLoading(true); setErro(null)
    const { data: res, error } = await supabase.rpc('fn_psgc_dre_horizontal', {
      p_company_ids: grupoSel.membros,
      p_mes_ini: ymToDate(mesIni),
      p_mes_fim: ymToDate(mesFim),
      p_regime: regime,
    })
    const r = res as DreResult | null
    if (error) { setErro(error.message); setData(null) }
    else if (r && r.ok === false) { setErro(r.erro || 'Sem acesso'); setData(null) }
    else setData(r)
    setLoading(false)
  }, [grupoSel, mesIni, mesFim, regime])

  useEffect(() => { void carregar() }, [carregar])

  // colapso: por padrão todos os grupos recolhidos (mostra a espinha do DRE)
  useEffect(() => {
    if (!data) return
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
            <label style={lbl}>Grupo</label>
            <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} style={{ ...inp, minWidth: 200 }}>
              {grupos.length === 0 && <option value="">— sem grupos —</option>}
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome} ({g.membros.length})</option>)}
            </select>
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
                  const bold = isRes || isGrp
                  const total = totalLinha(l)
                  return (
                    <tr key={`${l.kind}-${l.codigo}-${l.ordem}`} style={{ borderTop: `0.5px solid ${LINE}`, background: isRes ? '#FBF7EF' : '#FFF' }}>
                      <td style={{
                        ...tdConta, position: 'sticky', left: 0, zIndex: 2,
                        background: isRes ? '#FBF7EF' : '#FFF',
                        paddingLeft: 12 + l.nivel * 18,
                        fontWeight: bold ? 700 : 500,
                        color: ESP,
                      }}>
                        {l.colapsavel ? (
                          <button type="button" onClick={() => toggleGrupo(l.codigo)} style={caret} aria-label="expandir/recolher">
                            {colapsados.has(l.codigo) ? '▸' : '▾'}
                          </button>
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
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 11, color: MUT, margin: '12px 2px 0', fontStyle: 'italic' }}>
          Valores abreviados (toque/hover mostra o valor cheio). Sinais já aplicados: receitas somam, deduções/custos/despesas subtraem.
          Meses marcados <b style={{ color: GOLD }}>PROJ.</b> são projeção (títulos com vencimento futuro). Verde/vermelho só nas linhas de resultado.
        </p>
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
