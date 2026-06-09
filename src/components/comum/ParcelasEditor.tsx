'use client'

// FEAT-OS-ONDA2-PARCELAS-EDITAVEIS-v1 · PARTE 2 (front)
// Editor de parcelas do pedido · presets (a vista / 30-60-90 / entrada %)
// + edicao linha-a-linha + soma ao vivo vs pedido.total + ajustar ultima
// + salvar via RPC fn_pedido_salvar_parcelas (Adendo 1 Regra #34).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Trash2, Plus, AlertCircle, CheckCircle2 } from 'lucide-react'

export interface Parcela {
  id?: string
  numero: number
  valor: number
  vencimento: string
  forma_pagamento: string | null
  gerar_boleto: boolean
  observacoes?: string | null
}

interface Props {
  pedidoId: string
  total: number
  onSaved?: (parcelas: Parcela[]) => void
}

const FORMAS = ['PIX', 'Boleto', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Dinheiro', 'Cheque']

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  white: '#FFFFFF',
  cream: '#F0ECE3',
  border: '#E0D8CC',
  borderL: '#EDE7DA',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  green: '#10B981',
  greenBg: '#ECFDF5',
  red: '#EF4444',
  redBg: '#FEE2E2',
  amber: '#C88A1A',
  amberBg: '#FFF8E1',
  blue: '#3B82F6',
}

