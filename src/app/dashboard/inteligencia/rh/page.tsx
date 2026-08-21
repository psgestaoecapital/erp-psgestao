'use client'

// RH Industrial · Hub (Inteligência → Recursos humanos). Sub-cards no topo (padrão dos cards BI) +
// conteúdo do sub-card selecionado. Primeiro sub-card: Quadro de Lotação (postos projetados × alocação
// real · fn_rh_quadro_lotacao). Folha e Ponto LINKAM pras telas GE/existentes (fronteira GE — não
// duplica). RD-58: card só "acende" com dado; sem dado = "em breve · aguarda dados".

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2',
  muted: 'rgba(250,247,242,0.55)', green: '#6BBF59', red: '#D9764A', espresso: '#3D2314',
}
const brl = (n: number | null | undefined) => 'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type QuadroRow = {
  setor: string; posto_id: string; codigo_po: string | null; cargo: string | null; atividade: string | null
  proj_t1: number; proj_t2: number; proj_t3: number; proj_total: number; real: number; gap: number; custo: number | null
}
type QuadroResp = {
  ok: boolean; erro?: string; pode_salario: boolean
  kpis: { postos_ativos: number; postos_ocupados: number; vagas_abertas: number; proj_total: number; real_total: number; custo_registrado: number | null }
  lista: QuadroRow[]
}

type SubKey = 'quadro' | 'folha' | 'ponto' | 'remun' | 'indic' | 'nr'

