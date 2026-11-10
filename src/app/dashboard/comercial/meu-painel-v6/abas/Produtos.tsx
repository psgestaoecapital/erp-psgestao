'use client'
// Painel Comercial v6 — aba "Produtos": todos os produtos e onde o preço cai (dispersão de preço por produto).
// Do motor-v5 (prodM por produto, pPrice = R$/kg do produto, prodItens = preços unitários item a item). Só desenha.
import { useMemo, useState } from 'react'
import type { BaseV5, ModeloV5, ResumoV5 } from '../../meu-painel/motor-v5'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Bloco } from './ui'
import { C, ROTA, brl0, brl2, int, pct, ton } from './fmt'

export function Produtos({ base, modelo, r }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  const tot = modelo.tot.val || 1
  const [busca, setBusca] = useState('')

  const produtos = useMemo(() => {
    return [...modelo.prodM.entries()]
      .map(([idx, a]) => ({
        nome: base.prod[idx]?.[0] ?? `Produto ${idx}`,
        linha: base.prod[idx]?.[1] ?? '',
        carne: !!base.prod[idx]?.[2],
        val: a.val, kg: a.kg, part: a.val / tot,
        rkg: modelo.pPrice.get(idx) ?? (a.kgP > 0 ? a.valP / a.kgP : null),
      }))
      .sort((a, b) => b.val - a.val)
  }, [modelo, base, tot])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? produtos.filter((p) => p.nome.toLowerCase().includes(q)) : produtos
  }, [produtos, busca])

  // Onde o preço cai: dispersão do preço unitário (R$/kg) por produto — gap entre a venda mais cara e a mais barata.
  const dispersao = useMemo(() => {
    const out: { nome: string; medio: number; min: number; max: number; spread: number; n: number }[] = []
    for (const [idx, precos] of modelo.prodItens.entries()) {
      if (!base.prod[idx]?.[2] || precos.length < 5) continue // só carne, com amostra mínima
      let min = Infinity, max = -Infinity, soma = 0
      for (const p of precos) { if (p < min) min = p; if (p > max) max = p; soma += p }
      const medio = soma / precos.length
      if (medio <= 0) continue
      out.push({ nome: base.prod[idx]?.[0] ?? `Produto ${idx}`, medio, min, max, spread: (max - min) / medio, n: precos.length })
    }
    return out.sort((a, b) => b.spread - a.spread).slice(0, 10)
  }, [modelo, base])

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período. Nada a mostrar por produto.
      </div>
    )
  }

  return (
    <>
      <Bloco titulo="Todos os produtos" chave="comv6.prod_todos">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          São <b>{int(produtos.length)} produtos</b>. O campeão é <b>{produtos[0]?.nome}</b> com <b>{brl0(produtos[0]?.val)}</b>.
        </p>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.m, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>Buscar produto<AjudaCampo chave="comv6.prod_busca" rota={ROTA} /></span>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto…"
            aria-label="Buscar produto"
            style={{ display: 'block', width: '100%', maxWidth: 320, padding: '8px 10px', border: `1px solid ${C.bd}`, borderRadius: 8, fontSize: 14, background: '#fff', color: C.esp }}
          />
        </label>
        {filtrados.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 460 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.m, borderBottom: `1px solid ${C.bd}` }}>
                  <th style={{ padding: '6px 8px' }}>Produto</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Faturamento</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Volume</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>R$/kg</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Part.</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.nome} style={{ borderBottom: `1px solid ${C.off}` }}>
                    <td style={{ padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{p.nome}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{brl0(p.val)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{ton(p.kg)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{p.carne && p.rkg != null ? brl2(p.rkg) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(p.part)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: C.m, margin: 0 }}>Nenhum produto encontrado para “{busca}”.</p>
        )}
      </Bloco>

      <Bloco titulo="Onde o preço cai" chave="comv6.prod_preco_cai">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Produtos em que o mesmo corte é vendido a preços bem diferentes — onde o controle de preço escapa. Mostra o preço médio, o mais baixo e o mais alto do período.
        </p>
        {dispersao.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {dispersao.map((d) => (
              <div key={d.nome}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nome}</span>
                  <span style={{ color: C.m, flexShrink: 0 }}>variação {pct(d.spread)}</span>
                </div>
                <div style={{ fontSize: 11, color: C.d, marginTop: 2 }}>
                  mín {brl2(d.min)}/kg · médio {brl2(d.medio)}/kg · máx {brl2(d.max)}/kg · {int(d.n)} vendas
                </div>
                {/* faixa min–max com o médio marcado */}
                <div style={{ position: 'relative', height: 8, background: C.bd, borderRadius: 4, marginTop: 4 }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 3, height: 2, background: C.d }} />
                  <div title={`médio ${brl2(d.medio)}`} style={{ position: 'absolute', left: `${Math.round(((d.medio - d.min) / Math.max(0.01, d.max - d.min)) * 100)}%`, top: -1, width: 2, height: 10, background: C.esp }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 14, color: C.m, margin: 0 }}>Sem produtos com amostra suficiente para avaliar a dispersão de preço no período.</p>
        )}
      </Bloco>
    </>
  )
}
