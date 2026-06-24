'use client'

// AjustarValoresModal · Sub-frente 4.2 Onda 4 (CEO 27/05/2026)
// Chama fn_conciliacao_ajustar_valores(lancamento_id, tipo, juros, desconto, obs).
// Quando recebido < previsto: opcao "Pagamento parcial" (acumula via fn_*_registrar_*)
// alem do "Desconto (quitar)" tradicional.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  lancamentoId: string
  tipo: 'pagar' | 'receber'
  valorOriginal: number
  valorBanco?: number | null
  descricao?: string
}

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Modo = 'parcial' | 'desconto'

export default function AjustarValoresModal({
  open, onClose, onSucesso, lancamentoId, tipo, valorOriginal, valorBanco, descricao,
}: Props) {
  const [juros, setJuros] = useState('')
  const [desconto, setDesconto] = useState('')
  const [obs, setObs] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>('parcial')

  const diferenca = (valorBanco ?? valorOriginal) - valorOriginal
  const recebeuMenos = diferenca < 0
  const recebeuMais = diferenca > 0

  useEffect(() => {
    if (open) {
      if (recebeuMais) {
        setJuros(diferenca.toFixed(2))
        setDesconto('')
      } else if (recebeuMenos) {
        setDesconto(Math.abs(diferenca).toFixed(2))
        setJuros('')
      } else {
        setJuros('')
        setDesconto('')
      }
      setObs('')
      setErro(null)
      setModo(recebeuMenos ? 'parcial' : 'desconto')
    }
  }, [open, valorBanco, valorOriginal, recebeuMais, recebeuMenos, diferenca])

  const valorAjustado = useMemo(() => {
    const j = Number(juros) || 0
    const d = Number(desconto) || 0
    return valorOriginal + j - d
  }, [juros, desconto, valorOriginal])

  async function confirmar() {
    setLoading(true)
    setErro(null)

    if (recebeuMenos && modo === 'parcial') {
      // Acumula valor_pago + mantem saldo em aberto (status fica 'parcial').
      const hoje = new Date().toISOString().slice(0, 10)
      const rpcName = tipo === 'receber' ? 'fn_receber_registrar_recebimento' : 'fn_pagar_registrar_pagamento'
      const params = tipo === 'receber'
        ? { p_receber_id: lancamentoId, p_data_pagamento: hoje, p_valor_recebido: valorBanco ?? 0, p_forma_pagamento: 'PIX', p_observacao: obs.trim() || null }
        : { p_pagar_id: lancamentoId, p_data_pagamento: hoje, p_valor_pago: valorBanco ?? 0, p_forma_pagamento: 'PIX', p_observacao: obs.trim() || null }
      const { data, error } = await supabase.rpc(rpcName, params)
      setLoading(false)
      if (error) { setErro(error.message); return }
      const r = data as { sucesso?: boolean; erro?: string } | null
      if (r && r.sucesso === false) { setErro(r.erro ?? 'Erro no registro parcial'); return }
      onSucesso()
      onClose()
      return
    }

    const { error } = await supabase.rpc('fn_conciliacao_ajustar_valores', {
      p_lancamento_id: lancamentoId,
      p_tipo: tipo,
      p_valor_juros: Number(juros) || 0,
      p_valor_desconto: Number(desconto) || 0,
      p_observacao: obs.trim() || null,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    onSucesso()
    onClose()
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <h2 style={h2}>Ajustar valores</h2>
        {descricao && <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 4, marginBottom: 14 }}>{descricao}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Info label="Valor original" valor={`R$ ${fmtBRL(valorOriginal)}`} cor="rgba(61,35,20,0.65)" />
          {valorBanco != null && (
            <Info label={tipo === 'receber' ? 'Valor recebido' : 'Valor pago'} valor={`R$ ${fmtBRL(valorBanco)}`} cor="#3D2314" />
          )}
        </div>

        {valorBanco != null && diferenca !== 0 && (
          <div style={{ background: '#FAEEDA', border: '0.5px solid rgba(186,117,23,0.3)', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#854F0B' }}>
            Diferença: <strong>{diferenca > 0 ? '+' : '−'} R$ {fmtBRL(Math.abs(diferenca))}</strong>
            {recebeuMais ? ' · juros/acréscimo' : recebeuMenos ? ' · escolha como tratar o saldo de R$ ' + fmtBRL(Math.abs(diferenca)) : ''}
          </div>
        )}

        {recebeuMenos && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button type="button" onClick={() => setModo('parcial')} style={modoBtn(modo === 'parcial')}>
              🟢 Pagamento parcial
            </button>
            <button type="button" onClick={() => setModo('desconto')} style={modoBtn(modo === 'desconto')}>
              Desconto (quitar)
            </button>
          </div>
        )}

        {recebeuMenos && modo === 'parcial' ? (
          <div style={{ background: '#EAF3DE', border: '0.5px solid rgba(59,109,17,0.25)', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#3B6D11' }}>
            {tipo === 'receber' ? 'Recebido' : 'Pago'} R$ {fmtBRL(valorBanco ?? 0)} · Saldo em aberto R$ {fmtBRL(Math.abs(diferenca))} · título fica <strong>PARCIAL</strong>.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <Field label="Juros R$">
                <input type="number" step="0.01" min="0" value={juros} onChange={(e) => setJuros(e.target.value)} placeholder="0,00" style={input} />
              </Field>
              <Field label="Desconto R$">
                <input type="number" step="0.01" min="0" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" style={input} />
              </Field>
            </div>
            <div style={{ background: '#EAF3DE', border: '0.5px solid rgba(59,109,17,0.25)', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#3B6D11' }}>
              Valor ajustado final: <strong>R$ {fmtBRL(valorAjustado)}</strong> · título quita.
            </div>
          </>
        )}

        <Field label="Observação">
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Detalhes do ajuste (opcional)" style={input} />
        </Field>

        {erro && <div style={erroBox}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtn(loading)}>Cancelar</button>
          <button onClick={confirmar} disabled={loading} style={primaryBtn(loading)}>
            {loading ? 'Salvando…' : recebeuMenos && modo === 'parcial' ? 'Registrar parcial' : 'Confirmar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Info({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <div style={{ background: '#FAF7F2', border: '0.5px solid rgba(61,35,20,0.08)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: cor, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
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

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modal: React.CSSProperties = { background: '#FFFFFF', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%' }
const h2: React.CSSProperties = { fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: 0 }
const input: React.CSSProperties = { width: '100%', background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3D2314', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' as const }
const erroBox: React.CSSProperties = { background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 8 }
function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}
function secondaryBtn(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }
}
function modoBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    background: active ? '#3D2314' : '#FAF7F2',
    color: active ? '#FAF7F2' : '#3D2314',
    border: active ? '0.5px solid #3D2314' : '0.5px solid rgba(61,35,20,0.18)',
    padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}
