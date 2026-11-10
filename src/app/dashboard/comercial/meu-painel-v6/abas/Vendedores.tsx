'use client'
// Painel Comercial v6 — aba "Vendedores": quem vende quanto, com que desconto/devolução e o que cada um vende.
// Só desenha; os recortes vêm do motor-v5 (venM, devVen) e dos itens já filtrados (modelo.its). Escopo travado no banco.
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { gruposProduto, type BaseV5, type ModeloV5, type ResumoV5 } from '../../meu-painel/motor-v5'
import { Bloco } from './ui'
import { C, brl0, brl2, int, pct, ton } from './fmt'

const GRUPO = [
  { k: 0, nome: 'Desossado', cor: '#8C5A2B' },
  { k: 1, nome: 'Com osso', cor: '#C8941A' },
  { k: 2, nome: 'Miúdo', cor: '#B08D57' },
  { k: 3, nome: 'Outros', cor: '#D9CBB8' },
]

export function Vendedores({ base, modelo, r }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  const PG = useMemo(() => gruposProduto(base), [base])

  const vend = useMemo(() => {
    const tot = modelo.tot.val || 1
    return [...modelo.venM.entries()].map(([idx, a]) => {
      const dev = modelo.devVen.get(idx) ?? 0
      return {
        idx,
        nome: base.ven[idx]?.[1] || base.ven[idx]?.[0] || `#${idx}`,
        val: a.val, part: a.val / tot,
        rkg: a.kgP > 0 ? a.valP / a.kgP : null,
        clientes: a.clis.size, notas: a.notas.size,
        descRs: a.desc, descPct: a.tab > 0 ? a.desc / a.tab : null,
        devRs: dev, devPct: a.val > 0 ? dev / a.val : null,
      }
    }).sort((a, b) => b.val - a.val)
  }, [modelo, base])

  // "O que cada um vende": share de faturamento por grupo de produto, por vendedor.
  const mix = useMemo(() => {
    const porVen = new Map<number, number[]>()
    for (const it of modelo.its) {
      const g = PG[it[4]]
      let arr = porVen.get(it[2])
      if (!arr) { arr = [0, 0, 0, 0]; porVen.set(it[2], arr) }
      arr[g] += it[6]
    }
    return vend.map((v) => {
      const arr = porVen.get(v.idx) ?? [0, 0, 0, 0]
      const total = arr.reduce((s, x) => s + x, 0) || 1
      return { idx: v.idx, nome: v.nome, partes: arr.map((x) => x / total) }
    })
  }, [modelo, PG, vend])

  const mediaRkg = r.precoPorKg

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período. Nada a mostrar por vendedor.
      </div>
    )
  }
  if (base.modo === 'vendedor') {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, color: C.m }}>
        Você vê apenas os seus próprios números — o comparativo entre vendedores fica disponível para o gestor da equipe.
      </div>
    )
  }

  const lider = vend[0]

  return (
    <>
      <Bloco titulo="Quem vende quanto" chave="comv6.vend_quanto">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          {lider ? <><b>{lider.nome}</b> lidera com <b>{brl0(lider.val)}</b> ({pct(lider.part)} do total), atendendo {int(lider.clientes)} clientes.</> : null}
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {vend.map((v) => (
            <div key={v.idx}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nome}</span>
                <span style={{ color: C.m, flexShrink: 0 }}>{brl0(v.val)} · {pct(v.part)}</span>
              </div>
              <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, Math.round(v.part * 100))}%`, background: C.gold }} />
              </div>
              <div style={{ fontSize: 11, color: C.d, marginTop: 2 }}>{int(v.clientes)} clientes · {int(v.notas)} notas</div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Placar dos vendedores" chave="comv6.vend_placar">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Preço médio de cada um frente à média da empresa (<b>{brl2(mediaRkg)}/kg</b>). Vender caro com pouco desconto e pouca devolução é o ideal.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.m, borderBottom: `1px solid ${C.bd}` }}>
                <th style={{ padding: '6px 8px' }}>#</th>
                <th style={{ padding: '6px 8px' }}>Vendedor</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Faturamento</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>R$/kg</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Desconto</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Devolução</th>
              </tr>
            </thead>
            <tbody>
              {vend.map((v, i) => {
                const acima = v.rkg != null && v.rkg >= mediaRkg
                return (
                  <tr key={v.idx} style={{ borderBottom: `1px solid ${C.off}` }}>
                    <td style={{ padding: '6px 8px', color: C.d }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{v.nome}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{brl0(v.val)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: v.rkg == null ? C.d : acima ? '#2E7D32' : '#C0392B' }}>{v.rkg == null ? '—' : <>{acima ? '▲' : '▼'} {brl2(v.rkg)}</>}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(v.descPct)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: (v.devPct ?? 0) > 0.02 ? '#C0392B' : C.esp }}>{pct(v.devPct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Bloco>

      <Bloco titulo="Desconto × devolução" chave="comv6.vend_desc_dev">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Quanto cada vendedor deu de desconto e quanto voltou em devolução, em reais, no período.
        </p>
        <div style={{ width: '100%', height: Math.max(180, vend.length * 34) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={vend.map((v) => ({ nome: v.nome, Desconto: Math.round(v.descRs), Devolução: Math.round(v.devRs) }))} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={C.bd} />
              <XAxis type="number" tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 10, fill: C.m }} />
              <YAxis type="category" dataKey="nome" tick={{ fontSize: 11, fill: C.m }} width={110} />
              <Tooltip formatter={(v) => brl0(Number(v))} />
              <Bar dataKey="Desconto" fill={C.gold} radius={[0, 4, 4, 0]} />
              <Bar dataKey="Devolução" fill="#C0392B" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Bloco>

      <Bloco titulo="O que cada um vende" chave="comv6.vend_mix">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          A composição do faturamento de cada vendedor por tipo de produto.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, fontSize: 12, color: C.m }}>
          {GRUPO.map((g) => <span key={g.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: g.cor, display: 'inline-block' }} />{g.nome}</span>)}
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {mix.map((m) => (
            <div key={m.idx}>
              <div style={{ fontSize: 13, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.nome}</div>
              <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', background: C.bd }}>
                {GRUPO.map((g) => m.partes[g.k] > 0 ? (
                  <div key={g.k} title={`${g.nome}: ${pct(m.partes[g.k])}`} style={{ width: `${m.partes[g.k] * 100}%`, background: g.cor }} />
                ) : null)}
              </div>
            </div>
          ))}
        </div>
      </Bloco>
    </>
  )
}