const fmtBRL = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function diasISO(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Distribui o total em N parcelas iguais · ultima absorve o residuo do arredondamento.
function distribuir(total: number, n: number): number[] {
  if (n <= 0) return []
  const base = round2(total / n)
  const arr = Array.from({ length: n }, () => base)
  const soma = round2(arr.reduce((s, v) => s + v, 0))
  arr[n - 1] = round2(arr[n - 1] + (total - soma))
  return arr
}

const inp: React.CSSProperties = {
  width: '100%', minHeight: 36, padding: '6px 8px', fontSize: 12,
  border: `1px solid ${C.border}`, borderRadius: 6, background: C.white,
  color: C.espresso, outline: 'none',
}
const btn: React.CSSProperties = {
  minHeight: 32, padding: '6px 10px', fontSize: 11, fontWeight: 600,
  border: `1px solid ${C.gold}`, borderRadius: 6,
  background: C.goldBg, color: C.goldD, cursor: 'pointer',
}
const btnPri: React.CSSProperties = {
  minHeight: 44, padding: '10px 16px', fontSize: 13, fontWeight: 700,
  border: 'none', borderRadius: 8,
  background: C.gold, color: C.white, cursor: 'pointer',
}
const btnSec: React.CSSProperties = {
  minHeight: 44, padding: '10px 16px', fontSize: 13,
  border: `1px solid ${C.border}`, borderRadius: 8,
  background: 'transparent', color: C.espresso, cursor: 'pointer',
}

export default function ParcelasEditor({ pedidoId, total, onSaved }: Props) {
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msgErr, setMsgErr] = useState<string | null>(null)
  const [msgOk, setMsgOk] = useState<string | null>(null)
  // Entrada %+N preset
  const [pctEntrada, setPctEntrada] = useState('30')
  const [nRestantes, setNRestantes] = useState('2')

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      const { data } = await supabase
        .from('erp_pedidos_parcelas')
        .select('id,numero,valor,vencimento,forma_pagamento,gerar_boleto,observacoes')
        .eq('pedido_id', pedidoId)
        .order('numero', { ascending: true })
      if (alive) {
        setParcelas((data ?? []).map((p) => ({
          ...p,
          valor: Number(p.valor),
          gerar_boleto: !!p.gerar_boleto,
        })) as Parcela[])
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [pedidoId])

  const soma = useMemo(() => round2(parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0)), [parcelas])
  const diff = useMemo(() => round2(soma - round2(total)), [soma, total])
  const bate = Math.abs(diff) < 0.005

  function setPreset(p: Parcela[]) {
    setMsgErr(null); setMsgOk(null)
    setParcelas(p)
  }

  function presetAVista() {
    setPreset([{ numero: 1, valor: round2(total), vencimento: hojeISO(), forma_pagamento: 'PIX', gerar_boleto: false }])
  }

  function preset306090() {
    const vals = distribuir(total, 3)
    setPreset([
      { numero: 1, valor: vals[0], vencimento: diasISO(30), forma_pagamento: 'Boleto', gerar_boleto: true },
      { numero: 2, valor: vals[1], vencimento: diasISO(60), forma_pagamento: 'Boleto', gerar_boleto: true },
      { numero: 3, valor: vals[2], vencimento: diasISO(90), forma_pagamento: 'Boleto', gerar_boleto: true },
    ])
  }

  function presetEntradaN() {
    const pct = Math.max(0, Math.min(100, parseFloat(pctEntrada) || 0))
    const n = Math.max(1, parseInt(nRestantes) || 1)
    const entrada = round2(total * pct / 100)
    const restante = round2(total - entrada)
    const vals = distribuir(restante, n)
    const novas: Parcela[] = [
      { numero: 1, valor: entrada, vencimento: hojeISO(), forma_pagamento: 'PIX', gerar_boleto: false },
      ...vals.map((v, i) => ({
        numero: i + 2, valor: v, vencimento: diasISO((i + 1) * 30),
        forma_pagamento: 'Boleto', gerar_boleto: true,
      })),
    ]
    setPreset(novas)
  }

  function presetPersonalizar() {
    setPreset([{ numero: 1, valor: round2(total), vencimento: hojeISO(), forma_pagamento: null, gerar_boleto: false }])
  }

  function alterar(idx: number, patch: Partial<Parcela>) {
    setMsgErr(null); setMsgOk(null)
    const arr = [...parcelas]
    arr[idx] = { ...arr[idx], ...patch }
    setParcelas(arr)
  }

  function adicionar() {
    const last = parcelas[parcelas.length - 1]
    setPreset([...parcelas, {
      numero: parcelas.length + 1,
      valor: 0,
      vencimento: last ? diasISO(30) : hojeISO(),
      forma_pagamento: last?.forma_pagamento ?? null,
      gerar_boleto: last?.gerar_boleto ?? false,
    }])
  }

  function remover(idx: number) {
    setPreset(parcelas.filter((_, i) => i !== idx).map((p, i) => ({ ...p, numero: i + 1 })))
  }

  function ajustarUltima() {
    if (parcelas.length === 0) return
    const arr = [...parcelas]
    const semUltima = round2(arr.slice(0, -1).reduce((s, p) => s + (Number(p.valor) || 0), 0))
    arr[arr.length - 1] = { ...arr[arr.length - 1], valor: round2(total - semUltima) }
    setPreset(arr)
  }

  async function salvar() {
    if (!bate) {
      setMsgErr(`Soma (${fmtBRL(soma)}) difere do total (${fmtBRL(total)}). Ajuste antes de salvar.`)
      return
    }
    if (parcelas.some((p) => !p.vencimento)) {
      setMsgErr('Toda parcela precisa de vencimento.')
      return
    }
    setSalvando(true)
    setMsgErr(null)
    setMsgOk(null)
    const payload = parcelas.map((p, i) => ({
      numero: i + 1,
      valor: p.valor,
      vencimento: p.vencimento,
      forma_pagamento: p.forma_pagamento || null,
      gerar_boleto: !!p.gerar_boleto,
      observacoes: p.observacoes || null,
    }))
    const { data, error } = await supabase.rpc('fn_pedido_salvar_parcelas', {
      p_pedido_id: pedidoId,
      p_parcelas: payload,
    })
    setSalvando(false)
    if (error) {
      setMsgErr(error.message)
      return
    }
    const novas = ((data as unknown) as Parcela[] ?? []).map((p) => ({ ...p, valor: Number(p.valor), gerar_boleto: !!p.gerar_boleto }))
    setParcelas(novas)
    setMsgOk(`ALTEROU ${novas.length} parcela(s) · soma ${fmtBRL(soma)} = total ${fmtBRL(total)}.`)
    onSaved?.(novas)
  }

  if (loading) {
    return <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Carregando parcelas…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <button type="button" onClick={presetAVista} style={btn} data-testid="parcelas-preset-avista">À vista</button>
        <button type="button" onClick={preset306090} style={btn} data-testid="parcelas-preset-306090">30/60/90</button>
        <button type="button" onClick={presetPersonalizar} style={btn} data-testid="parcelas-preset-custom">Personalizar</button>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', padding: 8, background: C.cream, borderRadius: 6 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 80 }}>
          <span style={{ fontSize: 10, color: C.espressoM }}>Entrada (%)</span>
          <input type="number" min="0" max="100" value={pctEntrada} onChange={(e) => setPctEntrada(e.target.value)} style={inp} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 80 }}>
          <span style={{ fontSize: 10, color: C.espressoM }}>+ N× restantes</span>
          <input type="number" min="1" max="48" value={nRestantes} onChange={(e) => setNRestantes(e.target.value)} style={inp} />
        </label>
        <button type="button" onClick={presetEntradaN} style={btn} data-testid="parcelas-preset-entrada">
          Aplicar
        </button>
      </div>

      {parcelas.length === 0 ? (
        <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>
          Nenhuma parcela ainda · escolha um atalho ou clique em "+ Adicionar parcela".
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {parcelas.map((p, i) => (
            <div key={i} data-testid={`parcela-row-${i}`} style={{
              background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr', gap: 6, alignItems: 'end' }}>
                <label>
                  <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Nº</span>
                  <div style={{ ...inp, textAlign: 'center', fontWeight: 700, color: C.goldD, background: C.goldBg }}>{i + 1}</div>
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Valor (R$)</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={p.valor || ''}
                    onChange={(e) => alterar(i, { valor: parseFloat(e.target.value) || 0 })}
                    style={{ ...inp, textAlign: 'right' }}
                    data-testid={`parcela-valor-${i}`}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Vencimento</span>
                  <input
                    type="date" value={p.vencimento}
                    onChange={(e) => alterar(i, { vencimento: e.target.value })}
                    style={inp}
                    data-testid={`parcela-vencimento-${i}`}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={p.forma_pagamento ?? ''}
                  onChange={(e) => alterar(i, { forma_pagamento: e.target.value || null })}
                  style={{ ...inp, flex: 1 }}
                  data-testid={`parcela-forma-${i}`}
                >
                  <option value="">Forma de pagamento…</option>
                  {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 10px',
                  border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, cursor: 'pointer', fontSize: 12,
                }}>
                  <input
                    type="checkbox" checked={p.gerar_boleto}
                    onChange={(e) => alterar(i, { gerar_boleto: e.target.checked })}
                    style={{ accentColor: C.gold }}
                  />
                  Boleto
                </label>
                <button
                  type="button" onClick={() => remover(i)}
                  data-testid={`parcela-remover-${i}`}
                  style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', padding: 4 }}
                  aria-label="Remover"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button" onClick={adicionar} style={{ ...btn, alignSelf: 'flex-start' }}
            data-testid="parcela-adicionar"
          >
            <Plus size={12} style={{ display: 'inline', marginRight: 2, verticalAlign: 'middle' }} />
            Adicionar parcela
          </button>
        </div>
      )}

      {/* Resumo + ajustar */}
      {parcelas.length > 0 && (
        <div style={{
          padding: 10, background: bate ? C.greenBg : C.amberBg, borderRadius: 6,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ fontSize: 11, color: bate ? C.green : C.amber, fontWeight: 600 }}>
            Soma <strong>{fmtBRL(soma)}</strong> · Total <strong>{fmtBRL(total)}</strong>
            {!bate && <> · Diferença <strong>{diff > 0 ? '+' : ''}{fmtBRL(diff)}</strong></>}
          </div>
          {!bate && (
            <button
              type="button" onClick={ajustarUltima}
              data-testid="parcela-ajustar-ultima"
              style={{ ...btn, borderColor: C.amber, color: C.amber, background: C.white }}
            >
              Ajustar última
            </button>
          )}
        </div>
      )}

      {msgErr && (
        <div style={{
          padding: 10, background: C.redBg, color: C.red, borderRadius: 6,
          fontSize: 12, display: 'flex', gap: 6, alignItems: 'start',
        }}>
          <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{msgErr}</span>
        </div>
      )}
      {msgOk && (
        <div style={{
          padding: 10, background: C.greenBg, color: C.green, borderRadius: 6,
          fontSize: 12, display: 'flex', gap: 6, alignItems: 'start',
        }}>
          <CheckCircle2 size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{msgOk}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button" onClick={salvar}
          disabled={salvando || parcelas.length === 0 || !bate}
          data-testid="parcelas-salvar"
          style={{ ...btnPri, opacity: (salvando || parcelas.length === 0 || !bate) ? 0.5 : 1, cursor: (salvando || parcelas.length === 0 || !bate) ? 'not-allowed' : 'pointer' }}
        >
          {salvando ? 'Salvando…' : 'Salvar parcelas'}
        </button>
      </div>
    </div>
  )
}
