'use client'

// Rateio do lançamento a pagar entre N centros de custo (gap2 PDCA 22/11, blueprint 206 · GE).
// Um mesmo gasto que serve mais de uma obra/centro é dividido por percentual; o valor em R$ de cada
// parte é derivado do valor do lançamento (princípio 4 do caixa por obra do Hub). RD-95: o "?" fica
// na seção (<Campo ajuda>); RD-96: design próprio PS (sem decalque). Mobile: linhas em flex-wrap.
import React from 'react'
import { Campo } from '@/components/ui/feedback/Campo'

export type RateioLinha = { centroCustoId: string; percentual: string }

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function somaPercentuais(linhas: RateioLinha[]): number {
  return linhas.reduce((s, l) => s + (parseFloat(l.percentual) || 0), 0)
}

// Valida o rateio (quando ativo). Devolve a mensagem de erro, ou null quando está pronto para salvar.
export function validarRateio(linhas: RateioLinha[]): string | null {
  const validas = linhas.filter((l) => l.centroCustoId && (parseFloat(l.percentual) || 0) > 0)
  if (validas.length === 0) return 'Rateio ligado: inclua ao menos um centro de custo com percentual.'
  const ids = validas.map((l) => l.centroCustoId)
  if (new Set(ids).size !== ids.length) return 'Rateio: cada centro de custo só pode aparecer uma vez.'
  const soma = somaPercentuais(validas)
  if (Math.abs(soma - 100) > 0.01) return `Rateio: a soma dos percentuais é ${soma.toFixed(2).replace('.', ',')}% e precisa ser 100%.`
  return null
}

// Só as linhas que valem a pena gravar (centro escolhido e percentual > 0).
export function rateioLinhasValidas(linhas: RateioLinha[]): { centroCustoId: string; percentual: number }[] {
  return linhas
    .filter((l) => l.centroCustoId && (parseFloat(l.percentual) || 0) > 0)
    .map((l) => ({ centroCustoId: l.centroCustoId, percentual: parseFloat(l.percentual) }))
}

export function RateioDespesa({
  centros,
  linhas,
  onChange,
  valorTotal,
  rotaAjuda,
}: {
  centros: { id: string; nome: string }[]
  linhas: RateioLinha[]
  onChange: (linhas: RateioLinha[]) => void
  valorTotal: number
  rotaAjuda: string
}) {
  const soma = somaPercentuais(linhas)
  const fecha = Math.abs(soma - 100) <= 0.01
  const corSoma = linhas.length === 0 ? '#6b7280' : fecha ? '#047857' : '#b45309'

  const setLinha = (idx: number, campo: keyof RateioLinha, valor: string) =>
    onChange(linhas.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)))
  const addLinha = () => onChange([...linhas, { centroCustoId: '', percentual: '' }])
  const removeLinha = (idx: number) => onChange(linhas.filter((_, i) => i !== idx))

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 14, background: '#fff', boxSizing: 'border-box',
  }

  return (
    <Campo ajuda="financeiro.despesa.rateio" ajudaRota={rotaAjuda} label="Rateio entre centros de custo">
      <div
        data-testid="despesa-rateio"
        style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#faf9f7' }}
      >
        {linhas.length === 0 && (
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6b7280' }}>
            Divida este gasto entre mais de um centro de custo/obra. Some 100% entre as partes.
          </p>
        )}

        {linhas.map((l, idx) => {
          const pct = parseFloat(l.percentual) || 0
          const valorLinha = valorTotal > 0 ? (valorTotal * pct) / 100 : 0
          return (
            <div
              key={idx}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}
            >
              <select
                data-testid={`despesa-rateio-centro-${idx}`}
                value={l.centroCustoId}
                onChange={(e) => setLinha(idx, 'centroCustoId', e.target.value)}
                style={{ ...inputStyle, flex: '1 1 200px' }}
              >
                <option value="">— escolha o centro de custo —</option>
                {l.centroCustoId && !centros.some((c) => c.id === l.centroCustoId) && (
                  <option value={l.centroCustoId}>(centro atual)</option>
                )}
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              <div style={{ position: 'relative', flex: '0 0 110px' }}>
                <input
                  data-testid={`despesa-rateio-pct-${idx}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={l.percentual}
                  onChange={(e) => setLinha(idx, 'percentual', e.target.value)}
                  placeholder="%"
                  style={{ ...inputStyle, paddingRight: 26, textAlign: 'right' }}
                />
                <span style={{ position: 'absolute', right: 10, top: 9, fontSize: 13, color: '#9ca3af' }}>%</span>
              </div>
              <span
                data-testid={`despesa-rateio-valor-${idx}`}
                style={{ flex: '0 0 110px', fontSize: 13, color: '#374151', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
              >
                {fmtBRL(valorLinha)}
              </span>
              <button
                type="button"
                aria-label="Remover centro do rateio"
                data-testid={`despesa-rateio-remover-${idx}`}
                onClick={() => removeLinha(idx)}
                style={{ flex: '0 0 auto', background: 'none', border: 'none', color: '#b91c1c', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          )
        })}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            data-testid="despesa-rateio-adicionar"
            onClick={addLinha}
            style={{ background: 'none', border: 'none', padding: 0, color: '#8a6d00', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            + Adicionar centro de custo
          </button>
          {linhas.length > 0 && (
            <span data-testid="despesa-rateio-soma" style={{ fontSize: 13, fontWeight: 600, color: corSoma, fontVariantNumeric: 'tabular-nums' }}>
              Soma: {soma.toFixed(2).replace('.', ',')}%
              {!fecha && <span style={{ fontWeight: 500 }}> (precisa dar 100%)</span>}
            </span>
          )}
        </div>
      </div>
    </Campo>
  )
}
