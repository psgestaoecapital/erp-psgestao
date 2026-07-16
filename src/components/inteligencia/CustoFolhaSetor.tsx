'use client'

// CUSTO DE FOLHA POR SETOR + TURNOVER (Industrial B2 · BI de Gente).
// Fonte: fn_custo_folha_setor / fn_turnover_periodo (folha_competencia × ind_pessoa,
// security_invoker → escopo por empresa, Pilar 2). 100% agregado, sem nomes.
// RD-51: ⚠️ SEM SETOR e PRÓ-LABORE sempre visíveis (cor neutra), nunca diluídos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import SeloFrescor from '@/components/comum/SeloFrescor'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const CREAM = '#F2EBDF'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const NEU = '#B9A88C'          // neutro (SEM SETOR / pró-labore) — não é semáforo

const brl = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const inp: React.CSSProperties = { padding: '8px 11px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF' }
const compLabel = (iso: string) => { const [y, m] = iso.slice(0, 7).split('-'); return `${m}/${y}` }

type LinhaCusto = { setor: string; colaboradores: number; custo_total: number; remuneracao_base: number; pct: number }
type Turn = { competencia: string; desligamentos: number; headcount: number; turnover_pct: number; artefato_rebuild: boolean }
const ESPECIAL = (s: string) => s === '⚠️ SEM SETOR' || s.startsWith('PRÓ-LABORE')

