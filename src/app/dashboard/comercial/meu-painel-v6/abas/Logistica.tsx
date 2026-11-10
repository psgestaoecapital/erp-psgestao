'use client'
// Painel Comercial v6 — aba "Logística": peso das cargas, cargas por dia da semana e transportadoras.
// Do motor-v5 (cargaM por carga = peso e dias; trM por transportador). Só desenha.
import { useMemo } from 'react'
import type { BaseV5, ModeloV5, ResumoV5 } from '../../meu-painel/motor-v5'
import { Bloco } from './ui'
import { C, brl0, int, pct, ton, diaISO, diaDaSemana } from './fmt'

const SEMANA: { dow: number; curto: string; nome: string }[] = [
  { dow: 1, curto: 'Seg', nome: 'segunda-feira' }, { dow: 2, curto: 'Ter', nome: 'terça-feira' },
  { dow: 3, curto: 'Qua', nome: 'quarta-feira' }, { dow: 4, curto: 'Qui', nome: 'quinta-feira' },
  { dow: 5, curto: 'Sex', nome: 'sexta-feira' }, { dow: 6, curto: 'Sáb', nome: 'sábado' },
  { dow: 0, curto: 'Dom', nome: 'domingo' },
]

export function Logistica({ base, modelo }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  // Peso das cargas: distribuição do peso (kg) por carga.
  const faixasPeso = useMemo(() => {
    const faixas = [
      { nome: 'até 1 t', lim: 1000, n: 0 },
      { nome: '1–3 t', lim: 3000, n: 0 },
      { nome: '3–6 t', lim: 6000, n: 0 },
      { nome: '6–12 t', lim: 12000, n: 0 },
      { nome: 'acima de 12 t', lim: Infinity, n: 0 },
    ]
    let totalCargas = 0, somaKg = 0
    for (const a of modelo.cargaM.values()) { totalCargas++; somaKg += a.kg; const f = faixas.find((x) => a.kg <= x.lim); if (f) f.n++ }
    const tc = totalCargas || 1
    return { faixas: faixas.map((f) => ({ nome: f.nome, n: f.n, part: f.n / tc })), totalCargas, pesoMedio: totalCargas ? somaKg / totalCargas : 0 }
  }, [modelo])

  // Cargas por dia da semana: conta cada carga no seu primeiro dia.
  const porDow = useMemo(() => {
    const m = new Map<number, number>()
    for (const a of modelo.cargaM.values()) {
      let min = Infinity
      a.dias.forEach((d) => { if (d < min) min = d })
      if (min === Infinity) continue
      const dow = diaDaSemana(diaISO(base.de, min))
      m.set(dow, (m.get(dow) ?? 0) + 1)
    }
    return SEMANA.map((s) => ({ curto: s.curto, nome: s.nome, n: m.get(s.dow) ?? 0 })).filter((x) => x.n > 0)
  }, [modelo, base])

  // Transportadoras: ranking por faturamento transportado e peso.
  const transp = useMemo(() => {
    const totKg = [...modelo.trM.values()].reduce((s, a) => s + a.kg, 0) || 1
    return [...modelo.trM.entries()]
      .map(([idx, a]) => ({ nome: base.tr[idx] ?? `Transp. ${idx}`, val: a.val, kg: a.kg, part: a.kg / totKg }))
      .sort((a, b) => b.kg - a.kg)
  }, [modelo, base])

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período. Nada a mostrar na logística.
      </div>
    )
  }
  if (!faixasPeso.totalCargas && !transp.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, color: C.m }}>
        As vendas do período não trazem informação de carga/transporte. Quando as notas tiverem carga e transportador, os números de logística aparecem aqui.
      </div>
    )
  }
  const maxDow = Math.max(...porDow.map((d) => d.n), 1)

  return (
    <>
      <Bloco titulo="Peso das cargas" chave="comv6.log_peso">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Foram <b>{int(faixasPeso.totalCargas)} cargas</b> no período, com peso médio de <b>{ton(faixasPeso.pesoMedio)}</b>. A distribuição por faixa de peso:
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {faixasPeso.faixas.map((f) => (
            <div key={f.nome}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{f.nome}</span>
                <span style={{ color: C.m }}>{int(f.n)} cargas · {pct(f.part)}</span>
              </div>
              <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, Math.round(f.part * 100))}%`, background: C.gold }} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Cargas por dia da semana" chave="comv6.log_dia_semana">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          Em que dias saem mais cargas — ajuda a dimensionar a frota e a equipe de expedição.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {porDow.map((d) => (
            <div key={d.curto}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{d.nome}</span>
                <span style={{ color: C.m }}>{int(d.n)} cargas</span>
              </div>
              <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, Math.round((d.n / maxDow) * 100))}%`, background: C.esp }} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Transportadoras" chave="comv6.log_transportadoras">
        {transp.length ? (
          <>
            <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
              <b>{int(transp.length)}</b> transportadoras no período. <b>{transp[0]?.nome}</b> leva <b>{pct(transp[0]?.part)}</b> do peso.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {transp.map((t) => (
                <div key={t.nome}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.nome}</span>
                    <span style={{ color: C.m, flexShrink: 0 }}>{ton(t.kg)} · {pct(t.part)}</span>
                  </div>
                  <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(2, Math.round(t.part * 100))}%`, background: C.gold }} />
                  </div>
                  <div style={{ fontSize: 11, color: C.d, marginTop: 2 }}>{brl0(t.val)} transportados</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 14, color: C.m, margin: 0 }}>Sem transportador informado nas notas do período.</p>
        )}
      </Bloco>
    </>
  )
}
