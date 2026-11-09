'use client'

// Indústria · RH · Mão de Obra (CEO 06/11 · MODELO A decidido pelo Eng. Chefe 07/11).
// Gestão de custo de mão de obra ponta a ponta, SETOR a SETOR e NOME a NOME, a partir da folha
// IMPORTADA (industrial/folha → folha_competencia × ind_pessoa). RD-26: reusa a folha (import) e o
// painel de custo por setor (CustoFolhaSetor, fn_custo_folha_setor security_invoker). NÃO duplica a
// tela de Mão de Obra do Hub (/projetos/mao-obra = erp_mao_obra_custo, outro contexto).
// LGPD: salário é dado sensível — leitura escopada por empresa (RLS em folha_competencia/ind_pessoa:
// company_id IN get_user_company_ids()). Tela operacional de RH; o BI final expõe só o agregado por setor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import CustoFolhaSetor from '@/components/inteligencia/CustoFolhaSetor'

const ROTA = '/dashboard/industrial/mao-obra'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', GOLD_D = '#A57A15'
const LINE = '#E7DECF', CREAM = '#F2EBDF', MUT = 'rgba(61,35,20,0.55)', NEU = '#B9A88C'

const brl = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtComp = (d: string) => { const [y, m] = d.slice(0, 7).split('-'); return `${m}/${y}` }
const ESPECIAL = (s: string) => s === '⚠️ SEM SETOR' || s.startsWith('PRÓ-LABORE')

type CompRow = { matricula: number; nome: string | null; competencia: string; total_geral: number; remuneracao: number }
type PessoaRow = { matricula: number; setor: string | null; vinculo: string | null }
type LinhaPessoa = { matricula: number; nome: string; remuneracao: number; total_geral: number }
type Grupo = { setor: string; especial: boolean; pessoas: LinhaPessoa[]; custo: number; remuneracao: number }

// mesma classificação da view v_custo_folha_setor (RD-51): pró-labore e sem-setor separados, nunca diluídos
function setorDe(vinculo: string | null, setor: string | null): string {
  if ((vinculo ?? '').trim().toLowerCase() === 'prolabore') return 'PRÓ-LABORE (sócios)'
  const s = (setor ?? '').trim()
  return s === '' ? '⚠️ SEM SETOR' : s
}

