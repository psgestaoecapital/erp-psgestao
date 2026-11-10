'use client'
// Painel Comercial v6 — aba "Clientes": quem compra, o quanto dependemos de poucos, quem compra mais linhas,
// o tamanho das notas, os grupos econômicos e a saúde da carteira. Tudo do motor-v5 (modelo.clis já traz
// recência, frequência, curva ABC e segmento) — a tela só desenha.
import { useMemo } from 'react'
import type { BaseV5, ModeloV5, ResumoV5 } from '../../meu-painel/motor-v5'
import { Bloco } from './ui'
import { C, brl0, int, pct } from './fmt'

// Segmentos do motor (ordem = código seg 0..5).
const SEG = [
  { k: 0, nome: 'Campeões', desc: 'compram muito e sempre', cor: '#2E7D32' },
  { k: 1, nome: 'Fiéis', desc: 'compram com frequência', cor: '#558B2F' },
  { k: 2, nome: 'Novos', desc: 'primeira compra recente', cor: '#C8941A' },
  { k: 3, nome: 'Ativos', desc: 'compraram há pouco', cor: '#8C5A2B' },
  { k: 4, nome: 'Regulares', desc: 'compram de vez em quando', cor: '#B08D57' },
  { k: 5, nome: 'Adormecidos', desc: 'há tempo sem comprar', cor: '#C0392B' },
]
const CURVA = ['A (até 80%)', 'B (80–95%)', 'C (95–100%)']

