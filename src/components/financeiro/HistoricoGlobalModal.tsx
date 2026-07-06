'use client'

// Timeline GLOBAL de auditoria (fn_lancamento_historico_global).
// Filtros: tipo (pagar/receber/todos), acao (EDITOU/EXCLUIU/DUPLICOU/todas), periodo.
// Exportacao CSV pra BPO/contabilidade.
// Coexiste com o HistoricoLancamentoModal (por linha).

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
}

type FiltroTipo = 'todos' | 'pagar' | 'receber'
type FiltroAcao = 'todas' | 'EDITOU' | 'EXCLUIU' | 'DUPLICOU' | 'ORIGEM_DUPLICADA'

type Evento = {
  log_id: string
  data_evento: string
  user_email: string | null
  acao: string
  tabela_origem: string | null
  lancamento_id: string
  descricao: string | null
  valor: number | null
  nome_pessoa: string | null
  campos_alterados: Record<string, unknown> | null
}

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

const inp: React.CSSProperties = {
  padding: '6px 10px', border: `0.5px solid ${LINE}`, borderRadius: 6,
  fontSize: 12, background: '#fff', color: ESP, fontFamily: 'inherit',
}

const fmtBRL = (v: unknown): string => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}
const fmtDataHora = (iso: string): string => {
  try { return new Date(iso).toLocaleString('pt-BR') } catch { return iso }
}
const acaoLabel = (a: string): string => ({
  EDITOU: 'ALTEROU', EXCLUIU: 'EXCLUIU',
  DUPLICOU: 'DUPLICOU', ORIGEM_DUPLICADA: 'foi duplicada',
}[a] ?? a)
const acaoCor = (a: string): { bg: string; fg: string } => ({
  EDITOU: { bg: '#FEF3C7', fg: '#7A5A0F' },
  EXCLUIU: { bg: '#FEE2E2', fg: '#B91C1C' },
  DUPLICOU: { bg: '#DCFCE7', fg: '#166534' },
  ORIGEM_DUPLICADA: { bg: '#DBEAFE', fg: '#1E40AF' },
}[a] ?? { bg: BG, fg: ESP })

// Resumo curto do que mudou pra coluna "O que mudou"
function resumoMudanca(evt: Evento): string {
  const alt = evt.campos_alterados ?? {}
  if (evt.acao === 'EDITOU') {
    const antes = (alt as { antes?: Record<string, unknown> }).antes ?? {}
    const depois = (alt as { depois?: Record<string, unknown> }).depois ?? {}
    const mudanças: string[] = []
    for (const k of ['descricao', 'valor', 'data_vencimento', 'numero_documento']) {
      const a = (antes as Record<string, unknown>)[k]
      const d = (depois as Record<string, unknown>)[k]
      if (JSON.stringify(a) !== JSON.stringify(d)) {
        const label = { descricao: 'desc', valor: 'valor', data_vencimento: 'venc', numero_documento: 'doc' }[k] ?? k
        const fa = k === 'valor' ? fmtBRL(a) : String(a ?? '—')
        const fd = k === 'valor' ? fmtBRL(d) : String(d ?? '—')
        mudanças.push(`${label}: ${fa}→${fd}`)
      }
    }
    return mudanças.join(' · ')
  }
  if (evt.acao === 'DUPLICOU') return 'nova cópia (aberta)'
  if (evt.acao === 'ORIGEM_DUPLICADA') return 'origem de outra cópia'
  if (evt.acao === 'EXCLUIU') return 'removida (snapshot no log)'
  return ''
}

