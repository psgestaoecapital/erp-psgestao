// src/app/dashboard/ehs/matriz/epi-posto/page.tsx
// PS EHS · Onda S1.2 — EPIs obrigatórios por POSTO (NR-6) · piloto DEMO (bucket ehs_completo)
// Marcar no posto quais EPIs são obrigatórios (do catálogo). Vale para todas as pessoas do posto (herança).
// Backend existente: prod_posto_epi (posto_id→prod_posto, catalogo_id→epi_catalogo) + epi_catalogo. RLS por empresa.
// Gancho S1.4: cada EPI mostra os riscos que protege (epi_catalogo.riscos_protege[]).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8',
  borderLt: '#ece3d2', ink: '#1a1a1a', muted: 'rgba(61, 35, 20, 0.55)', green: '#16a34a',
  red: '#dc2626', redBg: '#fce8e8', blue: '#2563eb',
}

type Setor = { id: string; nome: string }
type Posto = { id: string; company_id: string | null; numero: string | null; atividade: string | null; setor_id: string | null }
type Epi = { id: string; nome: string; ca_numero: string | null; ca_validade: string | null; riscos_protege: string[] | null; vida_util_meses: number | null }
type PostoEpi = { id: string; posto_id: string; catalogo_id: string; obrigatorio: boolean; observacao: string | null }

const vidaUtilLabel = (m: number | null) => (m == null ? null : m >= 12 && m % 12 === 0 ? `${m / 12} ano${m === 12 ? '' : 's'}` : `${m} ${m === 1 ? 'mês' : 'meses'}`)
const caLabel = (e: Epi) => (e.ca_numero ? `CA ${e.ca_numero}${e.ca_validade ? ' · val. ' + new Date(e.ca_validade).toLocaleDateString('pt-BR') : ''}` : 'sem CA')

