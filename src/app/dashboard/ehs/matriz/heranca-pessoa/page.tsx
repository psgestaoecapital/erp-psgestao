// src/app/dashboard/ehs/matriz/heranca-pessoa/page.tsx
// PS EHS · Onda S1.4 — HERANÇA POR PESSOA · piloto DEMO (bucket ehs_completo)
// SETOR -> POSTO -> PESSOA: cada pessoa herda os riscos do setor + os EPIs e treinamentos do posto, sem
// recadastro. Lê da VIEW v_ehs_heranca_pessoa (security_invoker: respeita a RLS por empresa).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8',
  borderLt: '#ece3d2', ink: '#1a1a1a', muted: 'rgba(61, 35, 20, 0.55)', green: '#16a34a',
  red: '#dc2626', redBg: '#fce8e8', amber: '#C8941A', blue: '#2563eb',
}

type Risco = { tipo: string | null; descricao: string | null; grau: string | null }
type Epi = { nome: string | null; ca: string | null; obrigatorio: boolean | null }
type Treino = { nr: string | null; nome: string | null; obrigatorio: boolean | null; reciclagem_meses: number | null }
type Heranca = {
  company_id: string; vinculo_id: string; funcionario_id: string | null; cpf: string | null; funcionario_nome: string | null
  posto_id: string; posto_numero: string | null; posto_atividade: string | null; setor_id: string | null; setor_nome: string | null
  n_riscos: number; riscos: Risco[] | null; n_epis: number; epis: Epi[] | null; n_treinamentos: number; treinamentos: Treino[] | null
}

const fmtCpf = (cpf: string | null) => {
  if (!cpf) return '—'
  const d = cpf.replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf
}
const nomePessoa = (h: Heranca) => h.funcionario_nome?.trim() || `CPF ${fmtCpf(h.cpf)}`
const grauCor = (g: string | null) => (g === 'alto' ? C.red : g === 'medio' ? C.amber : C.muted)
const grauBg = (g: string | null) => (g === 'alto' ? C.redBg : g === 'medio' ? C.gold + '18' : C.beigeLt)
const reciclagemLabel = (m: number | null) => (m == null ? null : m >= 12 && m % 12 === 0 ? `${m / 12} ano${m === 12 ? '' : 's'}` : `${m} meses`)