export default function HistoricoGlobalModal({ open, onClose, companyId }: Props) {
  const [tipo, setTipo] = useState<FiltroTipo>('todos')
  const [acao, setAcao] = useState<FiltroAcao>('todas')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [eventos, setEventos] = useState<Evento[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !companyId) return
    setLoading(true); setErro(null)
    supabase.rpc('fn_lancamento_historico_global', {
      p_company_id: companyId,
      p_tipo: tipo,
      p_acao: acao,
      p_data_inicio: dataInicio || null,
      p_data_fim: dataFim || null,
      p_limite: 500,
    }).then(({ data, error }) => {
      setLoading(false)
      if (error) { setErro(error.message); return }
      setEventos((data as Evento[]) ?? [])
    })
  }, [open, companyId, tipo, acao, dataInicio, dataFim])

  const csv = useMemo(() => {
    const linhas = [
      ['Data', 'Usuário', 'Ação', 'Tipo', 'Lançamento', 'Nome', 'Valor', 'O que mudou'].join(';'),
      ...eventos.map((e) => [
        fmtDataHora(e.data_evento),
        e.user_email ?? '',
        acaoLabel(e.acao),
        e.tabela_origem === 'erp_pagar' ? 'Pagar' : e.tabela_origem === 'erp_receber' ? 'Receber' : '',
        (e.descricao ?? '').replace(/;/g, ','),
        (e.nome_pessoa ?? '').replace(/;/g, ','),
        e.valor != null ? Number(e.valor).toFixed(2).replace('.', ',') : '',
        resumoMudanca(e).replace(/;/g, ','),
      ].join(';')),
    ]
    return linhas.join('\n')
  }, [eventos])

  const baixarCSV = () => {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `historico_lancamentos_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 12, zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: BG, borderRadius: 12, maxWidth: 1080, width: '100%', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: `0.5px solid ${LINE}`, display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>
              🕐 Auditoria global
            </div>
            <div style={{ fontSize: 16, color: ESP, fontWeight: 600, marginTop: 2 }}>
              Histórico de Lançamentos
            </div>
            <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
              Registro imutável de todas as alterações, exclusões e duplicações.
            </div>
          </div>
          <button onClick={baixarCSV} disabled={loading || eventos.length === 0} style={{
            background: '#FFFFFF', color: ESP, border: `0.5px solid ${LINE}`,
            padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            ⬇ CSV
          </button>
        </div>

        <div style={{ padding: 14, borderBottom: `0.5px solid ${LINE}`, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 10, color: ESP60, display: 'block', marginBottom: 2 }}>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as FiltroTipo)} style={inp}>
              <option value="todos">Todos</option>
              <option value="pagar">Pagar</option>
              <option value="receber">Receber</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: ESP60, display: 'block', marginBottom: 2 }}>Ação</label>
            <select value={acao} onChange={(e) => setAcao(e.target.value as FiltroAcao)} style={inp}>
              <option value="todas">Todas</option>
              <option value="EDITOU">Alterados</option>
              <option value="EXCLUIU">Excluídos</option>
              <option value="DUPLICOU">Duplicados</option>
              <option value="ORIGEM_DUPLICADA">Foi duplicada</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: ESP60, display: 'block', marginBottom: 2 }}>De</label>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: ESP60, display: 'block', marginBottom: 2 }}>Até</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inp} />
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: ESP60 }}>
            {loading ? 'Carregando…' : `${eventos.length} evento(s)`}
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
          {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{erro}</div>}
          {!loading && eventos.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: ESP60, fontSize: 13 }}>
              Nenhum evento encontrado para os filtros aplicados.
            </div>
          )}
          {eventos.length > 0 && (
            <div style={{ background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: BG, borderBottom: `0.5px solid ${LINE}` }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Data</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Usuário</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Ação</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Tipo</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Lançamento</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Valor</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>O que mudou</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.map((e) => {
                    const cor = acaoCor(e.acao)
                    return (
                      <tr key={e.log_id} style={{ borderBottom: `0.5px solid rgba(61,35,20,0.06)` }}>
                        <td style={{ padding: '8px 10px', color: ESP60, fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDataHora(e.data_evento)}</td>
                        <td style={{ padding: '8px 10px', color: ESP, fontSize: 11 }}>{e.user_email ?? '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: cor.bg, color: cor.fg, padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                            {acaoLabel(e.acao)}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: ESP60, fontSize: 11 }}>
                          {e.tabela_origem === 'erp_pagar' ? 'Pagar' : e.tabela_origem === 'erp_receber' ? 'Receber' : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: ESP }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{e.descricao ?? '—'}</div>
                          {e.nome_pessoa && <div style={{ fontSize: 10, color: ESP60 }}>{e.nome_pessoa}</div>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: ESP, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {e.valor != null ? fmtBRL(e.valor) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: ESP60, fontSize: 11 }}>{resumoMudanca(e) || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: `0.5px solid ${LINE}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{
            background: GOLD, color: '#3D2314', border: 'none',
            padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
