'use client'

// MarcarPagoLoteModal · Sub-frente 4.1 Onda 4 (CEO 27/05/2026)
// Componente lote · array de IDs · fn_baixar_pagamento_em_massa.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface ContaBancaria { id: string; nome: string }

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  companyId: string
  tipo: 'pagar' | 'receber'
  ids: string[]
  valorTotal: number
}

const FORMAS = ['PIX', 'TED', 'Boleto', 'Dinheiro', 'Cartão']

function hoje(): string { return new Date().toISOString().split('T')[0] }

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function MarcarPagoLoteModal({
  open, onClose, onSucesso, companyId, tipo, ids, valorTotal,
}: Props) {
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [dataPag, setDataPag] = useState(hoje())
  const [contaId, setContaId] = useState('')
  const [forma, setForma] = useState('PIX')
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
    if (open) {
      setDataPag(hoje())
      setErro(null)
    }
  }, [open])

  async function confirmar() {
    if (!contaId) { setErro('Selecione a conta bancária'); return }
    if (ids.length === 0) { setErro('Nenhum item selecionado'); return }
    setLoading(true)
    setErro(null)
    const { error } = await supabase.rpc('fn_baixar_pagamento_em_massa', {
      p_tipo: tipo,
      p_ids: ids,
      p_data_pagamento: dataPag,
      p_conta_bancaria_id: contaId,
      p_forma_pagamento: forma,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    onSucesso()
    onClose()
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%' }}>
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: 0 }}>
            {tipo === 'pagar' ? 'Marcar como pagas' : 'Marcar como recebidas'} ({ids.length})
          </h2>
          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>
            Total: <strong>R$ {fmtBRL(valorTotal)}</strong> · pagamento integral em cada item
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

          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
              {erro}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtn(loading)}>Cancelar</button>
          <button onClick={confirmar} disabled={loading || !contaId} style={primaryBtn(loading)}>
            {loading ? 'Processando…' : `Confirmar ${ids.length}`}
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
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }
}
