'use client'

// MarcarPagoModal · ONDA 1 inundação (CEO 27/05/2026)
// Componente reusável pra baixar pagamento em erp_pagar/erp_receber
// via RPCs prontas fn_pagar_baixar_pagamento / fn_receber_baixar_pagamento.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface ContaBancaria {
  id: string
  nome: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  companyId: string
  tipo: 'pagar' | 'receber'
  itemId: string
  descricao: string
  valorTotal: number
}

const FORMAS = ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão']

function hoje(): string {
  return new Date().toISOString().split('T')[0]
}

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function MarcarPagoModal({
  open, onClose, onSucesso, companyId, tipo, itemId, descricao, valorTotal,
}: Props) {
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [dataPag, setDataPag] = useState(hoje())
  const [contaId, setContaId] = useState('')
  const [forma, setForma] = useState('PIX')
  const [valorPago, setValorPago] = useState(valorTotal.toFixed(2))
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !companyId) return
    let ignore = false
    ;(async () => {
      const { data } = await supabase
        .from('erp_banco_contas')
        .select('id, nome')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .order('nome')
      if (ignore) return
      const lista = (data ?? []) as ContaBancaria[]
      setContas(lista)
      if (lista.length > 0 && !contaId) setContaId(lista[0].id)
    })()
    return () => { ignore = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId])

  useEffect(() => {
    if (!open) return
    setDataPag(hoje())
    setErro(null)
    // FIX baixa parcial: o campo default vira o SALDO restante (valor − valor_pago),
    // não o valor total — senão confirmar re-baixaria o total inteiro (acumula → overpay).
    let ignore = false
    ;(async () => {
      const tabela = tipo === 'pagar' ? 'erp_pagar' : 'erp_receber'
      const { data } = await supabase.from(tabela).select('valor_pago').eq('id', itemId).maybeSingle()
      if (ignore) return
      const jaPago = Number((data as { valor_pago?: number } | null)?.valor_pago ?? 0)
      const saldo = Math.max(valorTotal - jaPago, 0)
      setValorPago((saldo > 0 ? saldo : valorTotal).toFixed(2))
    })()
    return () => { ignore = true }
  }, [open, valorTotal, itemId, tipo])

  async function confirmar() {
    if (!contaId) { setErro('Selecione a conta bancária'); return }
    setLoading(true)
    setErro(null)
    const rpcName = tipo === 'pagar' ? 'fn_pagar_baixar_pagamento' : 'fn_receber_baixar_pagamento'
    const params = tipo === 'pagar'
      ? { p_pagar_id: itemId, p_data_pagamento: dataPag, p_conta_bancaria_id: contaId, p_forma_pagamento: forma, p_valor_pago: Number(valorPago) }
      : { p_receber_id: itemId, p_data_pagamento: dataPag, p_conta_bancaria_id: contaId, p_forma_pagamento: forma, p_valor_pago: Number(valorPago) }
    const { error } = await supabase.rpc(rpcName, params)
    setLoading(false)
    if (error) { setErro(error.message); return }
    onSucesso()
    onClose()
  }

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF', borderRadius: 12, padding: '24px',
          maxWidth: 480, width: '100%',
          boxShadow: '0 10px 30px rgba(61,35,20,0.25)',
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: 0 }}>
            {tipo === 'pagar' ? 'Marcar como pago' : 'Marcar como recebido'}
          </h2>
          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>
            {descricao} · R$ {fmtBRL(valorTotal)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={`Data ${tipo === 'pagar' ? 'do pagamento' : 'do recebimento'}`}>
            <input type="date" value={dataPag} onChange={(e) => setDataPag(e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Conta bancária">
            <select value={contaId} onChange={(e) => setContaId(e.target.value)} style={inputStyle}>
              {contas.length === 0 && <option value="">Sem contas cadastradas</option>}
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Field>

          <Field label="Forma de pagamento">
            <select value={forma} onChange={(e) => setForma(e.target.value)} style={inputStyle}>
              {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>

          <Field label="Valor pago (R$)">
            <input
              type="number" step="0.01" min="0"
              value={valorPago}
              onChange={(e) => setValorPago(e.target.value)}
              style={inputStyle}
            />
            <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', marginTop: 4 }}>
              Pagamento parcial permitido · default é o valor total
            </div>
          </Field>

          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
              {erro}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtn(loading)}>Cancelar</button>
          <button onClick={confirmar} disabled={loading || !contaId} style={primaryBtn(loading)}>
            {loading ? 'Confirmando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#FFFFFF',
  border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6,
  padding: '8px 10px', fontSize: 13, color: '#3D2314',
  fontFamily: 'inherit', boxSizing: 'border-box',
}

function primaryBtn(loading: boolean): React.CSSProperties {
  return {
    background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A',
    color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6,
    fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
  }
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent', color: '#3D2314',
    border: '0.5px solid rgba(61,35,20,0.2)',
    padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
