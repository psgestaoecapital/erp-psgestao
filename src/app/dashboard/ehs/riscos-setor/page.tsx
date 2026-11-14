// src/app/dashboard/ehs/riscos-setor/page.tsx
// PS EHS · Onda S1.1 — Riscos ocupacionais por SETOR (GRO/PGR, NR-1/NR-9)
// O risco cadastrado no setor vale para todos os postos e funcionários dele (herança).
// Backend existente: prod_setor (setores operacionais) + prod_setor_risco (RLS por empresa).
// Acesso direto RLS-scoped (company_id IN get_user_company_ids()), como as demais telas EHS.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  red: '#dc2626',
  redBg: '#fce8e8',
}

// Agentes de risco ocupacional (GRO/PGR, NR-9). Valor guardado = minúsculo sem acento (compatível
// com os dados já existentes: fisico/quimico/biologico). Rótulo e cor só para exibição.
const TIPOS = [
  { v: 'fisico', rotulo: 'Físico', cor: '#2563eb', bg: '#e8f0fe' },
  { v: 'quimico', rotulo: 'Químico', cor: '#b45309', bg: '#fdf0e1' },
  { v: 'biologico', rotulo: 'Biológico', cor: '#15803d', bg: '#e7f6ec' },
  { v: 'ergonomico', rotulo: 'Ergonômico', cor: '#7c3aed', bg: '#f1eafe' },
  { v: 'acidente', rotulo: 'Acidente / Mecânico', cor: '#dc2626', bg: '#fce8e8' },
] as const

const tipoInfo = (v: string | null) =>
  TIPOS.find((t) => t.v === (v || '').toLowerCase()) ?? { v: v || '', rotulo: v || '—', cor: C.muted, bg: C.beigeLt }

type Setor = { id: string; company_id: string | null; nome: string; ordem: number | null; ativo: boolean }
type Risco = { id: string; company_id: string | null; setor_id: string; tipo: string | null; descricao: string | null; grau: string | null }

