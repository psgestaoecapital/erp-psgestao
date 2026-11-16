// src/app/dashboard/ehs/cockpit/page.tsx
// PS EHS · Onda S1.5 — COCKPIT SST · piloto DEMO (bucket ehs_completo)
// Visão consolidada da cadeia S1.1->S1.4: quanto da matriz SST está mapeado, onde estão os buracos e a
// cobertura por setor. Lê de v_ehs_cockpit_resumo (1 linha/empresa) + v_ehs_cockpit_setor (semáforo).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8',
  borderLt: '#ece3d2', ink: '#1a1a1a', muted: 'rgba(61, 35, 20, 0.55)', green: '#16a34a',
  amber: '#C8941A', red: '#dc2626', redBg: '#fce8e8', blue: '#2563eb',
}

type Resumo = {
  n_setores: number; n_postos: number; n_pessoas: number
  setores_com_risco: number; postos_com_epi: number; postos_com_treino: number
  pessoas_cobertura_completa: number; pessoas_com_gap: number
  epis_ca_vencido: number; epis_ca_vencendo_30d: number
}
type SetorLinha = {
  company_id: string; setor_id: string; setor_nome: string
  n_postos: number; n_pessoas: number; n_riscos: number; postos_com_epi: number; postos_com_treino: number
  cobertura: 'completa' | 'parcial' | 'vazia'
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)
const corCobertura = (c: string) => (c === 'completa' ? C.green : c === 'parcial' ? C.amber : C.red)
const bgCobertura = (c: string) => (c === 'completa' ? '#e7f6ec' : c === 'parcial' ? C.gold + '18' : C.redBg)
const semaforo = (c: string) => (c === 'completa' ? '🟢' : c === 'parcial' ? '🟡' : '🔴')
const rotuloCobertura = (c: string) => (c === 'completa' ? 'Completa' : c === 'parcial' ? 'Parcial' : 'Vazia')

const ATALHOS = [
  { rota: '/dashboard/ehs/matriz/risco-setor', nome: '🔴 Riscos por Setor' },
  { rota: '/dashboard/ehs/matriz/epi-posto', nome: '🦺 EPIs por Posto' },
  { rota: '/dashboard/ehs/matriz/treinamento-posto', nome: '🎓 Treinamentos por Posto' },
  { rota: '/dashboard/ehs/matriz/heranca-pessoa', nome: '👤 Herança por Pessoa' },
]

