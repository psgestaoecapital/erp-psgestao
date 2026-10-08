// Motor genérico da Calculadora de Obra PS (HB2 · Parte O do blueprint do Hub).
// Nenhum coeficiente vive aqui: tudo vem de um SistemaCalculo (dado, editável por empresa).
// Os valores de referência (referencia.ts) são "referência de mercado a validar" com o fabricante.

export type Variante = '600' | '400' | 'd600' | 'd400' | 'unica'

export interface FaixaPeDireito { de: number; ate: number; bitola: string; espacamento: 600 | 400; duplo: boolean }

/** Uma linha da regra: quantidade = (Σ termos) × perda ÷ divisor, arredondada para cima por embalagem. */
export interface RegraItem {
  chave: string
  nome: string
  unidade_compra: string
  /** quanto cabe numa embalagem/unidade de compra (ex.: barra 3 m, balde 22 kg, cento 100 un). */
  divisor: number
  aplica_perda: boolean
  /** só entra quando a opção estiver ligada (ex.: lã, banda acústica). */
  opcional?: string
  por_area?: number | Partial<Record<Variante, number>>
  por_comprimento?: number
  por_perimetro?: number
  /** metros de montante: (comprimento ÷ espaçamento) × pé-direito × (2 se duplo). */
  por_montante?: boolean
  /** a chapa usa o tamanho de chapa escolhido como divisor. */
  usa_chapa?: boolean
  /** multiplicador da área (ex.: 2 faces). */
  faces?: number
  usa_bitola?: boolean
  explicacao: string
}

export interface SistemaCalculo {
  chave: string
  nome: string
  modo: 'parede' | 'forro'
  perda: number
  faixas_pe_direito?: FaixaPeDireito[]
  itens: RegraItem[]
}

export interface Entrada {
  comprimento: number
  /** pé-direito (parede) ou largura (forro). */
  altura: number
  vaos?: { largura: number; altura: number; qtd?: number }[]
  opcoes?: string[]
  /** m² da chapa (padrão 1,20 × 1,80 = 2,16). */
  chapa_m2?: number
  perda?: number
  /** força espaçamento (mm); senão vem da faixa do pé-direito. */
  espacamento?: 600 | 400
}

export interface ItemCalculado {
  chave: string
  nome: string
  bitola?: string
  unidade_compra: string
  quantidade: number
  /** quantidade em unidade-base antes de embalar (m², m, kg, un). */
  quantidade_base: number
  conta: string
}

export interface Resultado {
  ok: boolean
  erro?: string
  area: number
  perimetro: number
  faixa?: FaixaPeDireito
  itens: ItemCalculado[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
/** arredonda a 2 casas e depois para cima (regra de embalagem). */
export const embalar = (n: number) => Math.ceil(r2(n) - 1e-9)

export function faixaDoPeDireito(faixas: FaixaPeDireito[], pd: number): FaixaPeDireito | undefined {
  const x = r2(pd)
  const ordenadas = [...faixas].sort((a, b) => a.de - b.de)
  const f = ordenadas.find(f => x >= f.de - 1e-9 && x <= f.ate + 1e-9)
  if (f) return f
  // entre duas faixas (ex.: 2,52): vale a faixa seguinte (mais robusta) — nunca trava.
  return ordenadas.find(f => f.de > x)
}

export function calcular(sis: SistemaCalculo, e: Entrada): Resultado {
  const vazio: Resultado = { ok: false, area: 0, perimetro: 0, itens: [] }
  if (!(e.comprimento > 0) || !(e.altura > 0)) return { ...vazio, erro: 'Informe comprimento e altura maiores que zero.' }
  const vaos = (e.vaos ?? []).reduce((s, v) => s + v.largura * v.altura * (v.qtd ?? 1), 0)
  const bruta = e.comprimento * e.altura
  const area = r2(bruta - vaos)
  if (area <= 0) return { ...vazio, erro: 'Os vãos descontados são maiores que a área.' }
  const perimetro = r2(2 * (e.comprimento + e.altura))
  const perda = 1 + (e.perda ?? sis.perda)
  const chapa = e.chapa_m2 ?? 2.16

  let faixa: FaixaPeDireito | undefined
  if (sis.faixas_pe_direito?.length) {
    faixa = faixaDoPeDireito(sis.faixas_pe_direito, e.altura)
    if (!faixa) return { ...vazio, area, erro: `Pé-direito de ${e.altura} m acima da tabela do sistema ${sis.nome}; cadastre a faixa.` }
    if (e.espacamento) faixa = { ...faixa, espacamento: e.espacamento }
  }
  const variante: Variante = faixa ? ((faixa.duplo ? 'd' : '') + faixa.espacamento) as Variante : 'unica'
  const opcoes = new Set(e.opcoes ?? [])

  const itens: ItemCalculado[] = []
  for (const r of sis.itens) {
    if (r.opcional && !opcoes.has(r.opcional)) continue
    const termos: string[] = []
    let base = 0
    if (r.por_area !== undefined) {
      const c = typeof r.por_area === 'number' ? r.por_area : (r.por_area[variante] ?? r.por_area.unica ?? 0)
      const f = r.faces ?? 1
      base += area * c * f; termos.push(`${area} m² × ${c}${f !== 1 ? ` × ${f}` : ''}`)
    }
    if (r.por_comprimento !== undefined) { const f = r.faces ?? 1; base += e.comprimento * r.por_comprimento * f; termos.push(`${e.comprimento} m × ${r.por_comprimento}${f !== 1 ? ` × ${f}` : ''}`) }
    if (r.por_perimetro !== undefined) { base += perimetro * r.por_perimetro; termos.push(`perímetro ${perimetro} m × ${r.por_perimetro}`) }
    if (r.por_montante && faixa) {
      const m = (e.comprimento / (faixa.espacamento / 1000)) * e.altura * (faixa.duplo ? 2 : 1)
      base += m; termos.push(`(${e.comprimento} m ÷ ${faixa.espacamento / 1000} m) × ${e.altura} m${faixa.duplo ? ' × 2' : ''}`)
    }
    const div = r.usa_chapa ? chapa : r.divisor
    const comPerda = r.aplica_perda ? base * perda : base
    const quantidade = embalar(comPerda / div)
    itens.push({
      chave: r.chave, nome: r.nome, bitola: r.usa_bitola ? faixa?.bitola : undefined,
      unidade_compra: r.unidade_compra, quantidade, quantidade_base: r2(comPerda),
      conta: `${termos.join(' + ')}${r.aplica_perda ? ` × perda ${perda.toFixed(2)}` : ''} ÷ ${div} ${r.unidade_compra} = ${r2(comPerda / div)} → ${quantidade}. ${r.explicacao}`,
    })
  }
  return { ok: true, area, perimetro, faixa, itens }
}
