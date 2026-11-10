'use client'
// Aba Preço e desconto do painel v7 (SPEC §2.6). Só desenha: números de calcularPrecoV7 (precoV7.ts).
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { PrecoV7 } from './precoV7'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel-v6'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const pct = (v: number) => `${nf({ maximumFractionDigits: 2 }).format(v)}%`

type Props = { preco: PrecoV7 }

export function AbaPrecoV7({ preco }: Props) {
  const [ord, setOrd] = useState<{ k: 'desc' | 'abaixoPct' | 'val' | 'rpkg'; dir: 1 | -1 }>({ k: 'desc', dir: -1 })
  const tabela = useMemo(() => [...preco.clientes].sort((a, b) => {
    const va = (a[ord.k] as number | null) ?? -1
    const vb = (b[ord.k] as number | null) ?? -1
    return (va - vb) * ord.dir
  }), [preco.clientes, ord])
  const seta = (k: typeof ord.k) => ord.k === k ? (ord.dir === -1 ? ' ↓' : ' ↑') : ''
  const maxFaixa = Math.max(1, ...preco.faixas.map((f) => f.val))

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>
        No período, <b>{brl0(preco.descR)}</b> de desconto concedido (<b>{pct(preco.descPct)}</b> sobre a tabela), em <b>{pct(preco.itensAbaixoPct)}</b> dos itens. Onde o preço mais cai — por vendedor, produto e cliente.
      </p>

      {/* Faixas de desconto */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Onde o preço cai<AjudaCampo chave="com.painel.desconto" rota={ROTA} /></div>
        <div style={{ display: 'grid', gap: 8 }}>
          {preco.faixas.map((f) => (
            <div key={f.faixa} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <span>{f.faixa}</span>
              <span style={{ height: 14, background: C.bg2, borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: 14, width: `${(100 * f.val) / maxFaixa}%`, background: f.faixa === 'Acima da tabela' || f.faixa === 'Na tabela' ? C.ok : C.gold }} />
              </span>
              <span style={{ color: C.m, textAlign: 'right' }}>{brl0(f.val)} · {int(f.itens)} itens</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.m, marginTop: 8 }}>Faixas somam o faturamento total; itens em verde estão na tabela ou acima dela.</div>
      </div>

      {/* Quem vende mais caro e mais barato: barras divergentes em relação à média */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>Quem vende mais caro e mais barato<AjudaCampo chave="com.painel.indice" rota={ROTA} /></div>
        <div style={{ fontSize: 12, color: C.m, marginBottom: 8 }}>Índice de preço por vendedor, em relação à média (100 = média da empresa{preco.mediaIdx != null ? `; média: ${nf({ maximumFractionDigits: 1 }).format(preco.mediaIdx)}` : ''}).</div>
        <div style={{ width: '100%', height: Math.max(180, preco.vendedores.length * 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={preco.vendedores.map((v) => ({ nome: v.nome, desvio: v.desvio ?? 0, idx: v.idx }))} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={C.bd} />
              <XAxis type="number" tick={{ fontSize: 11, fill: C.m }} />
              <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 12, fill: C.esp }} />
              <Tooltip formatter={(v, _n, p) => `índice ${nf({ maximumFractionDigits: 1 }).format(Number((p as any)?.payload?.idx ?? 0))}`} />
              <Bar dataKey="desvio" radius={[0, 4, 4, 0]}>
                {preco.vendedores.map((v, i) => <Cell key={i} fill={(v.desvio ?? 0) >= 0 ? C.ok : C.bad} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Desconto por cliente: TODOS os clientes, ordenável */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Desconto por cliente ({int(tabela.length)})</div>
        <div style={{ fontSize: 12, color: C.m, marginBottom: 8 }}>Onde está o dinheiro que ficou na mesa. Vendedor = quem mais vendeu para o cliente no período.</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
            <thead>
              <tr style={{ color: C.m, textAlign: 'left' }}>
                <th style={{ padding: '6px 4px' }}>Cliente</th><th style={{ padding: '6px 4px' }}>Cidade</th><th style={{ padding: '6px 4px' }}>Vendedor</th>
                {([['% abaixo da tabela', 'abaixoPct'], ['Desconto', 'desc'], ['Faturamento', 'val'], ['R$/kg', 'rpkg']] as [string, typeof ord.k][]).map(([rot, k]) => (
                  <th key={rot} style={{ padding: '6px 4px', textAlign: 'right' }}>
                    <button type="button" onClick={() => setOrd((o) => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : -1 }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.m, fontWeight: 600, fontSize: 13, padding: 0 }}>{rot}{seta(k)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabela.map((c) => (
                <tr key={c.ci} style={{ borderTop: `1px solid ${C.bd}` }}>
                  <td style={{ padding: '6px 4px' }}>{c.nome}</td>
                  <td style={{ padding: '6px 4px', color: C.m }}>{c.cidade}</td>
                  <td style={{ padding: '6px 4px', color: C.m }}>{c.vendedor}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 70, height: 8, background: C.bg2, borderRadius: 4, overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: 8, width: `${Math.min(100, c.abaixoPct)}%`, background: C.bad }} />
                      </span>
                      {pct(c.abaixoPct)}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(c.desc)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(c.val)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(c.rpkg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
