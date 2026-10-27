// Calculadora de Obra — tabela de REFERÊNCIA das fórmulas (RD-38: prova no dado, não na palavra).
// Cada caso é um exemplo trabalhado, conferido à mão a partir das regras de referência de mercado
// (NBR 15758/14715) e do caso real da Tryo (parede 12,5 × 2,8 m com porta 0,8 × 2,1 m). A tela e o
// gate `check-calculadora-referencia.ts` rodam o MOTOR sobre estes casos e comparam: se o resultado
// bate item a item, a fórmula daquele sistema aparece como "validada"; se divergir, aparece
// "a conferir" — nunca um "validada" que o cálculo não sustenta.
//
// Não é custo nem preço (isso vem do estoque, no custearItens): é a QUANTIDADE de material que a conta
// precisa devolver. Por isso é determinístico e não depende de empresa nem de banco.
import {
  REGRAS_FORRO_ARAMADO, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, REGRAS_PAREDE_SEPARATIVA,
  REGRAS_PAREDE_CORTA_FOGO, REGRAS_REVESTIMENTO_COLADO, REGRAS_REVESTIMENTO_ESTRUTURADO,
  calcularForroAramado, calcularForroF530, calcularParede, calcularRevestimentoColado,
  calcularRevestimentoEstruturado, type Resultado,
} from './motor'
import type { SistemaCalc } from './regras-empresa'

export type CasoReferencia = {
  titulo: string
  // descrição curta da medida do caso, para mostrar na tela
  medida: string
  // área esperada (m²) e quantidades esperadas por chave de item
  area: number
  esperado: Record<string, number>
  // roda o motor (com as regras de referência) e devolve o resultado deste caso
  calcular: () => Resultado
}

// Cada sistema tem ao menos um caso conferido. Os números são os mesmos exigidos pelo gate histórico
// `check-calculadora-obra.ts` (caso Tryo e os forros/revestimentos), agora como dado reaproveitável.
export const REFERENCIA: Record<SistemaCalc, CasoReferencia[]> = {
  parede: [{
    titulo: 'Parede simples (drywall) — caso Tryo',
    medida: '12,5 × 2,8 m, descontando porta 0,8 × 2,1 m',
    area: 33.32,
    esperado: { chapa: 33, guia: 9, montante: 21 },
    calcular: () => calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 0.8 * 2.1 }),
  }],
  parede_separativa: [{
    titulo: 'Parede separativa — pé-direito 2,8 m',
    medida: '12,5 × 2,8 m, vãos 1,68 m²',
    area: 33.32,
    // faixa própria: M48 @600 (chapa igual à simples; montante ⌈(12,5÷0,6)×1,05×2,8÷3⌉ pela faixa da separativa)
    esperado: { chapa: 33, montante: 21 },
    calcular: () => calcularParede(REGRAS_PAREDE_SEPARATIVA, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 }),
  }],
  parede_corta_fogo: [{
    titulo: 'Parede corta-fogo — 2 camadas por face',
    medida: '12,5 × 2,8 m, vãos 1,68 m²',
    area: 33.32,
    esperado: { chapa: 65 },
    calcular: () => calcularParede(REGRAS_PAREDE_CORTA_FOGO, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 }),
  }],
  forro_f530: [{
    titulo: 'Forro de gesso F530',
    medida: '3 × 4 m (12 m²)',
    area: 12,
    esperado: { chapa: 6, tabica: 5 },
    calcular: () => calcularForroF530(REGRAS_FORRO_F530, { largura: 3, comprimento: 4 }),
  }],
  forro_aramado: [{
    titulo: 'Forro aramado',
    medida: '3 × 4 m (12 m²)',
    area: 12,
    // chapa 0,60 × 2,00 = 1,20 m²; nervura arredonda para CIMA; gesso cola em sacos de 5 kg
    esperado: { chapa: 11, nervura: 1, gesso_cola: 3 },
    calcular: () => calcularForroAramado(REGRAS_FORRO_ARAMADO, { largura: 3, comprimento: 4 }),
  }],
  revestimento_colado: [{
    titulo: 'Revestimento colado',
    medida: '12,5 × 2,8 m, vãos 1,68 m²',
    area: 33.32,
    esperado: { chapa: 17, gesso_cola: 84 },
    calcular: () => calcularRevestimentoColado(REGRAS_REVESTIMENTO_COLADO, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 }),
  }],
  revestimento_estruturado: [{
    titulo: 'Revestimento estruturado — 1 e 2 chapas',
    medida: '12,5 × 2,8 m, vãos 1,68 m² (1 chapa)',
    area: 33.32,
    esperado: { chapa: 17 },
    calcular: () => calcularRevestimentoEstruturado(REGRAS_REVESTIMENTO_ESTRUTURADO, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68, camadas: 1 }),
  }],
}

export type ItemConferido = { chave: string; esperado: number; obtido: number | null; bate: boolean }
export type ConferenciaArea = { esperado: number; obtido: number | null; bate: boolean }
export type CasoConferido = { titulo: string; medida: string; itens: ItemConferido[]; area: ConferenciaArea; bate: boolean }
export type ConferenciaSistema = {
  sistema: SistemaCalc
  validada: boolean
  // área conferida do primeiro caso (resumo curto para a tela)
  area: ConferenciaArea
  casos: CasoConferido[]
}

// Confere TODOS os casos de um sistema contra o motor. `validada` = todos os casos batem (área + itens).
export function conferirSistema(sistema: SistemaCalc): ConferenciaSistema {
  const casos = REFERENCIA[sistema].map((c) => {
    const r = c.calcular()
    const quantidade = (chave: string): number | null => (r.ok ? (r.itens.find((i) => i.chave === chave)?.quantidade ?? null) : null)
    const itens: ItemConferido[] = Object.entries(c.esperado).map(([chave, esperado]) => {
      const obtido = quantidade(chave)
      return { chave, esperado, obtido, bate: obtido === esperado }
    })
    const areaObtida = r.ok ? r.area : null
    const bate = r.ok && areaObtida === c.area && itens.every((i) => i.bate)
    return { titulo: c.titulo, medida: c.medida, itens, bate, area: { esperado: c.area, obtido: areaObtida, bate: r.ok && areaObtida === c.area } }
  })
  // a conferência de área do primeiro caso representa o sistema na tela (resumo curto)
  const area = casos[0]?.area ?? { esperado: 0, obtido: null, bate: false }
  return { sistema, validada: casos.length > 0 && casos.every((c) => c.bate), area, casos }
}

// Conferência de todos os sistemas (usada pelo gate).
export function conferirTudo(): ConferenciaSistema[] {
  return (Object.keys(REFERENCIA) as SistemaCalc[]).map(conferirSistema)
}