export default function RiscosPorSetorPage() {
  const { companyIds, companies } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const multiEmpresa = (companyIds?.length ?? 0) > 1
  const [companyAlvo, setCompanyAlvo] = useState<string>('')

  useEffect(() => {
    if (!companyAlvo && companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0])
  }, [companyIds, companyAlvo])

  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa')
    return m
  }, [companies])

  const [setores, setSetores] = useState<Setor[]>([])
  const [riscos, setRiscos] = useState<Risco[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [editando, setEditando] = useState<Risco | null>(null)
  const [novoNoSetor, setNovoNoSetor] = useState<string | null>(null) // setor_id ao criar

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setSetores([]); setRiscos([]); return }
      const [s, r] = await Promise.all([
        supabase
          .from('prod_setor')
          .select('id, company_id, nome, ordem, ativo')
          .in('company_id', ids)
          .eq('ativo', true)
          .order('nome', { ascending: true }),
        supabase
          .from('prod_setor_risco')
          .select('id, company_id, setor_id, tipo, descricao, grau')
          .in('company_id', ids),
      ])
      if (s.error) throw s.error
      if (r.error) throw r.error
      setSetores((s.data || []) as Setor[])
      setRiscos((r.data || []) as Risco[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar riscos por setor')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const riscosPorSetor = useMemo(() => {
    const m = new Map<string, Risco[]>()
    for (const r of riscos) {
      if (filtroTipo && (r.tipo || '').toLowerCase() !== filtroTipo) continue
      const arr = m.get(r.setor_id) || []
      arr.push(r)
      m.set(r.setor_id, arr)
    }
    return m
  }, [riscos, filtroTipo])

  const setoresVisiveis = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return setores.filter((s) => {
      if (!q) return true
      if (s.nome.toLowerCase().includes(q)) return true
      // também acha pelo texto do risco
      return (riscosPorSetor.get(s.id) || []).some((r) => (r.descricao || '').toLowerCase().includes(q))
    })
  }, [setores, busca, riscosPorSetor])

  const totalRiscos = useMemo(
    () => (filtroTipo ? riscos.filter((r) => (r.tipo || '').toLowerCase() === filtroTipo).length : riscos.length),
    [riscos, filtroTipo],
  )

  async function excluir(r: Risco) {
    const setorNome = setores.find((s) => s.id === r.setor_id)?.nome || 'setor'
    if (!confirm(`Excluir o risco "${tipoInfo(r.tipo).rotulo}${r.descricao ? ' · ' + r.descricao : ''}" do setor ${setorNome}?`)) return
    try {
      const { error } = await supabase.from('prod_setor_risco').delete().eq('id', r.id)
      if (error) throw error
      carregar()
    } catch (e: any) {
      alert(e?.message || 'Falha ao excluir')
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · GRO / PGR</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Riscos por Setor</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 640 }}>
              O risco ocupacional cadastrado aqui no setor vale para <strong>todos os postos e funcionários</strong> dele.
              É a base do inventário de riscos (GRO) e do PGR.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              ← Voltar
            </Link>
            <button
              onClick={() => setNovoNoSetor(setoresVisiveis[0]?.id || setores[0]?.id || '')}
              disabled={!companyAlvo || setores.length === 0}
              style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo && setores.length ? 'pointer' : 'not-allowed', opacity: companyAlvo && setores.length ? 1 : 0.5 }}
            >
              + Novo risco
            </button>
          </div>
        </header>

        {erro && (
          <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>
        )}

        {/* Empresa-alvo (grupo) */}
        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <div data-ajuda="ehs.riscos_setor.empresa">
              <label style={labelStyle}>Empresa <AjudaCampo chave="ehs.riscos_setor.empresa" /></label>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={{ ...inputStyle(), maxWidth: 280 }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </div>
          </section>
        )}

        {/* Filtros */}
        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div data-ajuda="ehs.riscos_setor.busca" style={{ flex: '1 1 260px' }}>
            <label style={labelStyle}>Buscar <AjudaCampo chave="ehs.riscos_setor.busca" /></label>
            <input type="text" placeholder="Setor ou descrição do risco…" value={busca} onChange={(e) => setBusca(e.target.value)} style={inputStyle()} />
          </div>
          <div data-ajuda="ehs.riscos_setor.filtro_tipo" style={{ flex: '0 1 220px' }}>
            <label style={labelStyle}>Tipo de agente <AjudaCampo chave="ehs.riscos_setor.filtro_tipo" /></label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={inputStyle()}>
              <option value="">Todos os tipos</option>
              {TIPOS.map((t) => (<option key={t.v} value={t.v}>{t.rotulo}</option>))}
            </select>
          </div>
          <div style={{ fontSize: 13, color: C.muted, paddingBottom: 8 }}>
            {totalRiscos} risco{totalRiscos === 1 ? '' : 's'} · {setores.length} setor{setores.length === 1 ? '' : 'es'}
          </div>
        </section>

        {/* Lista por setor */}
        {loading && (<div style={{ padding: 32, textAlign: 'center', color: C.muted }}>Carregando…</div>)}

        {!loading && setores.length === 0 && (
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 32, textAlign: 'center', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.espresso, margin: '0 0 6px' }}>Nenhum setor cadastrado ainda</p>
            <p style={{ fontSize: 13, color: C.muted, margin: '0 0 14px' }}>Cadastre os setores da empresa para então mapear os riscos de cada um.</p>
            <Link href="/dashboard/ehs/setores" style={{ display: 'inline-block', padding: '10px 16px', borderRadius: 8, backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              Cadastrar setores →
            </Link>
          </div>
        )}

        {!loading && setores.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {setoresVisiveis.map((s) => {
              const rs = (riscosPorSetor.get(s.id) || []).slice().sort((a, b) => tipoInfo(a.tipo).rotulo.localeCompare(tipoInfo(b.tipo).rotulo))
              return (
                <section key={s.id} style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: rs.length ? `1px solid ${C.borderLt}` : 'none', backgroundColor: C.beigeLt }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontWeight: 700, color: C.espresso, fontSize: 15 }}>{s.nome}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{rs.length} risco{rs.length === 1 ? '' : 's'}</span>
                    </div>
                    <button onClick={() => setNovoNoSetor(s.id)} style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      + Risco
                    </button>
                  </div>
                  {rs.length === 0 ? (
                    <div style={{ padding: '14px 16px', fontSize: 13, color: C.muted }}>
                      Nenhum risco mapeado neste setor ainda. Use <strong>+ Risco</strong> para incluir.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {rs.map((r, i) => {
                            const ti = tipoInfo(r.tipo)
                            return (
                              <tr key={r.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                                <td style={{ padding: '10px 16px', width: 160, verticalAlign: 'top' }}>
                                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: ti.cor, backgroundColor: ti.bg }}>{ti.rotulo}</span>
                                </td>
                                <td style={{ padding: '10px 16px', verticalAlign: 'top', color: r.descricao ? C.ink : C.muted }}>{r.descricao || '—'}</td>
                                <td style={{ padding: '10px 16px', width: 120, verticalAlign: 'top', color: r.grau ? C.ink : C.muted }}>{r.grau || '—'}</td>
                                <td style={{ padding: '10px 16px', width: 150, verticalAlign: 'top' }}>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => setEditando(r)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Editar</button>
                                    <button onClick={() => excluir(r)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.red}30`, backgroundColor: 'white', color: C.red, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Excluir</button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )
            })}
            {setoresVisiveis.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum setor corresponde à busca.</div>
            )}
          </div>
        )}
      </div>

      {(novoNoSetor !== null || editando) && companyAlvo && (
        <RiscoFormModal
          companyId={editando?.company_id || companyAlvo}
          setores={setores}
          setorInicial={editando ? editando.setor_id : (novoNoSetor || setores[0]?.id || '')}
          risco={editando || undefined}
          onClose={() => { setEditando(null); setNovoNoSetor(null) }}
          onSaved={() => { setEditando(null); setNovoNoSetor(null); carregar() }}
        />
      )}
    </div>
  )
}

function RiscoFormModal({
  companyId, setores, setorInicial, risco, onClose, onSaved,
}: {
  companyId: string
  setores: Setor[]
  setorInicial: string
  risco?: Risco
  onClose: () => void
  onSaved: () => void
}) {
  const [setorId, setSetorId] = useState(risco?.setor_id || setorInicial || '')
  const [tipo, setTipo] = useState(risco?.tipo || 'fisico')
  const [descricao, setDescricao] = useState(risco?.descricao || '')
  const [grau, setGrau] = useState(risco?.grau || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!setorId) { setErro('Selecione o setor'); return }
    if (!tipo) { setErro('Selecione o tipo de agente'); return }
    if (!descricao.trim()) { setErro('Descreva o risco'); return }
    setSalvando(true)
    setErro(null)
    try {
      if (risco?.id) {
        const { error } = await supabase
          .from('prod_setor_risco')
          .update({ setor_id: setorId, tipo, descricao: descricao.trim(), grau: grau.trim() || null })
          .eq('id', risco.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('prod_setor_risco')
          .insert({ company_id: companyId, setor_id: setorId, tipo, descricao: descricao.trim(), grau: grau.trim() || null })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(460px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 14px' }}>
          {risco?.id ? 'Editar risco do setor' : 'Novo risco do setor'}
        </h3>
        {erro && (<div style={{ backgroundColor: '#fce8e8', color: '#dc2626', padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>)}

        <div data-ajuda="ehs.riscos_setor.setor" style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Setor <AjudaCampo chave="ehs.riscos_setor.setor" /></label>
          <select value={setorId} onChange={(e) => setSetorId(e.target.value)} style={inputStyle()}>
            <option value="">Selecione…</option>
            {setores.map((s) => (<option key={s.id} value={s.id}>{s.nome}</option>))}
          </select>
        </div>

        <div data-ajuda="ehs.riscos_setor.tipo" style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Tipo de agente <AjudaCampo chave="ehs.riscos_setor.tipo" /></label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle()}>
            {TIPOS.map((t) => (<option key={t.v} value={t.v}>{t.rotulo}</option>))}
          </select>
        </div>

        <div data-ajuda="ehs.riscos_setor.descricao" style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Descrição do risco <AjudaCampo chave="ehs.riscos_setor.descricao" /></label>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 64 }} placeholder="Ex.: Ruído contínuo acima de 85 dB(A); frio (câmara); agentes biológicos no abate" />
        </div>

        <div data-ajuda="ehs.riscos_setor.grau" style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Grau / nível de exposição (opcional) <AjudaCampo chave="ehs.riscos_setor.grau" /></label>
          <input value={grau} onChange={(e) => setGrau(e.target.value)} style={inputStyle()} placeholder="Ex.: insalubridade 20%, 40%; ou nível técnico medido" />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !setorId || !descricao.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && setorId && descricao.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && setorId && descricao.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (risco?.id ? 'Salvar' : 'Incluir risco')}
          </button>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
}

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as any
}
