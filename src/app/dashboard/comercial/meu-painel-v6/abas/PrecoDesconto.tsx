'use client'
// Painel Comercial v6 — aba "Preço e desconto": quem vende mais caro/barato e o desconto por cliente.
// Do motor-v5 (venM com valP/kgP por vendedor; modelo.clis com desc/tab por cliente). Só desenha.
import { useMemo } from 'react'
import type { BaseV5, ModeloV5, ResumoV5 } from '../../meu-painel/motor-v5'
import { Bloco } from './ui'
import { C, brl0, brl2, int, pct } from './fmt'

export function PrecoDesconto({ base, modelo, r }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  const mediaRkg = r.precoPorKg

  // Quem vende mais caro e mais barato: vendedores por R$/kg da análise.
  const porPreco = useMemo(() => {
    return [...modelo.venM.entries()]
      .map(([idx, a]) => ({ nome: base.ven[idx]?.[1] || base.ven[idx]?.[0] || `#${idx}`, rkg: a.kgP > 0 ? a.valP / a.kgP : null, val: a.val }))
      .filter((v) => v.rkg != null)
      .sort((a, b) => (b.rkg as number) - (a.rkg as number))
  }, [modelo, base])

  // Desconto por cliente: maiores descontos em reais e em % sobre a tabela.
  const descCli = useMemo(() => {
    return modelo.clis
      .filter((c) => c.desc > 0 && c.tab > 0)
      .map((c) => ({ nome: c.nome, desc: c.desc, pct: c.desc / c.tab, val: c.val }))
      .sort((a, b) => b.desc - a.desc)
      .slice(0, 12)
  }, [modelo])

  const descTotal = useMemo(() => {
    let desc = 0, tab = 0
    for (const c of modelo.clis) { desc += c.desc; tab += c.tab }
    return { desc, pct: tab > 0 ? desc / tab : 0 }
  }, [modelo])

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período. Nada a mostrar.
      </div>
    )
  }

  const maxRkg = Math.max(...porPreco.map((v) => v.rkg as number), mediaRkg || 1)

  return (
    <>
      <Bloco titulo="Quem vende mais caro e mais barato" chave="comv6.pd_caro_barato">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Preço médio por vendedor frente à média da empresa (<b>{brl2(mediaRkg)}/kg</b>). A barra cheia é o maior preço do período.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {porPreco.map((v) => {
            const acima = (v.rkg as number) >= mediaRkg
            return (
              <div key={v.nome}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nome}</span>
                  <span style={{ color: acima ? '#2E7D32' : '#C0392B', flexShrink: 0 }}>{acima ? '▲' : '▼'} {brl2(v.rkg)}/kg</span>
                </div>
                <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(2, Math.round(((v.rkg as number) / maxRkg) * 100))}%`, background: acima ? '#2E7D32' : C.gold }} />
                </div>
              </div>
            )
          })}
        </div>
      </Bloco>

      <Bloco titulo="Desconto por cliente" chave="comv6.pd_desc_cliente">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          No período a empresa deu <b>{brl0(descTotal.desc)}</b> de desconto sobre a tabela (<b>{pct(descTotal.pct)}</b> do valor de tabela). Os maiores descontos, por cliente:
        </p>
        {descCli.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 380 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.m, borderBottom: `1px solid ${C.bd}` }}>
                  <th style={{ padding: '6px 8px' }}>Cliente</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Desconto</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>% tabela</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Faturamento</th>
                </tr>
              </thead>
              <tbody>
                {descCli.map((c) => (
                  <tr key={c.nome} style={{ borderBottom: `1px solid ${C.off}` }}>
                    <td style={{ padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{c.nome}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{brl0(c.desc)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: c.pct > 0.05 ? '#C0392B' : C.esp }}>{pct(c.pct)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{brl0(c.val)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: C.m, margin: 0 }}>Nenhum desconto sobre a tabela no período.</p>
        )}
      </Bloco>
    </>
  )
}
