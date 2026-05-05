// src/app/dashboard/compliance/epi/alertas/page.tsx
// Lista de alertas EPI ativos com acoes Resolver / Ignorar.

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

interface AlertaRow {
  id: string
  company_id: string
  tipo: string
  severidade: string | null
  titulo: string | null
  descricao: string | null
  funcionario_id: string | null
  funcionario_nome: string | null
  catalogo_id: string | null
  catalogo_nome: string | null
  status: string
  criado_em: string
  resolvido_em: string | null
}

const TIPO_LABEL: Record<string, string> = {
  ca_vencendo: 'CA vencendo',
  ca_vencido: 'CA vencido',
  troca_atrasada: 'Troca atrasada',
  estoque_critico: 'Estoque crítico',
  estoque_baixo: 'Estoque baixo',
  vida_util: 'Vida útil próxima',
}

const TIPO_ICON: Record<string, string> = {
  ca_vencendo: '📅',
  ca_vencido: '🚫',
  troca_atrasada: '⏰',
  estoque_critico: '📦',
  estoque_baixo: '📦',
  vida_util: '⏱️',
}

export default function AlertasEpiPage() {
  const { companyIds } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])

  const [alertas, setAlertas] = useState<AlertaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroSev, setFiltroSev] = useState<'' | 'critica' | 'alta' | 'media' | 'baixa'>('')
  const [filtroStatus, setFiltroStatus] = useState<'ativo' | 'resolvido' | 'ignorado' | ''>('ativo')
  const [actingId, setActingId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyIdsKey) return
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey.split(',').filter(Boolean)
      let q = supabase
        .from('epi_alerta')
        .select('id, company_id, tipo, severidade, titulo, descricao, funcionario_id, funcionario_nome, catalogo_id, catalogo_nome, status, criado_em, resolvido_em')
        .in('company_id', ids)
        .order('criado_em', { ascending: false })
        .limit(500)
      if (filtroStatus) q = q.eq('status', filtroStatus)
      const { data, error } = await q
      if (error) throw error
      setAlertas((data || []) as AlertaRow[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar alertas')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey, filtroStatus])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    if (!filtroSev) return alertas
    return alertas.filter((a) => a.severidade === filtroSev)
  }, [alertas, filtroSev])

  async function alterarStatus(id: string, novoStatus: 'resolvido' | 'ignorado') {
    setActingId(id)
    try {
      const patch: Record<string, any> = { status: novoStatus }
      if (novoStatus === 'resolvido') patch.resolvido_em = new Date().toISOString()
      const { error } = await supabase.from('epi_alerta').update(patch).eq('id', id)
      if (error) throw error
      await carregar()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao atualizar alerta')
    } finally {
      setActingId(null)
    }
  }

  function corSev(s: string | null): string {
    if (s === 'critica') return C.red
    if (s === 'alta') return C.red
    if (s === 'media') return C.yellow
    if (s === 'baixa') return C.green
    return C.gold
  }

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EPI</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Alertas</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{filtradas.length} alerta{filtradas.length === 1 ? '' : 's'} {filtroStatus || 'todos'}</p>
          </div>
          <Link href="/dashboard/compliance/epi" style={btnSec}>← EPI</Link>
        </header>

        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>}

        <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as any)} style={{ ...inputStyle, minWidth: 160 }}>
            <option value="ativo">Ativos</option>
            <option value="resolvido">Resolvidos</option>
            <option value="ignorado">Ignorados</option>
            <option value="">Todos</option>
          </select>
          <select value={filtroSev} onChange={(e) => setFiltroSev(e.target.value as any)} style={{ ...inputStyle, minWidth: 160 }}>
            <option value="">Todas as severidades</option>
            <option value="critica">Crítica</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>
        </section>

        {loading ? (
          <p style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Carregando…</p>
        ) : filtradas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: C.muted, background: '#FFFFFF', borderRadius: 12 }}>
            🎉 Nenhum alerta {filtroStatus === 'ativo' ? 'ativo' : ''}. Está tudo em conformidade.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtradas.map((a) => {
              const cor = corSev(a.severidade)
              return (
                <div key={a.id} style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', borderLeft: `4px solid ${cor}`, display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 12, alignItems: 'start' }}>
                  <div style={{ fontSize: 22, lineHeight: 1.1 }}>{TIPO_ICON[a.tipo] || '⚠️'}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: C.espresso }}>
                        {a.titulo || TIPO_LABEL[a.tipo] || a.tipo}
                      </span>
                      {a.severidade && (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: cor + '22', color: cor, fontWeight: 700, textTransform: 'uppercase' }}>
                          {a.severidade}
                        </span>
                      )}
                      {a.status !== 'ativo' && (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: C.borderLt, color: C.espressoLt, fontWeight: 700, textTransform: 'uppercase' }}>
                          {a.status}
                        </span>
                      )}
                    </div>
                    {a.descricao && <p style={{ fontSize: 13, color: C.espressoLt, margin: '6px 0 0', lineHeight: 1.5 }}>{a.descricao}</p>}
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {a.funcionario_nome && a.funcionario_id && (
                        <Link href={`/dashboard/compliance/epi/ficha/${a.funcionario_id}`} style={{ color: C.espressoLt, textDecoration: 'underline' }}>
                          👤 {a.funcionario_nome}
                        </Link>
                      )}
                      {a.catalogo_nome && <span>🛡️ {a.catalogo_nome}</span>}
                      <span>📅 {fmtDataHora(a.criado_em)}</span>
                    </div>
                  </div>
                  {a.status === 'ativo' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 110 }}>
                      <button onClick={() => alterarStatus(a.id, 'resolvido')} disabled={actingId === a.id} style={btnPri}>
                        {actingId === a.id ? '…' : '✓ Resolver'}
                      </button>
                      <button onClick={() => alterarStatus(a.id, 'ignorado')} disabled={actingId === a.id} style={btnSec}>
                        Ignorar
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function fmtDataHora(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

const inputStyle: React.CSSProperties = { padding: '9px 12px', background: '#FAF7F2', border: '1px solid #ece3d2', borderRadius: 8, fontSize: 13, color: '#1a1a1a', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
const btnSec: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #ece3d2', background: '#FFFFFF', color: '#3D2314', fontSize: 12, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }
const btnPri: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: 'none', background: '#3D2314', color: '#FFFFFF', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
