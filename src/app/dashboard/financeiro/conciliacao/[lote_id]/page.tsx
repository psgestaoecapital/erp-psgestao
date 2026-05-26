'use client'

import { use as usePromise, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Lote {
  id: string
  nome: string
  tipo: string
  origem: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  status: string
  total_movimentos: number
  total_conciliados: number
  total_pendentes: number
  arquivo_nome: string | null
}

interface Movimento {
  id: string
  data_transacao: string
  valor: number
  descricao: string | null
  natureza: string | null
  status: string
  match_score: number | null
  match_origem: string | null
  lancamento_tabela: string | null
  lancamento_id: string | null
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.split('T')[0]
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

type StatusFiltro = 'todos' | 'pendente' | 'conciliado' | 'rejeitado' | 'sugerido'

export default function LotePage({ params }: { params: Promise<{ lote_id: string }> }) {
  const { lote_id } = usePromise(params)
  const router = useRouter()

  const [lote, setLote] = useState<Lote | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('todos')

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const [loteRes, movsRes] = await Promise.all([
        supabase.from('conciliacao_lote')
          .select('id, nome, tipo, origem, periodo_inicio, periodo_fim, status, total_movimentos, total_conciliados, total_pendentes, arquivo_nome')
          .eq('id', lote_id).maybeSingle(),
        supabase.from('conciliacao_movimento')
          .select('id, data_transacao, valor, descricao, natureza, status, match_score, match_origem, lancamento_tabela, lancamento_id')
          .eq('lote_id', lote_id)
          .order('data_transacao', { ascending: false })
          .limit(500),
      ])
      if (!ignore) {
        setLote((loteRes.data ?? null) as Lote | null)
        setMovimentos((movsRes.data ?? []) as Movimento[])
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [lote_id])

  const filtrados = useMemo(() => {
    if (statusFiltro === 'todos') return movimentos
    return movimentos.filter((m) => m.status === statusFiltro)
  }, [movimentos, statusFiltro])

  async function aplicarTodosOuro() {
    const ouro = movimentos.filter((m) => m.status === 'sugerido' && (m.match_score ?? 0) >= 0.8 && m.lancamento_id && m.lancamento_tabela)
    if (ouro.length === 0) return
    if (!confirm(`Aplicar match em ${ouro.length} movimento(s) com score OURO?`)) return
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { alert('Sessão expirada'); return }
    for (const m of ouro) {
      await supabase.rpc('fn_conciliacao_aplicar_match', {
        p_movimento_id: m.id,
        p_lancamento_tabela: m.lancamento_tabela!,
        p_lancamento_id: m.lancamento_id!,
        p_operador_id: operadorId,
        p_origem: 'massa',
      })
    }
    location.reload()
  }

  if (loading) {
    return <div style={infoBox}>Carregando lote…</div>
  }
  if (!lote) {
    return (
      <div style={{ ...infoBox, textAlign: 'center' }}>
        <div style={{ color: '#3D2314' }}>Lote não encontrado.</div>
        <button onClick={() => router.push('/dashboard/financeiro/conciliacao')} style={primaryBtn}>
          Voltar para conciliação
        </button>
      </div>
    )
  }

  const qtdOuro = movimentos.filter((m) => m.status === 'sugerido' && (m.match_score ?? 0) >= 0.8).length

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/financeiro/conciliacao')} style={backLink}>
          ← Conciliação
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
              {lote.nome}
            </h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
              {lote.tipo} · {lote.origem ?? '—'} · {fmtDate(lote.periodo_inicio)} a {fmtDate(lote.periodo_fim)}
              {lote.arquivo_nome ? ` · ${lote.arquivo_nome}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {qtdOuro > 0 && (
              <button onClick={aplicarTodosOuro} style={primaryBtn}>
                Aplicar todos OURO ({qtdOuro})
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Card label="Movimentos" valor={String(lote.total_movimentos)} cor="rgba(61,35,20,0.5)" />
          <Card label="Conciliados" valor={String(lote.total_conciliados)} cor="#3B6D11" />
          <Card label="Pendentes" valor={String(lote.total_pendentes)} cor="#BA7517" />
          <Card label="Status" valor={lote.status} cor="#3D2314" />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {(['todos', 'pendente', 'sugerido', 'conciliado', 'rejeitado'] as StatusFiltro[]).map((s) => (
            <button key={s} onClick={() => setStatusFiltro(s)} style={tab(statusFiltro === s)}>
              {s} {s !== 'todos' && `(${movimentos.filter((m) => m.status === s).length})`}
            </button>
          ))}
        </div>

        {filtrados.length === 0 ? (
          <div style={emptyBox}>Nenhum movimento neste filtro.</div>
        ) : (
          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(61,35,20,0.04)' }}>
                  <th style={th}>Data</th>
                  <th style={th}>Descrição</th>
                  <th style={th}>Natureza</th>
                  <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                  <th style={th}>Match</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((m, idx) => (
                  <tr key={m.id} style={{ borderTop: '0.5px solid rgba(61,35,20,0.08)', background: idx % 2 ? 'rgba(61,35,20,0.015)' : 'transparent' }}>
                    <td style={td}>{fmtDate(m.data_transacao)}</td>
                    <td style={td}>{m.descricao ?? '—'}</td>
                    <td style={{ ...td, color: 'rgba(61,35,20,0.65)', fontSize: 12 }}>{m.natureza ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Number(m.valor) < 0 ? '#A32D2D' : '#3B6D11', fontWeight: 600 }}>
                      R$ {fmt(m.valor)}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                      {m.match_score != null ? `${Number(m.match_score).toFixed(2)} · ${m.match_origem ?? '—'}` : '—'}
                    </td>
                    <td style={td}><span style={statusBadge(m.status)}>{m.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderLeft: `3px solid ${cor}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}

function tab(active: boolean): React.CSSProperties {
  return {
    background: active ? '#3D2314' : '#FFFFFF',
    color: active ? '#FAF7F2' : '#3D2314',
    border: '0.5px solid rgba(61,35,20,0.2)',
    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer',
  }
}

function statusBadge(s: string): React.CSSProperties {
  const map: Record<string, { fg: string; bg: string }> = {
    pendente: { fg: '#BA7517', bg: '#FAEEDA' },
    sugerido: { fg: '#854F0B', bg: '#FAEEDA' },
    conciliado: { fg: '#3B6D11', bg: '#EAF3DE' },
    rejeitado: { fg: '#A32D2D', bg: '#FCEBEB' },
  }
  const tone = map[s] ?? { fg: 'rgba(61,35,20,0.65)', bg: 'rgba(61,35,20,0.08)' }
  return {
    background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 600,
    padding: '2px 8px', borderRadius: 4, letterSpacing: 0.3, textTransform: 'uppercase',
  }
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '12px 14px', fontSize: 11, color: 'rgba(61,35,20,0.55)',
  textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '10px 14px', color: '#3D2314', whiteSpace: 'nowrap',
}

const primaryBtn: React.CSSProperties = {
  background: '#C8941A', color: '#3D2314', border: 'none',
  padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

const backLink: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)',
  fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16,
}

const infoBox: React.CSSProperties = {
  padding: 40, background: '#FAF7F2', minHeight: '100vh', color: '#3D2314',
}

const emptyBox: React.CSSProperties = {
  background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8,
  padding: 48, textAlign: 'center', color: 'rgba(61,35,20,0.65)',
}