export function Clientes({ base, modelo, r }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  const tot = modelo.tot.val || 1

  // Os N clientes em 6 grupos (segmentos) — contagem e faturamento.
  const segmentos = useMemo(() => {
    const m = new Map<number, { n: number; val: number }>()
    for (const c of modelo.clis) {
      let a = m.get(c.seg); if (!a) { a = { n: 0, val: 0 }; m.set(c.seg, a) }
      a.n++; a.val += c.val
    }
    return SEG.map((s) => ({ ...s, n: m.get(s.k)?.n ?? 0, val: m.get(s.k)?.val ?? 0 }))
  }, [modelo])

  // Quanto dependemos de poucos — curva ABC.
  const curva = useMemo(() => {
    const m = [0, 1, 2].map((k) => ({ k, n: 0, val: 0 }))
    for (const c of modelo.clis) { m[c.cur].n++; m[c.cur].val += c.val }
    return m
  }, [modelo])
  const clientesA = curva[0]

  // Quem compra mais linhas gasta mais — ticket médio por nº de linhas compradas.
  const porLinhas = useMemo(() => {
    const m = new Map<number, { n: number; val: number }>()
    for (const c of modelo.clis) { const nl = Math.min(3, c.nl); let a = m.get(nl); if (!a) { a = { n: 0, val: 0 }; m.set(nl, a) } a.n++; a.val += c.val }
    return [1, 2, 3].map((nl) => { const a = m.get(nl) ?? { n: 0, val: 0 }; return { nl, n: a.n, medio: a.n ? a.val / a.n : 0 } }).filter((x) => x.n > 0)
  }, [modelo])

  // Tamanho das notas — distribuição do valor por nota fiscal.
  const faixasNota = useMemo(() => {
    const porNota = new Map<number, number>()
    for (const it of modelo.its) porNota.set(it[1], (porNota.get(it[1]) ?? 0) + it[6])
    const faixas = [
      { nome: 'até R$ 1 mil', lim: 1000, n: 0 },
      { nome: 'R$ 1–5 mil', lim: 5000, n: 0 },
      { nome: 'R$ 5–20 mil', lim: 20000, n: 0 },
      { nome: 'R$ 20–50 mil', lim: 50000, n: 0 },
      { nome: 'acima de R$ 50 mil', lim: Infinity, n: 0 },
    ]
    for (const val of porNota.values()) { const f = faixas.find((x) => val <= x.lim); if (f) f.n++ }
    const totN = porNota.size || 1
    return faixas.map((f) => ({ nome: f.nome, n: f.n, part: f.n / totN }))
  }, [modelo])

  // Grupos econômicos (CNPJ raiz com 2+ lojas) — ranking por faturamento.
  const grupos = useMemo(() => {
    return [...modelo.gEcoM.entries()]
      .map(([idx, a]) => ({ nome: base.grp[idx] ?? `Grupo ${idx}`, val: a.val, clientes: a.clis.size, part: a.val / tot }))
      .sort((a, b) => b.val - a.val)
  }, [modelo, base, tot])

  // Saúde da carteira — ativos (seg 0..4) × adormecidos (seg 5).
  const saude = useMemo(() => {
    const ativos = segmentos.filter((s) => s.k <= 4).reduce((s, x) => s + x.n, 0)
    const adorm = segmentos.find((s) => s.k === 5)?.n ?? 0
    const total = ativos + adorm || 1
    return { ativos, adorm, pctAtivos: ativos / total }
  }, [segmentos])

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período. Nada a mostrar por cliente.
      </div>
    )
  }

  return (
    <>
      <Bloco titulo="Os clientes em 6 grupos" chave="comv6.cli_segmentos">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Os <b>{int(r.clientes)} clientes</b> do período, agrupados por como compram.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {segmentos.map((s) => (
            <div key={s.k} style={{ border: `1px solid ${C.bd}`, borderRadius: 10, padding: 12, borderLeft: `4px solid ${s.cor}` }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.nome}</div>
              <div style={{ fontSize: 11, color: C.d, marginBottom: 6 }}>{s.desc}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{int(s.n)}</div>
              <div style={{ fontSize: 11, color: C.m }}>{brl0(s.val)} · {pct(s.val / tot)}</div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Quanto dependemos de poucos" chave="comv6.cli_concentracao">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          <b>{int(clientesA.n)} clientes</b> ({pct(clientesA.n / (modelo.clis.length || 1))} da carteira) respondem por <b>80%</b> do faturamento (curva ABC).
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {curva.map((c) => (
            <div key={c.k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>Classe {CURVA[c.k]}</span>
                <span style={{ color: C.m }}>{int(c.n)} clientes · {brl0(c.val)}</span>
              </div>
              <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, Math.round((c.val / tot) * 100))}%`, background: c.k === 0 ? C.gold : c.k === 1 ? '#B08D57' : C.bd }} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Quem compra mais linhas gasta mais" chave="comv6.cli_linhas">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Clientes que levam mais tipos de produto têm ticket maior — motivo para ampliar o mix de cada cliente.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {porLinhas.map((x) => {
            const maxMedio = Math.max(...porLinhas.map((y) => y.medio), 1)
            return (
              <div key={x.nl}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{x.nl} {x.nl === 1 ? 'tipo' : 'tipos'} de produto</span>
                  <span style={{ color: C.m }}>{brl0(x.medio)}/cliente · {int(x.n)} clientes</span>
                </div>
                <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(2, Math.round((x.medio / maxMedio) * 100))}%`, background: C.gold }} />
                </div>
              </div>
            )
          })}
        </div>
      </Bloco>

      <Bloco titulo="Tamanho das notas" chave="comv6.cli_notas">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          A distribuição das notas fiscais por valor — mostra se a empresa vive de muitas notas pequenas ou de poucas grandes.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {faixasNota.map((f) => (
            <div key={f.nome}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{f.nome}</span>
                <span style={{ color: C.m }}>{int(f.n)} notas · {pct(f.part)}</span>
              </div>
              <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, Math.round(f.part * 100))}%`, background: C.esp }} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Grupos econômicos" chave="comv6.cli_grupos">
        {grupos.length ? (
          <>
            <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
              Redes com mais de uma loja (mesmo CNPJ raiz). O maior grupo compra <b>{brl0(grupos[0].val)}</b> em {int(grupos[0].clientes)} lojas.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {grupos.slice(0, 10).map((g) => (
                <div key={g.nome}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.nome}</span>
                    <span style={{ color: C.m, flexShrink: 0 }}>{brl0(g.val)} · {int(g.clientes)} lojas</span>
                  </div>
                  <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(2, Math.round(g.part * 100))}%`, background: C.gold }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 14, color: C.m, margin: 0 }}>Nenhum grupo econômico identificado no período (clientes com mais de uma loja pelo CNPJ raiz).</p>
        )}
      </Bloco>

      <Bloco titulo="Saúde da carteira" chave="comv6.cli_saude">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          <b>{pct(saude.pctAtivos)}</b> da carteira está ativa ({int(saude.ativos)} clientes); <b>{int(saude.adorm)}</b> estão adormecidos e merecem reativação.
        </p>
        <div style={{ display: 'flex', height: 18, borderRadius: 6, overflow: 'hidden', background: C.bd }}>
          <div title={`Ativos: ${int(saude.ativos)}`} style={{ width: `${saude.pctAtivos * 100}%`, background: '#2E7D32' }} />
          <div title={`Adormecidos: ${int(saude.adorm)}`} style={{ flex: 1, background: '#C0392B' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.m, marginTop: 4 }}>
          <span>Ativos {int(saude.ativos)}</span>
          <span>Adormecidos {int(saude.adorm)}</span>
        </div>
      </Bloco>
    </>
  )
}
