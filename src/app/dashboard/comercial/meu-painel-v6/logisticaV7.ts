// Cálculos da aba Logística do painel v7 (SPEC §2.7). Funções puras sobre o motor v5 (fonte bi_comercial_venda_item_mv).
// Carga = número de carga do item (NUM_CARGA). Itens sem carga contam como "sem carga" (notas e kg retirados).
// Peso da carga = soma do kg dos itens da carga (QTDE KG na análise de volume).
import type { BaseV5, ModeloV5 } from '../meu-painel/motor-v5'

export const FAIXAS_PESO: [string, number, number][] = [
  ['Até 1 t', 0, 1000], ['1 a 2 t', 1000, 2000], ['2 a 3 t', 2000, 3000], ['3 a 5 t', 3000, 5000], ['5 a 10 t', 5000, 10000], ['Acima de 10 t', 10000, Infinity],
]
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export type LogisticaV7 = {
  cargas: number; kgMedCarga: number; cliMedCarga: number
  notasSem: number; kgSem: number
  pesoFaixas: { faixa: string; cargas: number }[]
  diaSemana: { rot: string; cargas: number }[]
  transportadoras: { nome: string; cargas: number; part: number; kg: number; notas: number; clientes: number }[]
  totalKg: number
}

const diaSemana = (base: BaseV5, dia: number) => new Date(Date.parse(base.de + 'T00:00:00Z') + dia * 86400000).getUTCDay()

export function calcularLogisticaV7(base: BaseV5, modelo: ModeloV5): LogisticaV7 {
  const cargaKg = new Map<number, number>()
  const cargaCli = new Map<number, Set<number>>()
  const cargaDias = new Map<number, Set<number>>()
  const cargaTr = new Map<number, number>()
  const semCargaNotas = new Set<number>(); let kgSem = 0
  const trKg = new Map<number, { kg: number; cargas: Set<number>; notas: Set<number>; clis: Set<number> }>()
  let totalKg = 0
  modelo.its.forEach((x) => {
    totalKg += x[5]
    if (x[8] < 0) { semCargaNotas.add(x[1]); kgSem += x[5]; return }
    const c = x[8]
    cargaKg.set(c, (cargaKg.get(c) || 0) + x[5])
    let cl = cargaCli.get(c); if (!cl) { cl = new Set(); cargaCli.set(c, cl) }; cl.add(x[3])
    let dd = cargaDias.get(c); if (!dd) { dd = new Set(); cargaDias.set(c, dd) }; dd.add(x[0])
    cargaTr.set(c, x[9])
    let t = trKg.get(x[9]); if (!t) { t = { kg: 0, cargas: new Set(), notas: new Set(), clis: new Set() }; trKg.set(x[9], t) }
    t.kg += x[5]; t.cargas.add(c); t.notas.add(x[1]); t.clis.add(x[3])
  })
  const cargas = [...cargaKg.keys()]
  const kgCargas = [...cargaKg.values()].reduce((s, v) => s + v, 0)
  const cliMed = cargas.length ? [...cargaCli.values()].reduce((s, v) => s + v.size, 0) / cargas.length : 0

  const pesoFaixas = FAIXAS_PESO.map(([faixa, min, max]) => ({
    faixa, cargas: cargas.filter((c) => { const k = cargaKg.get(c) || 0; return k >= min && k < max }).length,
  }))

  // Cargas por dia da semana: cada carga conta uma vez em cada dia da semana em que teve item.
  const porDia = new Array(7).fill(0)
  cargaDias.forEach((dias) => {
    const semanas = new Set<number>()
    dias.forEach((d) => semanas.add(diaSemana(base, d)))
    semanas.forEach((w) => { porDia[w]++ })
  })
  const diaSemanaRows = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ rot: DIAS_SEMANA[w], cargas: porDia[w] }))

  const transportadoras = [...trKg].map(([ti, t]) => ({
    nome: base.tr[ti] ?? '—', cargas: t.cargas.size, part: totalKg ? 100 * t.kg / totalKg : 0,
    kg: t.kg, notas: t.notas.size, clientes: t.clis.size,
  })).sort((a, b) => b.kg - a.kg)

  return {
    cargas: cargas.length,
    kgMedCarga: cargas.length ? kgCargas / cargas.length : 0,
    cliMedCarga: cliMed,
    notasSem: semCargaNotas.size, kgSem,
    pesoFaixas, diaSemana: diaSemanaRows, transportadoras, totalKg,
  }
}