export default function RhHubPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const router = useRouter()

  const [sub, setSub] = useState<SubKey>('quadro')
  const [quadro, setQuadro] = useState<QuadroResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [counts, setCounts] = useState({ postos: 0, folha: 0, ponto: 0 })

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true); setErro(null)
    const [q, cPostos, cFolha, cPonto] = await Promise.all([
      supabase.rpc('fn_rh_quadro_lotacao', { p_company_id: empresa }),
      supabase.from('rh_posto_trabalho').select('*', { count: 'exact', head: true }).eq('company_id', empresa).eq('ativo', true),
      supabase.from('folha_competencia').select('*', { count: 'exact', head: true }).eq('company_id', empresa),
      supabase.from('ind_ponto_colaborador').select('*', { count: 'exact', head: true }).eq('company_id', empresa),
    ])
    setCounts({ postos: cPostos.count ?? 0, folha: cFolha.count ?? 0, ponto: cPonto.count ?? 0 })
    if (q.error) setErro(q.error.message)
    else {
      const r = q.data as QuadroResp
      if (!r?.ok) setErro(r?.erro === 'sem_acesso' ? 'Sem acesso ao quadro desta empresa.' : (r?.erro ?? 'Erro ao carregar'))
      else setQuadro(r)
    }
    setLoading(false)
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const subcards = useMemo(() => ([
    { key: 'quadro' as SubKey, icone: '📋', nome: 'Quadro de lotação', tipo: 'ativo' as const, badge: counts.postos > 0 ? `${counts.postos} postos` : 'aguarda import', aceso: counts.postos > 0 },
    { key: 'folha' as SubKey, icone: '💰', nome: 'Folha de pagamento', tipo: 'link' as const, rota: '/dashboard/industrial/folha', badge: counts.folha > 0 ? `${counts.folha} lançamentos` : '—', aceso: counts.folha > 0 },
    { key: 'ponto' as SubKey, icone: '⏱️', nome: 'Ponto e jornada', tipo: 'link' as const, rota: '/dashboard/industrial/producao', badge: counts.ponto > 0 ? `${counts.ponto} colaboradores` : '—', aceso: counts.ponto > 0 },
    { key: 'remun' as SubKey, icone: '📈', nome: 'Remuneração variável', tipo: 'breve' as const, badge: 'em breve · aguarda dados', aceso: false },
    { key: 'indic' as SubKey, icone: '📊', nome: 'Indicadores', tipo: 'breve' as const, badge: 'em breve · aguarda dados', aceso: false },
    { key: 'nr' as SubKey, icone: '🎓', nome: 'Treinamentos NR', tipo: 'breve' as const, badge: 'em breve · aguarda dados', aceso: false },
  ]), [counts])

  function clicarSub(sc: (typeof subcards)[number]) {
    if (sc.tipo === 'link' && 'rota' in sc && sc.rota) { router.push(sc.rota); return }
    if (sc.tipo === 'breve') return
    setSub(sc.key)
  }

  // Agrupa a lista do quadro por setor
  const porSetor = useMemo(() => {
    const m = new Map<string, QuadroRow[]>()
    for (const r of (quadro?.lista ?? [])) {
      const arr = m.get(r.setor) ?? []
      arr.push(r); m.set(r.setor, arr)
    }
    return Array.from(m.entries())
  }, [quadro])

  if (!empresa) {
    return <div style={{ background: C.bg, minHeight: '100vh', padding: 40, color: C.muted, fontSize: 14 }}>Selecione uma empresa específica para ver os Recursos Humanos.</div>
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 18px', color: C.text }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>👥 Inteligência · Industrial</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Recursos Humanos</h1>
          <p style={{ fontSize: 12.5, color: C.muted, margin: '4px 0 0' }}>
            Planejamento de lotação × folha realizada. Folha e Ponto abrem as telas existentes — este hub não as duplica.
          </p>
        </header>

        {/* Sub-cards (padrão BI) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 18 }}>
          {subcards.map((sc) => {
            const ativo = sub === sc.key && sc.tipo === 'ativo'
            return (
              <button
                key={sc.key}
                type="button"
                onClick={() => clicarSub(sc)}
                disabled={sc.tipo === 'breve'}
                style={{
                  textAlign: 'left', background: ativo ? '#241C15' : C.card,
                  border: `1px solid ${ativo ? C.gold : C.border}`, borderRadius: 10, padding: '12px 14px',
                  cursor: sc.tipo === 'breve' ? 'default' : 'pointer', opacity: sc.tipo === 'breve' ? 0.55 : 1,
                  color: C.text, position: 'relative',
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>{sc.icone}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{sc.nome}</div>
                <div style={{ fontSize: 10.5, marginTop: 4, color: sc.aceso ? C.green : C.muted, fontWeight: 600 }}>
                  {sc.tipo === 'link' && sc.aceso ? '🔗 ' : ''}{sc.badge}
                </div>
              </button>
            )
          })}
        </div>

        {/* Conteúdo do sub-card */}
        {sub === 'quadro' && (
          <div>
            {loading ? (
              <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Carregando…</div>
            ) : erro ? (
              <div style={{ background: '#2A1512', border: '1px solid #5A2A22', color: '#F2B8A8', padding: '10px 14px', borderRadius: 8, fontSize: 12.5 }}>{erro}</div>
            ) : (quadro?.kpis.postos_ativos ?? 0) === 0 ? (
              <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🗂️</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Quadro aguardando importação</div>
                <div style={{ fontSize: 12.5, color: C.muted, maxWidth: 520, margin: '0 auto' }}>
                  Os postos de trabalho ainda não foram importados para esta empresa. Rode a importação da
                  planilha de lotação (perfil RH ou sócio) — assim que os postos entrarem, os KPIs e a
                  tabela por setor aparecem aqui. Enquanto isso, Folha ({counts.folha}) e Ponto ({counts.ponto})
                  já têm dado nos cards acima.
                </div>
              </div>
            ) : (
              <>
                {/* KPIs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
                  {[
                    { l: 'Postos ativos', v: String(quadro!.kpis.postos_ativos) },
                    { l: 'Ocupados', v: String(quadro!.kpis.postos_ocupados) },
                    { l: 'Vagas abertas', v: String(quadro!.kpis.vagas_abertas), cor: quadro!.kpis.vagas_abertas > 0 ? C.red : C.green },
                    { l: 'Projetado × Real', v: `${quadro!.kpis.proj_total} / ${quadro!.kpis.real_total}` },
                    ...(quadro!.pode_salario ? [{ l: 'Custo registrado', v: brl(quadro!.kpis.custo_registrado) }] : []),
                  ].map((k, i) => (
                    <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.l}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: (k as { cor?: string }).cor ?? C.text }}>{k.v}</div>
                    </div>
                  ))}
                </div>
                {!quadro!.pode_salario && (
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>🔒 Valores de salário/custo ocultos — visíveis apenas para o perfil de RH (LGPD).</div>
                )}

                {/* Tabela por setor */}
                {porSetor.map(([setor, linhas]) => (
                  <div key={setor} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, marginBottom: 6 }}>{setor} · {linhas.length} posto(s)</div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ color: C.muted, textAlign: 'left' }}>
                            {['Posto', 'Cargo', 'Proj (T1/T2/T3)', 'Real', 'Gap', ...(quadro!.pode_salario ? ['Custo'] : [])].map((h) => (
                              <th key={h} style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {linhas.map((r) => (
                            <tr key={r.posto_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.codigo_po ?? '—'}</td>
                              <td style={{ padding: '8px 10px' }}>{r.cargo ?? r.atividade ?? '—'}</td>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.proj_total} <span style={{ color: C.muted }}>({r.proj_t1}/{r.proj_t2}/{r.proj_t3})</span></td>
                              <td style={{ padding: '8px 10px' }}>{r.real}</td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: r.gap > 0 ? C.red : C.green, whiteSpace: 'nowrap' }}>
                                {r.gap > 0 ? `🔴 falta ${r.gap}` : r.gap < 0 ? `+${-r.gap}` : '✅ ok'}
                              </td>
                              {quadro!.pode_salario && <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{brl(r.custo)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