export default function CockpitSstPage() {
  const { companyIds, companies } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const multiEmpresa = (companyIds?.length ?? 0) > 1
  const [companyAlvo, setCompanyAlvo] = useState<string>('')
  useEffect(() => { if (!companyAlvo && companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0]) }, [companyIds, companyAlvo])

  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa')
    return m
  }, [companies])

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [setores, setSetores] = useState<SetorLinha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const alvo = useMemo(() => {
    const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
    return multiEmpresa && companyAlvo ? companyAlvo : ids[0] || ''
  }, [companyIdsKey, companyAlvo, multiEmpresa])

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      if (!alvo) { setResumo(null); setSetores([]); return }
      const [r, s] = await Promise.all([
        supabase.from('v_ehs_cockpit_resumo').select('*').eq('company_id', alvo).maybeSingle(),
        supabase.from('v_ehs_cockpit_setor').select('*').eq('company_id', alvo),
      ])
      if (r.error) throw r.error
      if (s.error) throw s.error
      setResumo((r.data as Resumo) || null)
      setSetores(((s.data || []) as SetorLinha[]).sort((a, b) => a.setor_nome.localeCompare(b.setor_nome)))
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar o cockpit')
    } finally { setLoading(false) }
  }, [alvo])

  useEffect(() => { carregar() }, [carregar])

  const setoresVisiveis = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return q ? setores.filter((s) => (s.setor_nome || '').toLowerCase().includes(q)) : setores
  }, [setores, busca])

  const semMatriz = !!resumo && resumo.setores_com_risco === 0 && resumo.postos_com_epi === 0 && resumo.postos_com_treino === 0

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Cockpit</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Cockpit SST</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 700 }}>
              Quanto da matriz SST está <strong>mapeado</strong>, onde estão os <strong>buracos</strong> e como está a
              <strong> cobertura por setor</strong> — o ponto de partida da jornada de compliance.
            </p>
          </div>
          <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
        </header>

        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>)}

        {/* Filtros */}
        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {multiEmpresa && (
            <div data-ajuda="ehs.cockpit.empresa" style={{ flex: '0 1 240px' }}>
              <label style={labelStyle}>Empresa <AjudaCampo chave="ehs.cockpit.empresa" /></label>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={inputStyle()}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </div>
          )}
          <div data-ajuda="ehs.cockpit.busca" style={{ flex: '1 1 240px' }}>
            <label style={labelStyle}>Buscar setor <AjudaCampo chave="ehs.cockpit.busca" /></label>
            <input type="text" placeholder="Nome do setor…" value={busca} onChange={(e) => setBusca(e.target.value)} style={inputStyle()} />
          </div>
        </section>

        {loading && (<div style={{ padding: 32, textAlign: 'center', color: C.muted }}>Carregando…</div>)}

        {!loading && !resumo && (
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 32, textAlign: 'center', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.espresso, margin: '0 0 6px' }}>Selecione uma empresa</p>
            <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Escolha a empresa para ver o cockpit SST.</p>
          </div>
        )}

        {!loading && resumo && (
          <>
            {/* KPIs base */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 16 }}>
              <Kpi rotulo="Setores" valor={resumo.n_setores} />
              <Kpi rotulo="Postos" valor={resumo.n_postos} />
              <Kpi rotulo="Pessoas" valor={resumo.n_pessoas} />
            </section>

            {/* KPIs de cobertura / herança / alertas */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
              <div data-ajuda="ehs.cockpit.cobertura" style={cardStyle}>
                <div style={cardTitulo}>Cobertura da matriz <AjudaCampo chave="ehs.cockpit.cobertura" /></div>
                <LinhaCobertura rotulo="Setores com risco" n={resumo.setores_com_risco} d={resumo.n_setores} />
                <LinhaCobertura rotulo="Postos com EPI" n={resumo.postos_com_epi} d={resumo.n_postos} />
                <LinhaCobertura rotulo="Postos com treinamento" n={resumo.postos_com_treino} d={resumo.n_postos} />
              </div>
              <div data-ajuda="ehs.cockpit.heranca" style={cardStyle}>
                <div style={cardTitulo}>Herança (pessoas) <AjudaCampo chave="ehs.cockpit.heranca" /></div>
                <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                  <div><div style={{ fontSize: 28, fontWeight: 700, color: C.green, fontFamily: 'Fraunces, Georgia, serif' }}>{resumo.pessoas_cobertura_completa}</div><div style={subLabel}>completas</div></div>
                  <div><div style={{ fontSize: 28, fontWeight: 700, color: resumo.pessoas_com_gap > 0 ? C.red : C.muted, fontFamily: 'Fraunces, Georgia, serif' }}>{resumo.pessoas_com_gap}</div><div style={subLabel}>com gap</div></div>
                </div>
              </div>
              <div data-ajuda="ehs.cockpit.alertas" style={cardStyle}>
                <div style={cardTitulo}>Alertas de EPI (CA) <AjudaCampo chave="ehs.cockpit.alertas" /></div>
                <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                  <div><div style={{ fontSize: 28, fontWeight: 700, color: resumo.epis_ca_vencido > 0 ? C.red : C.muted, fontFamily: 'Fraunces, Georgia, serif' }}>{resumo.epis_ca_vencido}</div><div style={subLabel}>CA vencido</div></div>
                  <div><div style={{ fontSize: 28, fontWeight: 700, color: resumo.epis_ca_vencendo_30d > 0 ? C.amber : C.muted, fontFamily: 'Fraunces, Georgia, serif' }}>{resumo.epis_ca_vencendo_30d}</div><div style={subLabel}>vence em 30d</div></div>
                </div>
              </div>
            </section>

            {/* Atalhos para as matrizes */}
            <section style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
              {ATALHOS.map((a) => (
                <Link key={a.rota} href={a.rota} style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>{a.nome}</Link>
              ))}
            </section>

            {/* Empty state didático */}
            {semMatriz && (
              <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', borderLeft: `3px solid ${C.gold}` }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: C.espresso, margin: '0 0 4px' }}>A matriz SST ainda não está mapeada</p>
                <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px' }}>Comece cadastrando os riscos de cada setor — depois os EPIs e treinamentos herdam para as pessoas automaticamente.</p>
                <Link href="/dashboard/ehs/matriz/risco-setor" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, background: C.espresso, color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Começar pela Matriz de Risco por Setor →</Link>
              </div>
            )}

            {/* Semáforo por setor */}
            <div data-ajuda="ehs.cockpit.semaforo">
              <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.muted, margin: '0 0 12px' }}>
                Semáforo por setor <AjudaCampo chave="ehs.cockpit.semaforo" />
              </h2>
              {setoresVisiveis.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: C.muted, backgroundColor: 'white', borderRadius: 12 }}>Nenhum setor corresponde à busca.</div>
              ) : (
                <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                  {setoresVisiveis.map((s) => (
                    <div key={s.setor_id} style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', borderLeft: `3px solid ${corCobertura(s.cobertura)}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontWeight: 700, color: C.espresso, fontSize: 15 }}>{semaforo(s.cobertura)} {s.setor_nome}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: corCobertura(s.cobertura), backgroundColor: bgCobertura(s.cobertura), padding: '2px 10px', borderRadius: 999 }}>{rotuloCobertura(s.cobertura)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.muted, marginBottom: 10 }}>
                        <span><strong style={{ color: C.espresso }}>{s.n_postos}</strong> postos</span>
                        <span><strong style={{ color: C.espresso }}>{s.n_pessoas}</strong> pessoas</span>
                        <span><strong style={{ color: s.n_riscos > 0 ? C.espresso : C.red }}>{s.n_riscos}</strong> riscos</span>
                        <span><strong style={{ color: C.espresso }}>{s.postos_com_epi}/{s.n_postos}</strong> c/ EPI</span>
                        <span><strong style={{ color: C.espresso }}>{s.postos_com_treino}/{s.n_postos}</strong> c/ treino</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Link href="/dashboard/ehs/matriz/risco-setor" style={miniLink(s.n_riscos === 0)}>Riscos</Link>
                        <Link href="/dashboard/ehs/matriz/epi-posto" style={miniLink(s.n_postos > 0 && s.postos_com_epi < s.n_postos)}>EPIs</Link>
                        <Link href="/dashboard/ehs/matriz/treinamento-posto" style={miniLink(s.n_postos > 0 && s.postos_com_treino < s.n_postos)}>Treinamentos</Link>
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Kpi({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.espresso, fontFamily: 'Fraunces, Georgia, serif' }}>{valor}</div>
      <div style={subLabel}>{rotulo}</div>
    </div>
  )
}

function LinhaCobertura({ rotulo, n, d }: { rotulo: string; n: number; d: number }) {
  const p = pct(n, d)
  const cor = p >= 100 ? C.green : p > 0 ? C.amber : C.red
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: C.muted }}>{rotulo}</span>
        <span style={{ color: C.espresso, fontWeight: 600 }}>{n}/{d} · {p}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: C.beigeLt, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: cor }} />
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const subLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }
const cardStyle: React.CSSProperties = { backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }
const cardTitulo: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.espresso, textTransform: 'uppercase', letterSpacing: 0.5 }
function inputStyle() { return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as any }
function miniLink(destaque: boolean) {
  return { padding: '4px 10px', borderRadius: 6, border: `1px solid ${destaque ? C.gold : C.borderLt}`, backgroundColor: destaque ? C.gold + '14' : 'white', color: C.espresso, fontSize: 11, fontWeight: 600, textDecoration: 'none' } as any
}
