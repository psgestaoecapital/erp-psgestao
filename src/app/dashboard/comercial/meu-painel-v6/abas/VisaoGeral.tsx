'use client'
// Painel Comercial v6 — aba "Visão geral": como a empresa está vendendo no período.
// Blocos: resumo, faturamento por dia, as linhas de produto, ritmo da semana. Só desenha; o cálculo vem do motor-v5.
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BaseV5, ModeloV5, ResumoV5 } from '../../meu-painel/motor-v5'
import { Cartao, Bloco } from './ui'
import { C, brl0, brl2, int, pct, ton, diaISO, dataBR, diaDaSemana } from './fmt'

// ordem de exibição: segunda a domingo (dia de trabalho primeiro)
const SEMANA: { dow: number; curto: string; nome: string }[] = [
  { dow: 1, curto: 'Seg', nome: 'segunda-feira' }, { dow: 2, curto: 'Ter', nome: 'terça-feira' },
  { dow: 3, curto: 'Qua', nome: 'quarta-feira' }, { dow: 4, curto: 'Qui', nome: 'quinta-feira' },
  { dow: 5, curto: 'Sex', nome: 'sexta-feira' }, { dow: 6, curto: 'Sáb', nome: 'sábado' },
  { dow: 0, curto: 'Dom', nome: 'domingo' },
]

export function VisaoGeral({ base, modelo, r }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  const serie = useMemo(() => {
    return [...modelo.diaM]
      .map(([d, a]) => { const iso_ = diaISO(base.de, d); return { dia: iso_, rot: dataBR(iso_).slice(0, 5), val: a.val } })
      .sort((a, b) => a.dia.localeCompare(b.dia))
  }, [modelo, base])

  const linhas = useMemo(() => {
    const tot = modelo.tot.val || 1
    return [...modelo.linM.entries()]
      .map(([nome, a]) => ({ nome, val: a.val, kg: a.kg, part: a.val / tot, rkg: a.kgP > 0 ? a.valP / a.kgP : null }))
      .sort((a, b) => b.val - a.val)
  }, [modelo])

  const ritmo = useMemo(() => {
    const porDow = new Map<number, { val: number; dias: Set<string> }>()
    for (const [d, a] of modelo.diaM) {
      const isoDia = diaISO(base.de, d)
      const dow = diaDaSemana(isoDia)
      let acc = porDow.get(dow)
      if (!acc) { acc = { val: 0, dias: new Set() }; porDow.set(dow, acc) }
      acc.val += a.val; acc.dias.add(isoDia)
    }
    return SEMANA.map((s) => ({ curto: s.curto, nome: s.nome, val: porDow.get(s.dow)?.val ?? 0, ocorr: porDow.get(s.dow)?.dias.size ?? 0 }))
      .filter((x) => x.ocorr > 0)
  }, [modelo, base])

  const picoSemana = useMemo(() => ritmo.length ? ritmo.reduce((a, b) => (b.val > a.val ? b : a)) : null, [ritmo])

  const notas = modelo.tot.notas.size
  const ticketNota = notas ? modelo.tot.val / notas : null

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período de {dataBR(base.de)} a {dataBR(base.ate)}. Ajuste o período ou confira se a importação do dia já rodou.
      </div>
    )
  }

  return (
    <>
      <p style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 16px' }}>
        Faturou <b>{brl0(r.totalValor)}</b> em <b>{ton(modelo.tot.kg)}</b>, para <b>{int(r.clientes)} clientes</b>. Sem o despojo, o quilo sai a <b>{brl2(r.precoPorKg)}</b>.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Cartao rot="Faturamento" chave="comv6.faturado" valor={brl0(r.totalValor)} />
        <Cartao rot="Volume na análise" chave="comv6.volume" valor={ton(modelo.tot.kgP)} />
        <Cartao rot="Preço médio" chave="comv6.preco" valor={brl2(r.precoPorKg)} sub="R$/kg sem despojo" />
        <Cartao rot="Ticket por nota" chave="comv6.ticket" valor={brl0(ticketNota)} sub={`${int(notas)} notas`} />
      </div>

      <Bloco titulo="Faturamento por dia" chave="comv6.fat_dia">
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bd} />
              <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
              <Tooltip formatter={(v) => brl0(Number(v))} labelFormatter={(_, p) => dataBR(String(p?.[0]?.payload?.dia ?? ''))} />
              <Bar dataKey="val" fill={C.gold} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Bloco>

      <Bloco titulo="As linhas de produto" chave="comv6.linhas">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          De onde vem o faturamento. A linha <b>{linhas[0].nome.toLowerCase()}</b> responde por <b>{pct(linhas[0].part)}</b> do total.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {linhas.map((l) => (
            <div key={l.nome}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nome}</span>
                <span style={{ color: C.m, flexShrink: 0 }}>{brl0(l.val)} · {pct(l.part)}</span>
              </div>
              <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, Math.round(l.part * 100))}%`, background: C.gold }} />
              </div>
              <div style={{ fontSize: 11, color: C.d, marginTop: 2 }}>{ton(l.kg)}{l.rkg != null ? <> · {brl2(l.rkg)}/kg</> : <> · despojo/subproduto (fora do preço)</>}</div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Ritmo da semana" chave="comv6.ritmo">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          {picoSemana ? <>O dia mais forte é <b>{picoSemana.nome}</b>, com <b>{brl0(picoSemana.val)}</b> no período.</> : 'Sem venda no período.'}
        </p>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ritmo} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bd} />
              <XAxis dataKey="curto" tick={{ fontSize: 12, fill: C.m }} />
              <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
              <Tooltip formatter={(v) => brl0(Number(v))} labelFormatter={(_, p) => { const d = p?.[0]?.payload; return d ? `${d.nome} · ${d.ocorr}× no período` : '' }} />
              <Bar dataKey="val" fill={C.esp} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Bloco>
    </>
  )
}
