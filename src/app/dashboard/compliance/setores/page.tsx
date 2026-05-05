// src/app/dashboard/compliance/setores/page.tsx
// PR A1 — Gerenciamento de Setores
// Tabs: Globais (PS, read-only) | Meus Setores (CRUD com soft delete)
// Backend: tabela compliance_setores (RLS multi-tenant, ativo=false = soft delete)

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

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

type Setor = {
  id: string
  company_id: string | null
  nome: string
  slug: string
  descricao: string | null
  is_global: boolean
  ordem_exibicao: number | null
  ativo: boolean
  created_at?: string
}

export default function SetoresPage() {
  const { companyIds, companies } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const multiEmpresa = (companyIds?.length ?? 0) > 1
  // Empresa-alvo do CRUD (quando grupo, escolher qual)
  const [companyAlvo, setCompanyAlvo] = useState<string>('')

  useEffect(() => {
    if (!companyAlvo && companyIds && companyIds.length > 0) {
      setCompanyAlvo(companyIds[0])
    }
  }, [companyIds, companyAlvo])

  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa')
    return m
  }, [companies])

  const [aba, setAba] = useState<'globais' | 'meus'>('meus')
  const [setores, setSetores] = useState<Setor[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Setor | null>(null)
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      let query = supabase
        .from('compliance_setores')
        .select('id, company_id, nome, slug, descricao, is_global, ordem_exibicao, ativo, created_at')
        .order('is_global', { ascending: false })
        .order('ordem_exibicao', { ascending: true, nullsFirst: false })
        .order('nome', { ascending: true })
      if (ids.length > 0) {
        query = query.or(`is_global.eq.true,company_id.in.(${ids.join(',')})`)
      } else {
        query = query.eq('is_global', true)
      }
      const { data, error } = await query
      if (error) throw error
      setSetores((data || []) as Setor[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar setores')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const setoresFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return setores.filter((s) => {
      if (aba === 'globais' && !s.is_global) return false
      if (aba === 'meus' && s.is_global) return false
      // Soft delete: meus setores so mostra ativos por default
      if (aba === 'meus' && !s.ativo) return false
      if (q) {
        const hay = `${s.nome} ${s.descricao || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [setores, aba, busca])

  async function desativar(setor: Setor) {
    if (!confirm(`Desativar setor "${setor.nome}"? Funcionários ja vinculados continuam, mas ele nao aparece mais nas listas.`)) return
    try {
      const { error } = await supabase
        .from('compliance_setores')
        .update({ ativo: false })
        .eq('id', setor.id)
      if (error) throw error
      carregar()
    } catch (e: any) {
      alert(e?.message || 'Falha ao desativar')
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Setores</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
              Setores globais PS Gestão + setores personalizados da empresa
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href="/dashboard/compliance"
              style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
            >
              ← Voltar
            </Link>
            {aba === 'meus' && (
              <button
                onClick={() => setShowNovo(true)}
                disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}
              >
                + Novo setor
              </button>
            )}
          </div>
        </header>

        {erro && (
          <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            {erro}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}` }}>
          <TabBtn ativa={aba === 'globais'} onClick={() => setAba('globais')}>
            🌐 Globais (PS)
          </TabBtn>
          <TabBtn ativa={aba === 'meus'} onClick={() => setAba('meus')}>
            🏢 Meus setores
          </TabBtn>
        </div>

        {/* Aviso aba Globais */}
        {aba === 'globais' && (
          <div style={{ backgroundColor: C.beigeLt, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, color: C.espresso, borderLeft: `3px solid ${C.gold}` }}>
            Setores padrão da PS Gestão (somente leitura). Disponíveis para todas as empresas.
            Se você precisa de um setor diferente, crie em <strong>Meus setores</strong>.
          </div>
        )}

        {/* Empresa alvo (quando grupo, no aba Meus) */}
        {aba === 'meus' && multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Empresa-alvo para criar setores
            </label>
            <select
              value={companyAlvo}
              onChange={(e) => setCompanyAlvo(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240 }}
            >
              {(companyIds || []).map((id) => (
                <option key={id} value={id}>{empresaPorId.get(id) || id}</option>
              ))}
            </select>
          </section>
        )}

        {/* Busca */}
        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Buscar setor por nome ou descrição…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite }}
          />
        </section>

        {/* Lista */}
        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th>Nome</Th>
                  <Th>Slug</Th>
                  <Th>Descrição</Th>
                  {aba === 'meus' && multiEmpresa && <Th>Empresa</Th>}
                  {aba === 'meus' && <Th>Ações</Th>}
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && setoresFiltrados.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>
                    {aba === 'globais' ? 'Nenhum setor global ativo' : 'Você ainda não tem setores próprios. Crie um!'}
                  </td></tr>
                )}
                {setoresFiltrados.map((s, i) => (
                  <tr key={s.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <span style={{ fontWeight: 600, color: C.espresso }}>{s.nome}</span>
                      {s.is_global && (
                        <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.gold + '22', color: C.gold }}>
                          GLOBAL
                        </span>
                      )}
                    </Td>
                    <Td mono>{s.slug}</Td>
                    <Td>
                      <span style={{ color: s.descricao ? C.ink : C.muted }}>{s.descricao || '—'}</span>
                    </Td>
                    {aba === 'meus' && multiEmpresa && (
                      <Td>{empresaPorId.get(s.company_id || '') || '—'}</Td>
                    )}
                    {aba === 'meus' && (
                      <Td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setEditando(s)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => desativar(s)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.red}30`, backgroundColor: 'white', color: C.red, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                          >
                            Desativar
                          </button>
                        </div>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showNovo && companyAlvo && (
        <SetorFormModal
          companyId={companyAlvo}
          onClose={() => setShowNovo(false)}
          onSaved={() => {
            setShowNovo(false)
            carregar()
          }}
        />
      )}

      {editando && (
        <SetorFormModal
          companyId={editando.company_id || companyAlvo}
          setor={editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null)
            carregar()
          }}
        />
      )}
    </div>
  )
}

function SetorFormModal({
  companyId, setor, onClose, onSaved,
}: {
  companyId: string
  setor?: Setor
  onClose: () => void
  onSaved: () => void
}) {
  const [nome, setNome] = useState(setor?.nome || '')
  const [descricao, setDescricao] = useState(setor?.descricao || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function gerarSlug(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
  }

  async function salvar() {
    if (!nome.trim()) { setErro('Nome obrigatório'); return }
    setSalvando(true)
    setErro(null)
    try {
      if (setor?.id) {
        // UPDATE — slug nao muda
        const { error } = await supabase
          .from('compliance_setores')
          .update({ nome: nome.trim(), descricao: descricao.trim() || null })
          .eq('id', setor.id)
        if (error) throw error
      } else {
        // INSERT
        const slug = gerarSlug(nome)
        const { error } = await supabase
          .from('compliance_setores')
          .insert({
            company_id: companyId,
            nome: nome.trim(),
            slug,
            descricao: descricao.trim() || null,
            is_global: false,
            ativo: true,
          })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(420px, 92vw)' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>
          {setor?.id ? 'Editar setor' : 'Novo setor'}
        </h3>
        {erro && (
          <div style={{ backgroundColor: '#fce8e8', color: '#dc2626', padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>
        )}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Nome *</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} style={inputStyle()} placeholder="Ex: Almoxarifado" autoFocus />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Descrição (opcional)</label>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 60 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && nome.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (setor?.id ? 'Salvar' : 'Criar setor')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabBtn({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: ativa ? `2px solid ${C.gold}` : '2px solid transparent',
        color: ativa ? C.espresso : C.muted,
        fontSize: 13,
        fontWeight: ativa ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: C.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
}

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as any
}

function Th({ children }: { children: any }) {
  return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>)
}

function Td({ children, mono }: { children: any; mono?: boolean }) {
  return (<td style={{ padding: '10px 16px', verticalAlign: 'top', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>{children}</td>)
}