export default function CustoFolhaSetor({ companyId }: { companyId: string | null }) {
  const [competencias, setCompetencias] = useState<string[]>([])
  const [comp, setComp] = useState<string | null>(null)
  const [custo, setCusto] = useState<LinhaCusto[] | null>(null)
  const [turnover, setTurnover] = useState<Turn[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // competências disponíveis (RLS escopa por empresa)
  useEffect(() => {
    if (!companyId) return
    void (async () => {
      const { data, error } = await supabase.from('folha_competencia').select('competencia').eq('company_id', companyId)
      if (error) { setErro(error.message); setLoading(false); return }
      const uniq = [...new Set((data ?? []).map((r) => (r.competencia as string)))].sort().reverse()
      setCompetencias(uniq)
      setComp((c) => c ?? uniq[0] ?? null)
      if (uniq.length === 0) setLoading(false)
    })()
  }, [companyId])

  const carregar = useCallback(async () => {
    if (!companyId || !comp) return
    setLoading(true); setErro(null)
    const [c, t] = await Promise.all([
      supabase.rpc('fn_custo_folha_setor', { p_company_id: companyId, p_competencia: comp }),
      Promise.all(competencias.map((k) => supabase.rpc('fn_turnover_periodo', { p_company_id: companyId, p_competencia: k }))),
    ])
    if (c.error) { setErro(c.error.message); setCusto(null); setLoading(false); return }
    setCusto((c.data as LinhaCusto[]) ?? [])
    const linhas = t.map((r) => ((r.data as Turn[]) ?? [])[0]).filter(Boolean) as Turn[]
    setTurnover(linhas.sort((a, b) => a.competencia.localeCompare(b.competencia)))
    setLoading(false)
  }, [companyId, comp, competencias])

  useEffect(() => { void carregar() }, [carregar])

  const total = useMemo(() => (custo ?? []).reduce((s, l) => s + Number(l.custo_total), 0), [custo])
  const maxCusto = useMemo(() => Math.max(1, ...(custo ?? []).map((l) => Number(l.custo_total))), [custo])

  if (!companyId) return null

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* ═══ Card A · Custo de Folha por Setor ═══ */}
      <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>💵 Custo de Folha por Setor</span>
          {comp && <SeloFrescor icone="🧾" fonte="folha" competencia={comp} />}
          <select value={comp ?? ''} onChange={(e) => setComp(e.target.value)} style={{ ...inp, marginLeft: 'auto' }}>
            {competencias.map((k) => <option key={k} value={k}>competência {compLabel(k)}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11, color: MUT, marginBottom: 12, fontStyle: 'italic' }}>
          Folha do provedor (folha_competencia) cruzada com o setor de cada matrícula (ind_pessoa). Base do custo: <b>total_geral</b> (com encargos). Pró-labore de sócios e sem-setor ficam separados, nunca diluídos.
        </div>

        {loading ? (
          <div style={{ padding: 36, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : erro ? (
          <div style={{ fontSize: 13, color: '#B23B3B' }}>Não foi possível carregar: {erro}</div>
        ) : !custo || custo.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: MUT, fontSize: 13, border: `1px dashed ${LINE}`, borderRadius: 10 }}>Sem folha para a competência.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {custo.map((l) => {
                const esp = ESPECIAL(l.setor)
                const cor = esp ? NEU : GOLD
                return (
                  <div key={l.setor} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                    <span style={{ fontSize: 12.5, fontWeight: esp ? 700 : 600, color: esp ? MUT : ESP, minWidth: 190, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.setor}>{l.setor}</span>
                    <div style={{ flex: 1, minWidth: 80, height: 14, background: CREAM, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, Number(l.custo_total) / maxCusto * 100)}%`, height: '100%', background: cor, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: ESP, minWidth: 108, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{brl(Number(l.custo_total))}</span>
                    <span style={{ fontSize: 11, color: MUT, minWidth: 42, textAlign: 'right' }}>{Number(l.pct).toFixed(1)}%</span>
                    <span style={{ fontSize: 11, color: MUT, minWidth: 34, textAlign: 'right' }}>{l.colaboradores}p</span>
                  </div>
                )
              })}
            </div>
            <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 10, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: MUT }}>
              <span>Total: <b style={{ color: ESP }}>{brl(total)}</b> · base: total_geral da folha</span>
              <span>{comp ? `competência ${compLabel(comp)}` : ''}</span>
            </div>
          </>
        )}
      </section>

      {/* ═══ Card B · Turnover ═══ */}
      <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>🔄 Turnover</span>
          <SeloFrescor icone="👥" fonte="ind_pessoa" temDados={turnover.length > 0} semDadosTexto="sem base de desligamento" dataAte={turnover.length ? turnover[turnover.length - 1].competencia : null} />
        </div>
        <div style={{ fontSize: 11, color: MUT, marginBottom: 12, fontStyle: 'italic' }}>
          Base: <b>desligamento</b> ÷ headcount da competência (ind_pessoa, sem pró-labore). Não usa "entrada" — admissão pode vir de rebuild da base.
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : turnover.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: MUT, fontSize: 13, border: `1px dashed ${LINE}`, borderRadius: 10 }}>Sem base de desligamento no período.</div>
        ) : (
          <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <thead style={{ background: BG }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: MUT }}>Competência</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: MUT }}>Desligamentos</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: MUT }}>Headcount</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: MUT }}>Turnover</th>
                </tr>
              </thead>
              <tbody>
                {turnover.map((t) => (
                  <tr key={t.competencia} style={{ borderTop: `0.5px solid ${LINE}` }}>
                    <td style={{ padding: '8px 12px', color: ESP, fontWeight: 600 }}>
                      {compLabel(t.competencia)}{t.artefato_rebuild && <span style={{ color: GOLD }}> *</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: ESP, fontVariantNumeric: 'tabular-nums' }}>{t.desligamentos}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: MUT, fontVariantNumeric: 'tabular-nums' }}>{t.headcount}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: ESP, fontVariantNumeric: 'tabular-nums' }}>{Number(t.turnover_pct).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {turnover.some((t) => t.artefato_rebuild) && (
          <div style={{ fontSize: 11, color: MUT, marginTop: 8, fontStyle: 'italic' }}>
            <span style={{ color: GOLD, fontWeight: 700 }}>*</span> admissões desse mês vêm do rebuild da base — turnover por <b>entrada</b> é inválido; aqui a base é <b>desligamento</b>, que segue válido.
          </div>
        )}
      </section>
    </div>
  )
}
