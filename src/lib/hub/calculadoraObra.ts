// HB2 — Calculadora de Obra PS (Parte O do blueprint do Hub). Motor genérico: o sistema construtivo é DADO (regra com
// itens, coeficientes, perdas, embalagens e faixas de pé-direito), nunca coeficiente no código. Os valores de referência
// (drywall) ficam em calculadoraObraReferencia.ts e são "referência de mercado a validar" — cada empresa ajusta os seus.
export type BaseCalculo = 'area' | 'comprimento' | 'perimetro' | 'montante_m'

export interface FaixaPeDireito { de: number; ate: number; bitola: string; espacamento_mm: number; duplo: boolean }

export interface ItemRegra {
  codigo: string
  nome: string
  unidade_compra: string
  /** quanto da base (m, m², un, kg) cabe numa unidade de compra: barra 3 m, chapa 2,16 m², cento 100, balde 22 kg */
  por_embalagem: number
  base: BaseCalculo
  /** coeficiente por unidade da base */
  coef: number
  /** quando o coeficiente muda com o espaçamento/duplo: chave "600", "400", "600d", "400d" */
  coef_por_espacamento?: Record<string, number>
  perda: boolean
  /** parâmetro que substitui por_embalagem (ex.: tamanho da chapa escolhido) */
  por_embalagem_param?: string
}

export interface SistemaRegra {
  codigo: string
  nome: string
  tipo: 'parede' | 'forro' | 'revestimento'
  referencia: string
  parametros: Record<string, number>
  faixas_pe_direito: FaixaPeDireito[]
  itens: ItemRegra[]
}

export interface EntradaCalculo {
  comprimento: number
  /** pé-direito (parede) ou largura (forro) */
  altura: number
  /** área dos vãos a descontar (portas, janelas) */
  vaos_m2?: number
  /** perímetro real do forro; sem ele, usa 2 × (comprimento + largura) */
  perimetro?: number
  /** substitui parâmetros avançados (perda, chapa_m2, espaçamento…) */
  parametros?: Record<string, number>
}

export interface LinhaCalculo {
  codigo: string
  nome: string
  unidade_compra: string
  quantidade_base: number
  quantidade_compra: number
  conta: string
}

export interface ResultadoCalculo {
  ok: boolean
  erro?: string
  area_liquida: number
  faixa?: FaixaPeDireito
  linhas: LinhaCalculo[]
}

const r2 = (v: number) => Math.round(v * 100 + 1e-9) / 100
const paraCima = (v: number) => Math.ceil(r2(v))
const fmt = (v: number) => String(r2(v)).replace('.', ',')
export const normalizaPeDireito = (pd: number) => Math.ceil(pd * 20 - 1e-9) / 20

export function faixaDoPeDireito(faixas: FaixaPeDireito[], pd: number): FaixaPeDireito | null {
  if (!faixas.length) return null
  const p = normalizaPeDireito(pd)
  return faixas.find(f => p >= f.de - 1e-9 && p <= f.ate + 1e-9) ?? null
}

export function calcular(regra: SistemaRegra, e: EntradaCalculo): ResultadoCalculo {
  const vazio = (erro: string): ResultadoCalculo => ({ ok: false, erro, area_liquida: 0, linhas: [] })
  if (!(e.comprimento > 0) || !(e.altura > 0)) return vazio('Informe comprimento e altura maiores que zero.')
  const par = { ...regra.parametros, ...(e.parametros ?? {}) }
  const area = r2(Math.max(e.comprimento * e.altura - (e.vaos_m2 ?? 0), 0))
  if (area <= 0) return vazio('Os vãos descontados deixam a área em zero.')

  let faixa: FaixaPeDireito | undefined
  if (regra.faixas_pe_direito.length) {
    faixa = faixaDoPeDireito(regra.faixas_pe_direito, e.altura) ?? undefined
    if (!faixa) return vazio(`Pé-direito ${fmt(e.altura)} m fora das faixas cadastradas para ${regra.nome}.`)
  }
  const esp = (par.espacamento_mm ?? faixa?.espacamento_mm ?? 600)
  const chaveEsp = `${esp}${faixa?.duplo ? 'd' : ''}`
  const perda = par.perda ?? 1.05
  const perimetro = e.perimetro ?? 2 * (e.comprimento + e.altura)
  const montanteM = faixa
    ? (e.comprimento / (esp / 1000)) * perda * e.altura * (faixa.duplo ? 2 : 1)
    : 0
  const base: Record<BaseCalculo, number> = { area, comprimento: e.comprimento, perimetro, montante_m: montanteM }

  const linhas = regra.itens.map<LinhaCalculo>(it => {
    const coef = it.coef_por_espacamento?.[chaveEsp] ?? it.coef
    const porEmb = (it.por_embalagem_param ? par[it.por_embalagem_param] : undefined) ?? it.por_embalagem
    const usaPerda = it.perda && it.base !== 'montante_m'
    const qtdBase = r2(base[it.base] * coef * (usaPerda ? perda : 1))
    const compra = paraCima(qtdBase / porEmb)
    const conta = `${fmt(base[it.base])} (${it.base.replace('_', ' ')}) × ${fmt(coef)}${usaPerda ? ` × perda ${fmt(perda)}` : ''} = ${fmt(qtdBase)}; ÷ ${fmt(porEmb)} por ${it.unidade_compra}, arredondado para cima = ${compra}`
    return { codigo: it.codigo, nome: it.nome, unidade_compra: it.unidade_compra, quantidade_base: qtdBase, quantidade_compra: compra, conta }
  })
  return { ok: true, area_liquida: area, faixa, linhas }
}
