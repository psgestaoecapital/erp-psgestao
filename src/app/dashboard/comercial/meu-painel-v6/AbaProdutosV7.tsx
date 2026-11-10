'use client'
// Aba Produtos do painel v7 (SPEC §2.5). Só desenha: números de calcularProdutosV7 (produtos-v7.ts).
import { useMemo, useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { BaseV5, ModeloV5 } from '../meu-painel/motor-v5'
import type { ProdutosV7, ProdutoV7 } from './produtos-v7'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel-v6'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const pct = (v: number) => `${nf({ maximumFractionDigits: 1 }).format(v)}%`
// Semáforo só de performance: índice de preço (100 = média) e desconto (vermelho acima de 2%).
const corIndice = (i: number | null) => i == null ? C.d : i >= 100 ? C.ok : i >= 95 ? C.warn : C.bad
const corDesconto = (d: number) => d > 2 ? C.bad : d > 1 ? C.warn : C.ok

type Props = { produtos: ProdutosV7; base: BaseV5; modelo: ModeloV5; onAbrirAnalise: () => void }

export function AbaProdutosV7({ produtos, base, modelo, onAbrirAnalise }: Props) {
  const [ord, setOrd] = useState<{ k: keyof ProdutoV7; dir: 1 | -1 }>({ k: 'val', dir: -1 })
  const dentro = produtos.linhas.filter((l) => l.dentro).length
  const total = produtos.totalProdutos
  const top = produtos.maior
  const tabela = useMemo(() => [...produtos.linhas].sort((a, b) => {
    const va = (a[ord.k] as unknown as number | string | null) ?? -1
    const vb = (b[ord.k] as unknown as number | string | null) ?? -1
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * ord.dir
    return ((va as number) - (vb as number)) * ord.dir
  }), [produtos.linhas, ord])
  const seta = (k: keyof ProdutoV7) => ord.k === k ? (ord.dir === -1 ? ' ↓' : ' ↑') : ''
  const cortes = new Set(produtos.linhas.map((l) => l.linha)).size

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 15, margin: 0 }}>
          <b>{int(total)} produtos</b> vendidos no período. <b>{int(dentro)} de {int(total)}</b> entram no preço médio.
        </p>
        <button type="button" onClick={onAbrirAnalise} style={{ padding: '10px 14px', minHeight: 44, borderRadius: 10, border: `1px solid ${C.gold}`, background: '#fff', color: C.esp, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Produtos na análise · {int(dentro)} de {int(total)}
        </button>
      </div>

      {/* 4 cards (SPEC §2.5) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Produtos vendidos<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{int(total)}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Cortes (linhas)<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{int(cortes)}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Peso do maior produto<AjudaCampo chave="com.painel.participacao" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{top ? pct(top.part) : '—'}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Mais vendido<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{top ? top.nome : '—'}</div>
          <div style={{ fontSize: 12, color: C.m }}>{top ? brl0(top.val) : ''}</div>
        </div>
      </div>

      {/* Tabela: TODOS os produtos, ordenável */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Todos os produtos ({int(tabela.length)})</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1020 }}>
            <thead>
              <tr style={{ color: C.m, textAlign: 'left' }}>
                {([['Produto', 'nome'], ['Linha', 'linha'], ['Faturamento', 'val'], ['Part.', 'part'], ['Volume', 'kg'], ['R$/kg', 'rpkg'], ['Índice', 'indice'], ['Desconto', 'desc'], ['% itens abaixo', 'pctAbaixo'], ['Clientes', 'clientes']] as [string, keyof ProdutoV7][]).map(([rot, k]) => (
                  <th key={rot} style={{ padding: '6px 4px', textAlign: k === 'nome' || k === 'linha' ? 'left' : 'right' }}>
                    <button type="button" onClick={() => setOrd((o) => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : -1 }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.m, fontWeight: 600, fontSize: 13, padding: 0 }}>{rot}{seta(k)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabela.map((l) => (
                <tr key={l.pi} style={{ borderTop: `1px solid ${C.bd}`, opacity: l.dentro ? 1 : 0.6 }}>
                  <td style={{ padding: '6px 4px' }}>
                    {l.nome}{!l.dentro && <span style={{ marginLeft: 6, fontSize: 11, color: C.m, border: `1px solid ${C.bd}`, borderRadius: 999, padding: '1px 6px' }}>fora da análise</span>}
                  </td>
                  <td style={{ padding: '6px 4px', color: C.m }}>{l.linha}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.val)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{pct(l.part)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 0 }).format(l.kg)} kg</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(l.rpkg)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: corIndice(l.indice), fontWeight: 600 }}>{l.indice == null ? '—' : int(l.indice)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: corDesconto(l.desc) }}>{pct(l.desc)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{pct(l.pctAbaixo)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(l.clientes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: C.m, marginTop: 8 }}><b>Sem margem:</b> o custo do ERP de origem vem zerado. Não inventamos número de margem.</div>
      </div>
    </div>
  )
}
