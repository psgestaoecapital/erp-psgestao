'use client'

import { useState } from 'react'
import { C, fmtBRL, fmtPct } from './index'

type Linha = {
  ln_id: string
  ln_nome: string
  rob: number
  cmv: number
  desp_variavel: number
  desp_fixa: number
  margem_bruta: number
  ebitda_pre_rateio: number
  rateio_sede_recebido: number
  ebitda_pos_rateio: number
  ebitda_pct_pos_rateio: number
  qtd_lancamentos: number
}

type Totais = {
  receita_total: number
  ebitda_pre_total: number
  rateio_total: number
  ebitda_real_total: number
  qtd_lancamentos_total: number
}

export function TabelaDetalhada({ linhas, totais }: { linhas: Linha[]; totais: Totais }) {
  const [expanded, setExpanded] = useState(true)

  const cmvTotal = linhas.reduce((s, l) => s + l.cmv, 0)
  const dvTotal = linhas.reduce((s, l) => s + l.desp_variavel, 0)
  const dfTotal = linhas.reduce((s, l) => s + l.desp_fixa, 0)
  const mbTotal = linhas.reduce((s, l) => s + l.margem_bruta, 0)
  const pctRealTotal = totais.receita_total > 0
    ? (totais.ebitda_real_total / totais.receita_total) * 100
    : 0

  return (
    <section style={{ background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 20 }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%', padding: '14px 20px',
          border: 'none', background: C.beigeLt,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', textAlign: 'left' as const,
          borderBottom: expanded ? `1px solid ${C.borderLt}` : 'none',
        }}
      >
        <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, color: C.espresso }}>
          Detalhamento por linha
        </span>
        <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>
          {expanded ? '▾ Recolher' : '▸ Expandir'}
        </span>
      </button>

      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.offwhite }}>
                <Th>Linha de Negócio</Th>
                <ThNum>Receita</ThNum>
                <ThNum>CMV</ThNum>
                <ThNum>Margem Bruta</ThNum>
                <ThNum>Desp. Variável</ThNum>
                <ThNum>Desp. Fixa</ThNum>
                <ThNum>EBITDA Pré</ThNum>
                <ThNum>Rateio SEDE</ThNum>
                <ThNum>EBITDA Real</ThNum>
                <ThNum>%</ThNum>
                <ThNum>Lcto.</ThNum>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => {
                const corReal = l.ebitda_pos_rateio >= 0 ? C.green : C.red
                return (
                  <tr key={l.ln_id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <span style={{ fontWeight: 600, color: C.espresso }}>{l.ln_nome}</span>
                    </Td>
                    <TdNum>{fmtBRL(l.rob)}</TdNum>
                    <TdNum>{fmtBRL(l.cmv)}</TdNum>
                    <TdNum>{fmtBRL(l.margem_bruta)}</TdNum>
                    <TdNum>{fmtBRL(l.desp_variavel)}</TdNum>
                    <TdNum>{fmtBRL(l.desp_fixa)}</TdNum>
                    <TdNum>{fmtBRL(l.ebitda_pre_rateio)}</TdNum>
                    <TdNum>{l.rateio_sede_recebido > 0 ? `-${fmtBRL(l.rateio_sede_recebido)}` : fmtBRL(0)}</TdNum>
                    <TdNum style={{ color: corReal, fontWeight: 700 }}>{fmtBRL(l.ebitda_pos_rateio)}</TdNum>
                    <TdNum style={{ color: corReal }}>{fmtPct(l.ebitda_pct_pos_rateio)}</TdNum>
                    <TdNum>{l.qtd_lancamentos}</TdNum>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${C.borderLt}`, background: C.beigeLt }}>
                <Td><strong style={{ color: C.espresso }}>TOTAL</strong></Td>
                <TdNum strong>{fmtBRL(totais.receita_total)}</TdNum>
                <TdNum strong>{fmtBRL(cmvTotal)}</TdNum>
                <TdNum strong>{fmtBRL(mbTotal)}</TdNum>
                <TdNum strong>{fmtBRL(dvTotal)}</TdNum>
                <TdNum strong>{fmtBRL(dfTotal)}</TdNum>
                <TdNum strong>{fmtBRL(totais.ebitda_pre_total)}</TdNum>
                <TdNum strong>{totais.rateio_total > 0 ? `-${fmtBRL(totais.rateio_total)}` : fmtBRL(0)}</TdNum>
                <TdNum strong style={{ color: totais.ebitda_real_total >= 0 ? C.green : C.red }}>
                  {fmtBRL(totais.ebitda_real_total)}
                </TdNum>
                <TdNum strong style={{ color: totais.ebitda_real_total >= 0 ? C.green : C.red }}>
                  {fmtPct(pctRealTotal)}
                </TdNum>
                <TdNum strong>{totais.qtd_lancamentos_total}</TdNum>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function Th({ children }: { children: any }) {
  return <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)', whiteSpace: 'nowrap' }}>{children}</th>
}
function ThNum({ children }: { children: any }) {
  return <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children }: { children: any }) {
  return <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{children}</td>
}
function TdNum({ children, strong, style }: { children: any; strong?: boolean; style?: any }) {
  return (
    <td
      style={{
        padding: '10px 12px',
        textAlign: 'right',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'nowrap',
        fontWeight: strong ? 700 : 500,
        ...(style || {}),
      }}
    >
      {children}
    </td>
  )
}