export default function MatrizEpiPostoPage() {
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

  const [setores, setSetores] = useState<Map<string, string>>(new Map())
  const [postos, setPostos] = useState<Posto[]>([])
  const [epis, setEpis] = useState<Epi[]>([])
  const [postoEpi, setPostoEpi] = useState<PostoEpi[]>([])
  const [pessoasPorPosto, setPessoasPorPosto] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroSetor, setFiltroSetor] = useState<string>('')
  const [addNoPosto, setAddNoPosto] = useState<string | null>(null)

  const epiPorId = useMemo(() => { const m = new Map<string, Epi>(); for (const e of epis) m.set(e.id, e); return m }, [epis])

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setPostos([]); setEpis([]); setPostoEpi([]); return }
      const [po, s, cat, pe, pp] = await Promise.all([
        supabase.from('prod_posto').select('id, company_id, numero, atividade, setor_id').in('company_id', ids),
        supabase.from('prod_setor').select('id, nome').in('company_id', ids),
        supabase.from('epi_catalogo').select('id, nome, ca_numero, ca_validade, riscos_protege, vida_util_meses, ativo, company_id, is_global').eq('ativo', true).or(`company_id.in.(${ids.join(',')}),is_global.eq.true`),
        supabase.from('prod_posto_epi').select('id, posto_id, catalogo_id, obrigatorio, observacao').in('company_id', ids),
        supabase.from('prod_posto_pessoa').select('posto_id').in('company_id', ids),
      ])
      if (po.error) throw po.error
      if (pe.error) throw pe.error
      setPostos((po.data || []) as Posto[])
      const sm = new Map<string, string>(); for (const x of (s.data || []) as Setor[]) sm.set(x.id, x.nome); setSetores(sm)
      setEpis(((cat.data || []) as any[]).map((e) => ({ id: e.id, nome: e.nome, ca_numero: e.ca_numero, ca_validade: e.ca_validade, riscos_protege: e.riscos_protege, vida_util_meses: e.vida_util_meses })))
      setPostoEpi((pe.data || []) as PostoEpi[])
      const cont = new Map<string, number>()
      for (const v of (pp.data || []) as { posto_id: string }[]) cont.set(v.posto_id, (cont.get(v.posto_id) || 0) + 1)
      setPessoasPorPosto(cont)
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar os EPIs por posto')
    } finally { setLoading(false) }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const episDoPosto = useMemo(() => {
    const m = new Map<string, PostoEpi[]>()
    for (const pe of postoEpi) { const a = m.get(pe.posto_id) || []; a.push(pe); m.set(pe.posto_id, a) }
    return m
  }, [postoEpi])

  const postosVisiveis = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return postos
      .filter((p) => !filtroSetor || p.setor_id === filtroSetor)
      .filter((p) => {
        if (!q) return true
        const setorNome = (p.setor_id && setores.get(p.setor_id)) || ''
        return `${p.numero || ''} ${p.atividade || ''} ${setorNome}`.toLowerCase().includes(q)
      })
      .sort((a, b) => `${(a.setor_id && setores.get(a.setor_id)) || ''}${a.numero}`.localeCompare(`${(b.setor_id && setores.get(b.setor_id)) || ''}${b.numero}`))
  }, [postos, filtroSetor, busca, setores])

  async function remover(pe: PostoEpi) {
    const epi = epiPorId.get(pe.catalogo_id)
    if (!confirm(`Remover o EPI "${epi?.nome || 'EPI'}" deste posto?`)) return
    try {
      const { error } = await supabase.from('prod_posto_epi').delete().eq('id', pe.id)
      if (error) throw error
      setAviso('EPI removido do posto.'); carregar()
    } catch (e: any) { alert(e?.message || 'Falha ao remover') }
  }

  const setoresComPosto = useMemo(() => {
    const ids = new Set(postos.map((p) => p.setor_id).filter(Boolean) as string[])
    return [...ids].map((id) => ({ id, nome: setores.get(id) || '—' })).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [postos, setores])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · NR-6</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>EPIs por Posto</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 680 }}>
              Marque no posto quais EPIs são <strong>obrigatórios</strong> — eles passam a valer para
              <strong> todas as pessoas</strong> do posto (herança). Cada EPI mostra o CA e os riscos que protege.
            </p>
          </div>
          <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
        </header>

        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>)}
        {aviso && (<div style={{ backgroundColor: '#e7f6ec', color: C.green, padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{aviso}</div>)}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <div data-ajuda="ehs.epi_posto.empresa">
              <label style={labelStyle}>Empresa <AjudaCampo chave="ehs.epi_posto.empresa" /></label>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={{ ...inputStyle(), maxWidth: 280 }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </div>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div data-ajuda="ehs.epi_posto.busca" style={{ flex: '1 1 260px' }}>
            <label style={labelStyle}>Buscar <AjudaCampo chave="ehs.epi_posto.busca" /></label>
            <input type="text" placeholder="Posto, atividade ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)} style={inputStyle()} />
          </div>
          <div data-ajuda="ehs.epi_posto.filtro_setor" style={{ flex: '0 1 220px' }}>
            <label style={labelStyle}>Setor <AjudaCampo chave="ehs.epi_posto.filtro_setor" /></label>
            <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} style={inputStyle()}>
              <option value="">Todos os setores</option>
              {setoresComPosto.map((s) => (<option key={s.id} value={s.id}>{s.nome}</option>))}
            </select>
          </div>
        </section>

        {loading && (<div style={{ padding: 32, textAlign: 'center', color: C.muted }}>Carregando…</div>)}

        {!loading && postos.length === 0 && (
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 32, textAlign: 'center', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.espresso, margin: '0 0 6px' }}>Nenhum posto cadastrado ainda</p>
            <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Cadastre os postos de trabalho da empresa para então definir os EPIs de cada um.</p>
          </div>
        )}

        {!loading && postos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {postosVisiveis.map((p) => {
              const lista = episDoPosto.get(p.id) || []
              const pessoas = pessoasPorPosto.get(p.id) || 0
              const setorNome = (p.setor_id && setores.get(p.setor_id)) || '—'
              return (
                <section key={p.id} style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: lista.length ? `1px solid ${C.borderLt}` : 'none', backgroundColor: C.beigeLt, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: C.espresso, fontSize: 15 }}>Posto {p.numero || '—'} · {p.atividade || 'Sem atividade'}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{setorNome}</span>
                      <span data-ajuda="ehs.epi_posto.heranca" style={{ fontSize: 11, fontWeight: 700, color: C.gold, backgroundColor: C.gold + '18', padding: '2px 8px', borderRadius: 999 }}>
                        obrigatório para {pessoas} pessoa{pessoas === 1 ? '' : 's'}
                        <AjudaCampo chave="ehs.epi_posto.heranca" />
                      </span>
                    </div>
                    <button onClick={() => setAddNoPosto(p.id)} style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ EPI</button>
                  </div>
                  {lista.length === 0 ? (
                    <div style={{ padding: '14px 16px', fontSize: 13, color: C.muted }}>Nenhum EPI definido para este posto. Use <strong>+ EPI</strong> para incluir.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {lista.map((pe, i) => {
                        const epi = epiPorId.get(pe.catalogo_id)
                        return (
                          <div key={pe.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}`, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, color: C.espresso, fontSize: 14 }}>{epi?.nome || 'EPI'}</span>
                                {pe.obrigatorio
                                  ? <span style={{ fontSize: 10, fontWeight: 700, color: C.red, backgroundColor: C.redBg, padding: '2px 8px', borderRadius: 4 }}>OBRIGATÓRIO</span>
                                  : <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, backgroundColor: C.beigeLt, padding: '2px 8px', borderRadius: 4 }}>recomendado</span>}
                              </div>
                              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                                {epi ? caLabel(epi) : '—'}{epi?.vida_util_meses != null ? ` · troca a cada ${vidaUtilLabel(epi.vida_util_meses)}` : ''}
                              </div>
                              {/* Gancho S1.4: riscos que o EPI protege */}
                              {epi?.riscos_protege && epi.riscos_protege.length > 0 && (
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                                  <span style={{ fontSize: 10, color: C.muted, alignSelf: 'center' }}>protege de:</span>
                                  {epi.riscos_protege.map((r) => (
                                    <span key={r} style={{ fontSize: 10, fontWeight: 700, color: C.blue, backgroundColor: '#e8f0fe', padding: '2px 8px', borderRadius: 999 }}>{r}</span>
                                  ))}
                                </div>
                              )}
                              {pe.observacao && <div style={{ fontSize: 12, color: C.ink, marginTop: 4 }}>{pe.observacao}</div>}
                            </div>
                            <button onClick={() => remover(pe)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.red}30`, backgroundColor: 'white', color: C.red, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Remover</button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
            {postosVisiveis.length === 0 && (<div style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum posto corresponde à busca.</div>)}
          </div>
        )}
      </div>

      {addNoPosto && companyAlvo && (
        <EpiFormModal
          companyId={companyAlvo}
          postoId={addNoPosto}
          postoLabel={(() => { const p = postos.find((x) => x.id === addNoPosto); return p ? `Posto ${p.numero || '—'} · ${p.atividade || ''}` : 'posto' })()}
          epis={epis}
          jaNoPosto={new Set((episDoPosto.get(addNoPosto) || []).map((pe) => pe.catalogo_id))}
          onClose={() => setAddNoPosto(null)}
          onSaved={() => { setAddNoPosto(null); setAviso('EPI definido para o posto.'); carregar() }}
        />
      )}
    </div>
  )
}

function EpiFormModal({ companyId, postoId, postoLabel, epis, jaNoPosto, onClose, onSaved }: {
  companyId: string; postoId: string; postoLabel: string; epis: Epi[]; jaNoPosto: Set<string>
  onClose: () => void; onSaved: () => void
}) {
  const disponiveis = useMemo(() => epis.filter((e) => !jaNoPosto.has(e.id)).sort((a, b) => a.nome.localeCompare(b.nome)), [epis, jaNoPosto])
  const [catalogoId, setCatalogoId] = useState('')
  const [obrigatorio, setObrigatorio] = useState(true)
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const epiSel = epis.find((e) => e.id === catalogoId)

  async function salvar() {
    if (!catalogoId) { setErro('Selecione o EPI'); return }
    setSalvando(true); setErro(null)
    try {
      const { error } = await supabase.from('prod_posto_epi').insert({ company_id: companyId, posto_id: postoId, catalogo_id: catalogoId, obrigatorio, observacao: observacao.trim() || null })
      if (error) throw error
      onSaved()
    } catch (e: any) { setErro(e?.message || 'Falha ao salvar'); setSalvando(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(480px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 4px' }}>Novo EPI obrigatório</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: C.muted }}>{postoLabel}</p>
        {erro && (<div style={{ backgroundColor: '#fce8e8', color: '#dc2626', padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>)}

        <div data-ajuda="ehs.epi_posto.epi" style={{ marginBottom: 12 }}>
          <label style={labelStyle}>EPI do catálogo <AjudaCampo chave="ehs.epi_posto.epi" /></label>
          <select value={catalogoId} onChange={(e) => setCatalogoId(e.target.value)} style={inputStyle()}>
            <option value="">Selecione…</option>
            {disponiveis.map((e) => (<option key={e.id} value={e.id}>{e.nome}{e.ca_numero ? ` (CA ${e.ca_numero})` : ''}</option>))}
          </select>
          {epiSel && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
              {caLabel(epiSel)}{epiSel.vida_util_meses != null ? ` · troca a cada ${vidaUtilLabel(epiSel.vida_util_meses)}` : ''}
              {epiSel.riscos_protege && epiSel.riscos_protege.length > 0 && (
                <span> · protege de: {epiSel.riscos_protege.join(', ')}</span>
              )}
            </div>
          )}
        </div>

        <div data-ajuda="ehs.epi_posto.obrigatorio" style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Obrigatoriedade <AjudaCampo chave="ehs.epi_posto.obrigatorio" /></label>
          <select value={obrigatorio ? '1' : '0'} onChange={(e) => setObrigatorio(e.target.value === '1')} style={inputStyle()}>
            <option value="1">Obrigatório</option>
            <option value="0">Recomendado</option>
          </select>
        </div>

        <div data-ajuda="ehs.epi_posto.observacao" style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Observação (opcional) <AjudaCampo chave="ehs.epi_posto.observacao" /></label>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...inputStyle(), minHeight: 56 }} placeholder="Ex.: usar sob a luva de procedimento; trocar a cada turno" />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !catalogoId} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && catalogoId ? 'pointer' : 'not-allowed', opacity: !salvando && catalogoId ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : 'Definir EPI'}
          </button>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
function inputStyle() { return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as any }