export default function HerancaPessoaPage() {
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

  const [linhas, setLinhas] = useState<Heranca[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroSetor, setFiltroSetor] = useState<string>('')

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setLinhas([]); return }
      const alvo = multiEmpresa && companyAlvo ? [companyAlvo] : ids
      const { data, error } = await supabase.from('v_ehs_heranca_pessoa').select('*').in('company_id', alvo)
      if (error) throw error
      setLinhas((data || []) as Heranca[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar a herança por pessoa')
    } finally { setLoading(false) }
  }, [companyIdsKey, companyAlvo, multiEmpresa])

  useEffect(() => { carregar() }, [carregar])

  const setoresComPessoa = useMemo(() => {
    const m = new Map<string, string>()
    for (const h of linhas) if (h.setor_id) m.set(h.setor_id, h.setor_nome || '—')
    return [...m.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [linhas])

  const visiveis = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return linhas
      .filter((h) => !filtroSetor || h.setor_id === filtroSetor)
      .filter((h) => {
        if (!q) return true
        return `${nomePessoa(h)} ${h.cpf || ''} ${h.posto_numero || ''} ${h.posto_atividade || ''} ${h.setor_nome || ''}`.toLowerCase().includes(q)
      })
      .sort((a, b) => `${a.setor_nome || ''}${a.posto_numero || ''}${nomePessoa(a)}`.localeCompare(`${b.setor_nome || ''}${b.posto_numero || ''}${nomePessoa(b)}`))
  }, [linhas, filtroSetor, busca])

  const resumo = useMemo(() => ({
    pessoas: linhas.length,
    comRisco: linhas.filter((h) => h.n_riscos > 0).length,
    comEpi: linhas.filter((h) => h.n_epis > 0).length,
    comTreino: linhas.filter((h) => h.n_treinamentos > 0).length,
  }), [linhas])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Herança</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Herança por Pessoa</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 700 }}>
              Cada pessoa <strong>herda</strong> automaticamente os <strong>riscos do setor</strong> e os <strong>EPIs e treinamentos do posto</strong> —
              você cadastra uma vez no setor/posto e todas as pessoas herdam, <strong>sem recadastrar</strong>.
            </p>
          </div>
          <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
        </header>

        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>)}

        {/* Contadores */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Contador rotulo="Pessoas" valor={resumo.pessoas} />
          <Contador rotulo="Herdam risco" valor={resumo.comRisco} cor={C.red} />
          <Contador rotulo="Herdam EPI" valor={resumo.comEpi} cor={C.blue} />
          <Contador rotulo="Herdam treinamento" valor={resumo.comTreino} cor={C.green} />
        </section>

        {/* Filtros */}
        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {multiEmpresa && (
            <div data-ajuda="ehs.heranca_pessoa.empresa" style={{ flex: '0 1 240px' }}>
              <label style={labelStyle}>Empresa <AjudaCampo chave="ehs.heranca_pessoa.empresa" /></label>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={inputStyle()}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </div>
          )}
          <div data-ajuda="ehs.heranca_pessoa.busca" style={{ flex: '1 1 260px' }}>
            <label style={labelStyle}>Buscar <AjudaCampo chave="ehs.heranca_pessoa.busca" /></label>
            <input type="text" placeholder="Nome, CPF, posto ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)} style={inputStyle()} />
          </div>
          <div data-ajuda="ehs.heranca_pessoa.setor" style={{ flex: '0 1 220px' }}>
            <label style={labelStyle}>Setor <AjudaCampo chave="ehs.heranca_pessoa.setor" /></label>
            <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} style={inputStyle()}>
              <option value="">Todos os setores</option>
              {setoresComPessoa.map((s) => (<option key={s.id} value={s.id}>{s.nome}</option>))}
            </select>
          </div>
        </section>

        {loading && (<div style={{ padding: 32, textAlign: 'center', color: C.muted }}>Carregando…</div>)}

        {!loading && linhas.length === 0 && (
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 32, textAlign: 'center', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.espresso, margin: '0 0 6px' }}>Nenhuma pessoa alocada ainda</p>
            <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Aloque pessoas aos postos para ver aqui a herança de riscos, EPIs e treinamentos.</p>
          </div>
        )}

        {!loading && linhas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {visiveis.map((h) => (
              <section key={h.vinculo_id} style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.borderLt}`, backgroundColor: C.beigeLt, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: C.espresso, fontSize: 15 }}>{nomePessoa(h)}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>{h.setor_nome || '—'} · Posto {h.posto_numero || '—'}{h.posto_atividade ? ` · ${h.posto_atividade}` : ''}</span>
                  </div>
                  <span data-ajuda="ehs.heranca_pessoa.heranca" style={{ fontSize: 11, fontWeight: 700, color: C.gold, backgroundColor: C.gold + '18', padding: '2px 8px', borderRadius: 999 }}>
                    herda {h.n_riscos} risco{h.n_riscos === 1 ? '' : 's'} · {h.n_epis} EPI{h.n_epis === 1 ? '' : 's'} · {h.n_treinamentos} treinamento{h.n_treinamentos === 1 ? '' : 's'}
                    <AjudaCampo chave="ehs.heranca_pessoa.heranca" />
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 0 }}>
                  {/* Riscos */}
                  <BlocoHeranca titulo="🔴 Riscos do setor" vazio="Sem risco cadastrado no setor">
                    {(h.riscos || []).map((r, i) => (
                      <span key={i} style={{ fontSize: 11, fontWeight: 600, color: grauCor(r.grau), backgroundColor: grauBg(r.grau), padding: '3px 9px', borderRadius: 999 }} title={r.descricao || ''}>
                        {r.tipo || 'risco'}{r.grau ? ` · ${r.grau}` : ''}
                      </span>
                    ))}
                  </BlocoHeranca>
                  {/* EPIs */}
                  <BlocoHeranca titulo="🦺 EPIs do posto" vazio="Sem EPI definido no posto" borda>
                    {(h.epis || []).map((e, i) => (
                      <span key={i} style={{ fontSize: 11, fontWeight: 600, color: C.blue, backgroundColor: '#e8f0fe', padding: '3px 9px', borderRadius: 999 }} title={e.ca ? `CA ${e.ca}` : ''}>
                        {e.nome || 'EPI'}{e.obrigatorio === false ? ' (rec.)' : ''}
                      </span>
                    ))}
                  </BlocoHeranca>
                  {/* Treinamentos */}
                  <BlocoHeranca titulo="🎓 Treinamentos do posto" vazio="Sem treinamento definido no posto" borda>
                    {(h.treinamentos || []).map((t, i) => (
                      <span key={i} style={{ fontSize: 11, fontWeight: 600, color: C.green, backgroundColor: '#e7f6ec', padding: '3px 9px', borderRadius: 999 }}
                        title={[t.nome, reciclagemLabel(t.reciclagem_meses) ? `reciclagem ${reciclagemLabel(t.reciclagem_meses)}` : null].filter(Boolean).join(' · ')}>
                        {t.nr || 'NR'}{t.obrigatorio === false ? ' (rec.)' : ''}
                      </span>
                    ))}
                  </BlocoHeranca>
                </div>
              </section>
            ))}
            {visiveis.length === 0 && (<div style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhuma pessoa corresponde ao filtro.</div>)}
          </div>
        )}
      </div>
    </div>
  )
}

function Contador({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: cor || C.espresso, fontFamily: 'Fraunces, Georgia, serif' }}>{valor}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{rotulo}</div>
    </div>
  )
}

function BlocoHeranca({ titulo, vazio, borda, children }: { titulo: string; vazio: string; borda?: boolean; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children]
  const temItem = arr.some((c) => c)
  return (
    <div style={{ padding: '12px 16px', borderLeft: borda ? `1px solid ${C.borderLt}` : 'none' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.espresso, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{titulo}</div>
      {temItem ? (<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>) : (<div style={{ fontSize: 12, color: C.muted }}>{vazio}</div>)}
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
function inputStyle() { return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as any }
