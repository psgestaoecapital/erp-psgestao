// src/app/dashboard/compliance/epi/fichas/page.tsx
// Lista de fichas EPI: cards de funcionarios com qtd EPIs em uso e status.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  yellow: '#eab308',
  red: '#dc2626',
}

interface FichaRow {
  funcionario_id: string
  funcionario_nome: string
  cpf: string | null
  cargo: string | null
  setor: string | null
  vinculo_tipo: string | null
  prestador_id: string | null
  prestador_nome: string | null
  total_epis_uso: number | null
  ultima_movimentacao: string | null
  status_geral: string | null
  company_id: string
}

export default function FichasEpiPage() {
  const { companyIds } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])

  const [fichas, setFichas] = useState<FichaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroSetor, setFiltroSetor] = useState('')
  const [filtroVinculo, setFiltroVinculo] = useState<'' | 'direto' | 'terceirizado'>('')

  const carregar = useCallback(async () => {
    if (!companyIdsKey) return
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey.split(',').filter(Boolean)
      const { data, error } = await supabase
        .from('v_epi_ficha_funcionario')
        .select('*')
        .in('company_id', ids)
        .order('funcionario_nome')
      if (error) throw error
      setFichas((data || []) as FichaRow[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar fichas')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const setores = useMemo(() => Array.from(new Set(fichas.map((f) => f.setor).filter(Boolean) as string[])).sort(), [fichas])

  const fichasFiltradas = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return fichas.filter((f) => {
      if (filtroSetor && f.setor !== filtroSetor) return false
      if (filtroVinculo && f.vinculo_tipo !== filtroVinculo) return false
      if (q) {
        const hay = `${f.funcionario_nome} ${f.cpf || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [fichas, busca, filtroSetor, filtroVinculo])

  function statusCor(s: string | null): string {
    if (s === 'critico') return C.red
    if (s === 'atencao') return C.yellow
    return C.green
  }

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EPI</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Fichas de EPI</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{fichasFiltradas.length} de {fichas.length} funcionários</p>
          </div>
          <Link href="/dashboard/compliance/epi" style={btnSec}>← EPI</Link>
        </header>

        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>}

        <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input type="text" placeholder="Buscar por nome ou CPF…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...inputStyle, flex: '1 1 240px' }} />
          <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} style={{ ...inputStyle, minWidth: 160 }}>
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filtroVinculo} onChange={(e) => setFiltroVinculo(e.target.value as any)} style={{ ...inputStyle, minWidth: 160 }}>
            <option value="">Todos os vínculos</option>
            <option value="direto">Direto</option>
            <option value="terceirizado">Terceirizado</option>
          </select>
        </section>

        {loading ? (
          <p style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Carregando…</p>
        ) : fichasFiltradas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: C.muted, background: '#FFFFFF', borderRadius: 12 }}>
            Nenhum funcionário cadastrado ainda. Use o módulo Funcionários do Compliance.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {fichasFiltradas.map((f) => {
              const cor = statusCor(f.status_geral)
              const iniciais = f.funcionario_nome.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()
              return (
                <Link key={f.funcionario_id} href={`/dashboard/compliance/epi/ficha/${f.funcionario_id}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', borderLeft: `4px solid ${cor}`, transition: 'transform 150ms', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 38, background: C.beigeLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: C.espresso, fontSize: 13 }}>{iniciais || '?'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: C.espresso, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.funcionario_nome}</div>
                        {f.cpf && <div style={{ fontSize: 11, color: C.muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{f.cpf}</div>}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: C.espressoLt, marginBottom: 4 }}>
                      {f.cargo || '—'} {f.setor && <>· {f.setor}</>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      {f.vinculo_tipo === 'terceirizado' ? (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: C.gold + '22', color: C.gold, fontWeight: 700 }}>TERCEIRIZADO</span>
                      ) : (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: C.green + '22', color: C.green, fontWeight: 700 }}>DIRETO</span>
                      )}
                      {f.prestador_nome && <span style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.prestador_nome}</span>}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: `1px solid ${C.borderLt}` }}>
                      <div>
                        <span style={{ fontSize: 22, fontWeight: 700, color: C.espresso }}>{f.total_epis_uso || 0}</span>
                        <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>EPIs em uso</span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: cor, textTransform: 'uppercase' }}>{f.status_geral || 'ok'}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#FAF7F2', border: '1px solid #ece3d2', borderRadius: 8, fontSize: 13, color: '#1a1a1a', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
const btnSec: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, border: '1px solid #ece3d2', background: '#FFFFFF', color: '#3D2314', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }
