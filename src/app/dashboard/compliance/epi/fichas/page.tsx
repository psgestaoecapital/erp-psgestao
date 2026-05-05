// src/app/dashboard/compliance/epi/fichas/page.tsx
// Lista de fichas EPI: cards de TODOS funcionarios ativos (LEFT JOIN)
// com qtd EPIs em uso, trocas atrasadas e situacao geral.
// Backend: v_epi_funcionarios_consolidado (substitui v_epi_ficha_funcionario INNER JOIN)

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
  gray: '#94a3b8',
}

interface FuncRow {
  funcionario_id: string
  company_id: string
  empresa: string | null
  nome_completo: string
  cpf: string | null
  cargo: string | null
  setor: string | null
  matricula: string | null
  vinculo_tipo: string | null
  prestador_id: string | null
  prestador_razao_social: string | null
  epis_em_uso: number | null
  epis_pendente_devolucao: number | null
  trocas_atrasadas: number | null
  trocas_proximas_30d: number | null
  ultima_movimentacao: string | null
  situacao_geral: 'sem_epi' | 'em_dia' | 'atencao' | 'critico' | string | null
}

const SITUACAO_META: Record<string, { label: string; cor: string; icone: string }> = {
  sem_epi: { label: 'Sem EPI', cor: '#94a3b8', icone: '⚪' },
  em_dia: { label: 'Em dia', cor: '#16a34a', icone: '🟢' },
  atencao: { label: 'Atenção', cor: '#eab308', icone: '🟡' },
  critico: { label: 'Crítico', cor: '#dc2626', icone: '🔴' },
}

export default function FichasEpiPage() {
  const { companyIds } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])

  const [linhas, setLinhas] = useState<FuncRow[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroSetor, setFiltroSetor] = useState('')
  const [filtroVinculo, setFiltroVinculo] = useState<'' | 'direto' | 'terceirizado'>('')
  const [filtroSituacao, setFiltroSituacao] = useState<'' | 'sem_epi' | 'em_dia' | 'atencao' | 'critico'>('')

  const carregar = useCallback(async () => {
    if (!companyIdsKey) return
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey.split(',').filter(Boolean)
      const { data, error } = await supabase
        .from('v_epi_funcionarios_consolidado')
        .select('*')
        .in('company_id', ids)
        .order('nome_completo')
      if (error) throw error
      setLinhas((data || []) as FuncRow[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar fichas')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const setores = useMemo(() => Array.from(new Set(linhas.map((f) => f.setor).filter(Boolean) as string[])).sort(), [linhas])

  const filtradas = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return linhas.filter((f) => {
      if (filtroSetor && f.setor !== filtroSetor) return false
      if (filtroVinculo && f.vinculo_tipo !== filtroVinculo) return false
      if (filtroSituacao && f.situacao_geral !== filtroSituacao) return false
      if (q) {
        const hay = `${f.nome_completo} ${f.cpf || ''} ${f.matricula || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [linhas, busca, filtroSetor, filtroVinculo, filtroSituacao])

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EPI</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Fichas de EPI</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{filtradas.length} de {linhas.length} funcionários</p>
          </div>
          <Link href="/dashboard/compliance/epi" style={btnSec}>← EPI</Link>
        </header>

        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>}

        <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input type="text" placeholder="Buscar por nome, CPF ou matrícula…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...inputStyle, flex: '1 1 240px' }} />
          <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} style={{ ...inputStyle, minWidth: 160 }}>
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filtroVinculo} onChange={(e) => setFiltroVinculo(e.target.value as any)} style={{ ...inputStyle, minWidth: 160 }}>
            <option value="">Todos os vínculos</option>
            <option value="direto">Direto</option>
            <option value="terceirizado">Terceirizado</option>
          </select>
          <select value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value as any)} style={{ ...inputStyle, minWidth: 160 }}>
            <option value="">Todas as situações</option>
            <option value="sem_epi">⚪ Sem EPI</option>
            <option value="em_dia">🟢 Em dia</option>
            <option value="atencao">🟡 Atenção</option>
            <option value="critico">🔴 Crítico</option>
          </select>
        </section>

        {loading ? (
          <p style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Carregando…</p>
        ) : filtradas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: C.muted, background: '#FFFFFF', borderRadius: 12 }}>
            {linhas.length === 0
              ? 'Nenhum funcionário ativo cadastrado. Use o módulo Funcionários do Compliance.'
              : 'Nenhum funcionário corresponde aos filtros selecionados.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {filtradas.map((f) => {
              const sit = SITUACAO_META[f.situacao_geral || 'sem_epi'] || SITUACAO_META.sem_epi
              const iniciais = f.nome_completo.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()
              const trocasAtr = f.trocas_atrasadas || 0
              const episUso = f.epis_em_uso || 0
              return (
                <Link key={f.funcionario_id} href={`/dashboard/compliance/epi/ficha/${f.funcionario_id}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', borderLeft: `4px solid ${sit.cor}`, transition: 'transform 150ms', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 38, background: C.beigeLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: C.espresso, fontSize: 13 }}>{iniciais || '?'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: C.espresso, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nome_completo}</div>
                        {f.cpf && <div style={{ fontSize: 11, color: C.muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{f.cpf}</div>}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: sit.cor, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{sit.icone} {sit.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.espressoLt, marginBottom: 6 }}>
                      {f.cargo || '—'}{f.setor && <> · {f.setor}</>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      {f.vinculo_tipo === 'terceirizado' ? (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: C.gold + '22', color: C.gold, fontWeight: 700 }}>TERCEIRIZADO</span>
                      ) : (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: C.green + '22', color: C.green, fontWeight: 700 }}>DIRETO</span>
                      )}
                      {f.prestador_razao_social && <span style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.prestador_razao_social}</span>}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: `1px solid ${C.borderLt}` }}>
                      <div>
                        <span style={{ fontSize: 22, fontWeight: 700, color: C.espresso }}>{episUso}</span>
                        <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>EPIs em uso</span>
                      </div>
                      {trocasAtr > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>⚠ {trocasAtr} atrasada{trocasAtr === 1 ? '' : 's'}</span>
                      )}
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