export default function MaoObraIndustriaPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [compRows, setCompRows] = useState<CompRow[]>([])
  const [pessoas, setPessoas] = useState<PessoaRow[]>([])
  const [compSel, setCompSel] = useState<string | null>(null)
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true); setErro(null)
    const [f, p] = await Promise.all([
      supabase.from('folha_competencia').select('matricula, nome, competencia, total_geral, remuneracao').eq('company_id', empresaUnica),
      supabase.from('ind_pessoa').select('matricula, setor, vinculo').eq('company_id', empresaUnica),
    ])
    if (f.error) { setErro(f.error.message); setLoading(false); return }
    const rows = (f.data ?? []) as CompRow[]
    setCompRows(rows)
    setPessoas((p.data ?? []) as PessoaRow[])
    const comps = [...new Set(rows.map((r) => r.competencia))].sort().reverse()
    setCompSel((c) => c ?? comps[0] ?? null)
    setLoading(false)
  }, [empresaUnica])
  useEffect(() => { void carregar() }, [carregar])

  const competencias = useMemo(() => [...new Set(compRows.map((r) => r.competencia))].sort().reverse(), [compRows])
  const setorPorMatricula = useMemo(() => {
    const m = new Map<number, PessoaRow>()
    for (const p of pessoas) m.set(Number(p.matricula), p)
    return m
  }, [pessoas])

  const grupos = useMemo<Grupo[]>(() => {
    if (!compSel) return []
    const porSetor = new Map<string, Grupo>()
    for (const r of compRows.filter((x) => x.competencia === compSel)) {
      const pr = setorPorMatricula.get(Number(r.matricula))
      const setor = setorDe(pr?.vinculo ?? null, pr?.setor ?? null)
      const g = porSetor.get(setor) ?? { setor, especial: ESPECIAL(setor), pessoas: [], custo: 0, remuneracao: 0 }
      g.pessoas.push({ matricula: r.matricula, nome: r.nome ?? `matrícula ${r.matricula}`, remuneracao: Number(r.remuneracao) || 0, total_geral: Number(r.total_geral) || 0 })
      g.custo += Number(r.total_geral) || 0
      g.remuneracao += Number(r.remuneracao) || 0
      porSetor.set(setor, g)
    }
    for (const g of porSetor.values()) g.pessoas.sort((a, b) => b.total_geral - a.total_geral)
    // setores "de verdade" primeiro (por custo desc); especiais ao fim
    return [...porSetor.values()].sort((a, b) => Number(a.especial) - Number(b.especial) || b.custo - a.custo)
  }, [compRows, compSel, setorPorMatricula])

  const totalCusto = useMemo(() => grupos.reduce((s, g) => s + g.custo, 0), [grupos])
  const totalPessoas = useMemo(() => grupos.reduce((s, g) => s + g.pessoas.length, 0), [grupos])

  if (!empresaUnica) {
    return <Casca><Box><b style={{ color: ESP }}>Selecione uma empresa</b><div style={{ color: MUT, fontSize: 13, marginTop: 6 }}>A mão de obra é por empresa. Escolha uma empresa específica no seletor do topo.</div></Box></Casca>
  }

  return (
    <Casca>
      {erro && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>{erro}</div>}

      {loading ? (
        <Box><span style={{ color: MUT, fontSize: 13 }}>Carregando folha…</span></Box>
      ) : competencias.length === 0 ? (
        // RD-98 · estado vazio diz o que fazer e tem o botão para fazer
        <Box>
          <div style={{ fontSize: 34, marginBottom: 8 }}>👥</div>
          <b style={{ color: ESP, fontSize: 15 }}>Nenhuma folha importada ainda</b>
          <div style={{ color: MUT, fontSize: 13, margin: '8px 0 16px', lineHeight: 1.5 }}>
            O custo de mão de obra por setor é montado a partir da folha de pagamento importada. Importe a folha (planilha do
            sistema de origem) para ver o custo por setor e a lista de pessoas de cada setor.
          </div>
          <Link href="/dashboard/industrial/folha" style={{ ...btnGold, textDecoration: 'none', display: 'inline-block' }}>📤 Importar folha</Link>
        </Box>
      ) : (
        <>
          {/* Filtro de competência + KPIs */}
          <section style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }}>Competência</span>
              <AjudaCampo chave="industrial.mao_obra.competencia" rota={ROTA} />
              <select value={compSel ?? ''} onChange={(e) => setCompSel(e.target.value)}
                style={{ padding: '8px 11px', border: `0.5px solid ${LINE}`, borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF' }}>
                {competencias.map((k) => <option key={k} value={k}>competência {fmtComp(k)}</option>)}
              </select>
              <Link href="/dashboard/industrial/folha" style={{ ...btnOutline, textDecoration: 'none', marginLeft: 'auto' }}>📤 Importar / atualizar folha</Link>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <Kpi t="Colaboradores" v={String(totalPessoas)} ajuda="industrial.mao_obra.pessoas" />
              <Kpi t="Custo total (com encargos)" v={brl(totalCusto)} destaque ajuda="industrial.mao_obra.total" />
              <Kpi t="Setores" v={String(grupos.filter((g) => !g.especial).length)} />
            </div>
          </section>

          {/* Custo por setor (reuso do painel de BI de Gente) */}
          <section style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>Custo de mão de obra por setor</span>
              <AjudaCampo chave="industrial.mao_obra.custo_setor" rota={ROTA} />
            </div>
            <div style={{ fontSize: 11, color: MUT, marginBottom: 12, fontStyle: 'italic' }}>
              Agregado por setor (base: total_geral, com encargos). Disponível para o BI de Custo / centro de custo.
            </div>
            <CustoFolhaSetor companyId={empresaUnica} />
          </section>

          {/* Pessoas por setor, nome a nome */}
          <section style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>Pessoas por setor</span>
              <AjudaCampo chave="industrial.mao_obra.pessoas_setor" rota={ROTA} />
            </div>
            <div style={{ fontSize: 11, color: MUT, marginBottom: 12 }}>🔒 Dado sensível de RH (salário por pessoa). Visível só dentro da empresa; o BI expõe apenas o agregado.</div>
            {grupos.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: MUT, fontSize: 13, border: `1px dashed ${LINE}`, borderRadius: 10 }}>Sem pessoas na competência {compSel ? fmtComp(compSel) : ''}.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {grupos.map((g) => {
                  const aberto = abertos[g.setor] ?? false
                  return (
                    <div key={g.setor} style={{ border: `0.5px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
                      <button onClick={() => setAbertos((s) => ({ ...s, [g.setor]: !aberto }))}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: aberto ? 'rgba(200,148,26,0.07)' : '#FFF', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ fontSize: 13, fontWeight: g.especial ? 700 : 600, color: g.especial ? MUT : ESP, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.especial ? g.setor : g.setor}</span>
                        <span style={{ fontSize: 11, color: MUT, whiteSpace: 'nowrap' }}>{g.pessoas.length}p</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: g.especial ? NEU : ESP, fontVariantNumeric: 'tabular-nums', minWidth: 104, textAlign: 'right' }}>{brl(g.custo)}</span>
                        <span style={{ fontSize: 12, color: MUT, transform: aberto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
                      </button>
                      {aberto && (
                        <div style={{ overflowX: 'auto', borderTop: `0.5px solid ${LINE}` }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 360 }}>
                            <thead style={{ background: BG }}>
                              <tr>
                                <th style={th}>Colaborador</th>
                                <th style={{ ...th, textAlign: 'right' }}>Remuneração base</th>
                                <th style={{ ...th, textAlign: 'right' }}>Custo c/ encargos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.pessoas.map((pe) => (
                                <tr key={pe.matricula} style={{ borderTop: `0.5px solid ${LINE}` }}>
                                  <td style={{ padding: '8px 12px', color: ESP, fontWeight: 600 }}>{pe.nome}</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', color: MUT, fontVariantNumeric: 'tabular-nums' }}>{brl(pe.remuneracao)}</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', color: ESP, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{brl(pe.total_geral)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </Casca>
  )
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 14 }}>
        <header>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Indústria · RH</p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 0' }}>Mão de Obra</h1>
          <p style={{ fontSize: 12.5, color: MUT, margin: '6px 0 0', lineHeight: 1.5 }}>Custo de mão de obra por setor e por pessoa, a partir da folha importada. Serve de base para o BI de Custo (centro de custo).</p>
        </header>
        {children}
      </div>
    </div>
  )
}
function Box({ children }: { children: React.ReactNode }) { return <div style={{ ...card, textAlign: 'center', padding: 28 }}>{children}</div> }
function Kpi({ t, v, destaque, ajuda }: { t: string; v: string; destaque?: boolean; ajuda?: string }) {
  return (
    <div style={{ background: destaque ? 'rgba(200,148,26,0.08)' : BG, border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>{t}</span>
        {ajuda && <AjudaCampo chave={ajuda} rota={ROTA} />}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: destaque ? GOLD_D : ESP, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
    </div>
  )
}
const card: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const th: React.CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOutline: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#FFF', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
