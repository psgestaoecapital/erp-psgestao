'use client'

// Modal simples para editar campos essenciais de erp_pagar / erp_receber.
// Campos: descricao, valor, data_vencimento, categoria (opcional), numero_documento.
// RLS na tabela ja garante isolamento por company_id.

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Tipo = 'pagar' | 'receber'

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  tipo: Tipo
  itemId: string
  companyId: string
}

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`,
  borderRadius: 6, fontSize: 13, background: '#fff', color: ESP,
  fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function EditarLancamentoModal({
  open, onClose, onSucesso, tipo, itemId, companyId,
}: Props) {
  const tabela = tipo === 'pagar' ? 'erp_pagar' : 'erp_receber'
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [dataVencimento, setDataVencimento] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [conciliado, setConciliado] = useState(false)
  const [status, setStatus] = useState<string>('aberto')

  useEffect(() => {
    if (!open || !itemId) return
    setErro(null); setCarregando(true)
    supabase.from(tabela)
      .select('descricao, valor, data_vencimento, numero_documento, conciliado, status')
      .eq('id', itemId).eq('company_id', companyId)
      .maybeSingle()
      .then(({ data, error }) => {
        setCarregando(false)
        if (error) { setErro(error.message); return }
        if (!data) { setErro('lançamento não encontrado'); return }
        const d = data as {
          descricao: string | null; valor: number | null;
          data_vencimento: string | null; numero_documento: string | null;
          conciliado: boolean | null; status: string | null
        }
        setDescricao(d.descricao ?? '')
        setValor(d.valor != null ? String(d.valor) : '')
        setDataVencimento(d.data_vencimento ?? '')
        setNumeroDocumento(d.numero_documento ?? '')
        setConciliado(!!d.conciliado)
        setStatus(d.status ?? 'aberto')
      })
  }, [open, itemId, tabela, companyId])

  async function salvar() {
    if (!descricao.trim()) { setErro('Descreva o lançamento.'); return }
    const v = parseFloat(valor)
    if (!v || v <= 0) { setErro('Valor deve ser maior que zero.'); return }
    if (!dataVencimento) { setErro('Data de vencimento é obrigatória.'); return }
    setSalvando(true); setErro(null)
    try {
      const { error } = await supabase.from(tabela).update({
        descricao: descricao.trim(),
        valor: v,
        data_vencimento: dataVencimento,
        numero_documento: numeroDocumento.trim() || null,
      }).eq('id', itemId).eq('company_id', companyId)
      if (error) throw error
      onSucesso()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  if (!open) return null

  const bloqueado = status === 'pago' || conciliado

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: BG, borderRadius: 12, maxWidth: 480, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${LINE}` }}>
          <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>
            Editar {tipo === 'pagar' ? 'despesa' : 'receita'}
          </div>
          <div style={{ fontSize: 16, color: ESP, fontWeight: 600, marginTop: 4 }}>
            {descricao || 'Carregando…'}
          </div>
        </div>

        {bloqueado && (
          <div style={{ margin: '10px 20px 0', background: '#FEF3C7', color: '#7A5A0F', padding: '8px 10px', borderRadius: 6, fontSize: 11, border: '0.5px solid rgba(200,148,26,0.35)' }}>
            ⚠️ Este lançamento está <b>{status === 'pago' ? 'PAGO' : 'CONCILIADO'}</b>. Editar aqui muda os metadados,
            mas não altera baixa/vínculo. Se precisar reverter, use <b>Desvincular</b> no inbox de conciliação.
          </div>
        )}

        {carregando ? (
          <div style={{ padding: 32, textAlign: 'center', color: ESP60 }}>Carregando…</div>
        ) : (
          <div style={{ padding: 20, display: 'grid', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Descrição</label>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} style={inp} maxLength={200} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Valor (R$)</label>
                <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Vencimento</label>
                <input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} style={inp} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Número do documento (opcional)</label>
              <input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} style={inp} maxLength={50} />
            </div>
            {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>}
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: `0.5px solid ${LINE}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={salvando} style={{
            background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`,
            padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: salvando ? 'not-allowed' : 'pointer',
          }}>Cancelar</button>
          <button type="button" onClick={salvar} disabled={salvando || carregando} style={{
            background: (salvando || carregando) ? 'rgba(200,148,26,0.4)' : GOLD,
            color: '#3D2314', border: 'none', padding: '8px 18px',
            borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer',
          }}>{salvando ? 'Salvando…' : 'ALTERAR'}</button>
        </div>
      </div>
    </div>
  )
}
