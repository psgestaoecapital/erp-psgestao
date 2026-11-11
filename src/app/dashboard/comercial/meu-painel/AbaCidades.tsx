'use client'
// Aba Cidades do painel v7 (SPEC §2.4). Só desenha: números de calcularCidadesV7 (cidades-v7.ts).
import { Fragment, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { BaseV5, ModeloV5 } from './motor-v5'
import type { CidadesV7, CidadeV7 } from './cidades-v7'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel'
const CORES = ['#C8941A', '#3D2314', '#6B5D4F', '#9C8E80', '#E0B048', '#2f6f8f', '#3f7d4e', '#7a5c3a', '#D9CBB5']
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const pct = (v: number) => `${nf({ maximumFractionDigits: 1 }).format(v)}%`
const ton = (kg: number) => `${nf({ maximumFractionDigits: 1 }).format(kg / 1000)} t`

type Props = { cidades: CidadesV7; base: BaseV5; modelo: ModeloV5 }

export function AbaCidades({ cidades, base, modelo }: Props) {
  const [ord, setOrd] = useState<{ k: keyof CidadeV7; dir: 1 | -1 }>({ k: 'val', dir: -1 })
  const [aberta, setAberta] = useState<number | null>(null)
  const linhas = cidades.linhas
  const total = modelo.tot.val || 1
  const top = linhas[0]

  const tabela = useMemo(() => [...linhas].sort((a, b) => {
    const va = (a[ord.k] as unknown as number | string | null) ?? -1
    const vb = (b[ord.k] as unknown as number | string | null) ?? -1
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * ord.dir
    return ((va as number) - (vb as number)) * ord.dir
  }), [linhas, ord])

  // Donut: 8 maiores cidades + "Outras".
  const donut = useMemo(() => {
    const top8 = linhas.slice(0, 8).map((l) => ({ nome: l.nome, val: l.val }))
    const outras = linhas.slice(8).reduce((s, l) => s + l.val, 0)
    return outras > 0 ? [...top8, { nome: `Outras (${linhas.length - 8})`, val: outras }] : top8
  }, [linhas])

  const clientesDaCidade = (ci: number) => (cidades.clientesPorCidade.get(ci) ?? [])
    .map((c) => ({ nome: base.cli[c]?.[0] ?? '—', val: modelo.cliM.get(c)?.val ?? 0 }))
    .sort((a, b) => b.val - a.val)

  const seta = (k: keyof CidadeV7) => ord.k === k ? (ord.dir === -1 ? ' ↓' : ' ↑') : ''

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>
        <b>{int(linhas.length)} cidades</b> no período; a maior é <b>{top ? `${top.nome}/${top.uf}` : '—'}</b>. Toque numa cidade para ver os clientes dela.
      </p>

      {/* Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Cidades atendidas<AjudaCampo chave="com.painel.cidades" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{int(linhas.length)}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Concentração na maior cidade<AjudaCampo chave="com.painel.cidades" rota={ROTA} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{top ? pct(top.part) : '—'}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Maior cidade<AjudaCampo chave="com.painel.cidades" rota={ROTA} /></div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{top ? `${top.nome}/${top.uf}` : '—'}</div>
          <div style={{ fontSize: 12, color: C.m }}>{top ? `${int(top.clientes)} clientes · ${brl0(top.val)}` : ''}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Novas cidades<AjudaCampo chave="com.painel.cidades" rota={ROTA} /></div>
          <div style={{ fontSize: 13, color: C.m, marginTop: 4 }}>Sem histórico anterior no sistema: não contamos cidade nova ainda.</div>
        </div>
      </div>

      {/* Donut */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Onde a Frioeste vende<AjudaCampo chave="com.painel.cidades" rota={ROTA} /></div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={donut} dataKey="val" nameKey="nome" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {donut.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => brl0(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 4 }}>
          {donut.map((d, i) => (
            <li key={d.nome} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CORES[i % CORES.length], marginRight: 6 }} />{d.nome}</span>
              <span style={{ color: C.m }}>{pct(100 * d.val / total)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Tabela: TODAS as cidades, ordenável, com drill-down para os clientes */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Todas as cidades ({int(linhas.length)})</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ color: C.m, textAlign: 'left' }}>
                {([['Cidade', 'nome'], ['UF', 'uf'], ['Faturamento', 'val'], ['Part.', 'part'], ['% clientes', 'pctClientes'], ['Volume', 'kg'], ['R$/kg', 'rpkg'], ['Devolução', 'devolucao'], ['Prazo', 'prazo']] as [string, keyof CidadeV7][]).map(([rot, k]) => (
                  <th key={rot} style={{ padding: '6px 4px', textAlign: k === 'nome' || k === 'uf' ? 'left' : 'right' }}>
                    <button type="button" onClick={() => setOrd((o) => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : -1 }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.m, fontWeight: 600, fontSize: 13, padding: 0 }}>{rot}{seta(k)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabela.map((l) => (
                <Fragment key={l.ci}>
                  <tr onClick={() => setAberta(aberta === l.ci ? null : l.ci)} style={{ borderTop: `1px solid ${C.bd}`, cursor: 'pointer', background: aberta === l.ci ? C.bg2 : undefined }}>
                    <td style={{ padding: '6px 4px' }}>{aberta === l.ci ? '▾ ' : '▸ '}{l.nome}</td>
                    <td style={{ padding: '6px 4px' }}>{l.uf}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 70, height: 8, background: C.bg2, borderRadius: 4, overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: 8, width: `${Math.min(100, l.part)}%`, background: C.gold }} />
                        </span>
                        {brl0(l.val)}
                      </div>
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{pct(l.part)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{pct(l.pctClientes)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{ton(l.kg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(l.rpkg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.devolucao)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{l.prazo == null ? '—' : `${nf({ maximumFractionDigits: 1 }).format(l.prazo)} dias`}</td>
                  </tr>
                  {aberta === l.ci && (
                    <tr>
                      <td colSpan={9} style={{ padding: '8px 12px', background: C.bg2 }}>
                        <div style={{ fontSize: 12, color: C.m, marginBottom: 4 }}>Clientes de {l.nome} ({clientesDaCidade(l.ci).length}):</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, columns: 'auto 260px' }}>
                          {clientesDaCidade(l.ci).map((c, i) => <li key={i}>{c.nome} · {brl0(c.val)}</li>)}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
