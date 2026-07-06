'use client'

// Timeline de auditoria de um lancamento em erp_lancamento_log.
// Le via fn_lancamento_historico (SECURITY DEFINER STABLE), respeitando
// escopo por company_id da tabela pai.

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  itemId: string
  itemDescricao: string
}

type Evento = {
  id: string
  user_email: string | null
  acao: string
  campos_alterados: Record<string, unknown> | null
  created_at: string
}

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

const fmtBRL = (v: unknown): string => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}

const fmtData = (iso: string | null): string => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('pt-BR') } catch { return iso }
}

const CAMPOS_LEGIVEIS: Record<string, { label: string; fmt: (v: unknown) => string }> = {
  descricao: { label: 'Descrição', fmt: (v) => String(v ?? '—') },
  valor: { label: 'Valor', fmt: fmtBRL },
  valor_pago: { label: 'Valor pago', fmt: fmtBRL },
  data_vencimento: { label: 'Vencimento', fmt: (v) => String(v ?? '—') },
  data_pagamento: { label: 'Pagamento', fmt: (v) => String(v ?? '—') },
  numero_documento: { label: 'Documento', fmt: (v) => String(v ?? '—') },
  status: { label: 'Status', fmt: (v) => String(v ?? '—') },
  conciliado: { label: 'Conciliado', fmt: (v) => (v ? 'sim' : 'não') },
}

function diffAntesDepois(antes: Record<string, unknown>, depois: Record<string, unknown>): Array<{ campo: string; de: string; para: string }> {
  const out: Array<{ campo: string; de: string; para: string }> = []
  for (const [k, cfg] of Object.entries(CAMPOS_LEGIVEIS)) {
    const a = antes?.[k]
    const d = depois?.[k]
    if (JSON.stringify(a) !== JSON.stringify(d)) {
      out.push({ campo: cfg.label, de: cfg.fmt(a), para: cfg.fmt(d) })
    }
  }
  return out
}

const ACAO_COR: Record<string, { bg: string; fg: string; label: string }> = {
  EDITOU:            { bg: '#FEF3C7', fg: '#7A5A0F', label: 'ALTEROU' },
  EXCLUIU:           { bg: '#FEE2E2', fg: '#B91C1C', label: 'EXCLUIU' },
  DUPLICOU:          { bg: '#DCFCE7', fg: '#166534', label: 'DUPLICOU' },
  ORIGEM_DUPLICADA:  { bg: '#DBEAFE', fg: '#1E40AF', label: 'foi duplicada' },
  CRIOU:             { bg: '#E0E7FF', fg: '#3730A3', label: 'CRIOU' },
}

export default function HistoricoLancamentoModal({ open, onClose, itemId, itemDescricao }: Props) {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !itemId) return
    setLoading(true); setErro(null)
    supabase.rpc('fn_lancamento_historico', { p_id: itemId })
      .then(({ data, error }) => {
        setLoading(false)
        if (error) { setErro(error.message); return }
        setEventos((data as Evento[]) ?? [])
      })
  }, [open, itemId])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: BG, borderRadius: 12, maxWidth: 640, width: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${LINE}` }}>
          <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>
            🕐 Histórico do lançamento
          </div>
          <div style={{ fontSize: 15, color: ESP, fontWeight: 600, marginTop: 4 }}>
            {itemDescricao}
          </div>
          <div style={{ fontSize: 11, color: ESP60, marginTop: 4 }}>
            Registro imutável de quem alterou / excluiu / duplicou este lançamento.
          </div>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: ESP60, fontSize: 13, padding: 24 }}>Carregando…</div>
          ) : erro ? (
            <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>
          ) : eventos.length === 0 ? (
            <div style={{ textAlign: 'center', color: ESP60, fontSize: 13, padding: 24 }}>
              Nenhum evento registrado ainda para este lançamento.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {eventos.map((e) => {
                const acaoInfo = ACAO_COR[e.acao] ?? { bg: BG, fg: ESP, label: e.acao }
                const alt = (e.campos_alterados ?? {}) as Record<string, unknown>
                const antes = (alt.antes ?? null) as Record<string, unknown> | null
                const depois = (alt.depois ?? null) as Record<string, unknown> | null
                const registro = (alt.registro ?? null) as Record<string, unknown> | null
                const diff = antes && depois ? diffAntesDepois(antes, depois) : []
                const origemId = typeof alt.origem_id === 'string' ? alt.origem_id : null
                const novoId = typeof alt.novo_id === 'string' ? alt.novo_id : null

                return (
                  <div key={e.id} style={{ background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{
                        background: acaoInfo.bg, color: acaoInfo.fg,
                        padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                        letterSpacing: 0.5, textTransform: 'uppercase',
                      }}>
                        {acaoInfo.label}
                      </span>
                      <span style={{ fontSize: 12, color: ESP, fontWeight: 500 }}>
                        {e.user_email ?? 'sistema'}
                      </span>
                      <span style={{ fontSize: 11, color: ESP60, marginLeft: 'auto' }}>
                        {fmtData(e.created_at)}
                      </span>
                    </div>

                    {diff.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {diff.map((d) => (
                          <div key={d.campo} style={{ fontSize: 12, color: ESP }}>
                            <b>{d.campo}:</b>{' '}
                            <span style={{ color: '#B91C1C', textDecoration: 'line-through' }}>{d.de}</span>
                            {' → '}
                            <span style={{ color: '#166534', fontWeight: 600 }}>{d.para}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {registro && (
                      <div style={{ marginTop: 8, fontSize: 11, color: ESP60 }}>
                        <details>
                          <summary style={{ cursor: 'pointer' }}>Snapshot do registro excluído</summary>
                          <pre style={{ fontSize: 10, background: BG, padding: 8, borderRadius: 4, marginTop: 4, overflow: 'auto', maxHeight: 200 }}>
{JSON.stringify(registro, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}

                    {(origemId || novoId) && (
                      <div style={{ marginTop: 6, fontSize: 11, color: ESP60 }}>
                        {origemId && <>Origem: <code style={{ background: BG, padding: '1px 5px', borderRadius: 3 }}>{origemId.slice(0, 8)}…</code></>}
                        {novoId && <> · Novo: <code style={{ background: BG, padding: '1px 5px', borderRadius: 3 }}>{novoId.slice(0, 8)}…</code></>}
                      </div>
                    )}
                  </div>
                )
              })}
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
