// Motor genérico da Calculadora de Obra PS (Hub HB2, blueprint Parte O). Regras são DADO (RegraSistema), nunca coeficiente no código.
export type Base = 'area' | 'comprimento'
export type Faixa = { de: number; ate: number; bitola: string; espacamento: number; duplo: boolean }
export type ItemRegra =
  | { chave: string; nome: string; tipo: 'por_area' | 'por_comprimento'; coef: number; perda: boolean; embalagem: number; unidade_compra: string }
  | { chave: string; nome: string; tipo: 'chapa'; faces: number; camadas: number; area_chapa: number; unidade_compra: string }
  | { chave: string; nome: string; tipo: 'guia'; barra: number; unidade_compra: string }
  | { chave: string; nome: string; tipo: 'montante'; barra: number; unidade_compra: string }
export type RegraSistema = { codigo: string; nome: string; perda: number; faixas: Faixa[]; itens: ItemRegra[]; referencia: string }
export type Entrada = { comprimento: number; pe_direito: number; vaos_m2?: number; perda?: number }
export type ItemCalculado = { chave: string; nome: string; quantidade_bruta: number; quantidade_compra: number; unidade_compra: string; conta: string }
export type Resultado = { area_m2: number; faixa: Faixa; itens: ItemCalculado[] }

const r2 = (n: number) => Math.round(n * 100) / 100
// "arredondar a 2 casas e depois para cima, por embalagem" (O.2)
const teto = (n: number) => Math.ceil(r2(n))

export function faixaDoPeDireito(regra: RegraSistema, pd: number): Faixa {
  const p = r2(pd)
  const f = regra.faixas.find((x) => p >= x.de - 1e-9 && p <= x.ate + 1e-9) ??
    // lacuna de 0,05 entre faixas (ex.: 2,50→2,55): usa a faixa seguinte, nunca trava
    regra.faixas.filter((x) => x.de > p).sort((a, b) => a.de - b.de)[0] ?? regra.faixas[regra.faixas.length - 1]
  if (!f) throw new Error(`Sem faixa de pé-direito para ${pd} m em ${regra.codigo}`)
  return f
}

export function calcular(regra: RegraSistema, e: Entrada): Resultado {
  if (!(e.comprimento > 0) || !(e.pe_direito > 0)) throw new Error('Comprimento e pé-direito devem ser maiores que zero')
  const perda = 1 + (e.perda ?? regra.perda)
  const L = e.comprimento
  const A = Math.max(0, r2(L * e.pe_direito - (e.vaos_m2 ?? 0)))
  const faixa = faixaDoPeDireito(regra, e.pe_direito)
  const itens: ItemCalculado[] = regra.itens.map((it) => {
    let bruta = 0
    let conta = ''
    if (it.tipo === 'por_area' || it.tipo === 'por_comprimento') {
      const base = it.tipo === 'por_area' ? A : L
      const p = it.perda ? perda : 1
      bruta = base * it.coef * p
      conta = `${r2(base)} ${it.tipo === 'por_area' ? 'm²' : 'm'} × ${it.coef}${it.perda ? ` × ${r2(p)} (perda)` : ''} ÷ ${it.embalagem} por ${it.unidade_compra}`
      return { chave: it.chave, nome: it.nome, quantidade_bruta: r2(bruta), quantidade_compra: teto(bruta / it.embalagem), unidade_compra: it.unidade_compra, conta }
    }
    if (it.tipo === 'chapa') {
      bruta = A * it.faces * it.camadas * perda
      conta = `${r2(A)} m² × ${it.faces} face(s) × ${it.camadas} chapa(s) × ${r2(perda)} (perda) ÷ ${it.area_chapa} m² por chapa`
      return { chave: it.chave, nome: it.nome, quantidade_bruta: r2(bruta), quantidade_compra: teto(bruta / it.area_chapa), unidade_compra: it.unidade_compra, conta }
    }
    if (it.tipo === 'guia') {
      bruta = L * 2 * perda
      conta = `${r2(L)} m × 2 (piso e teto) × ${r2(perda)} (perda) ÷ ${it.barra} m por barra`
      return { chave: it.chave, nome: `${it.nome} ${faixa.bitola}`, quantidade_bruta: r2(bruta), quantidade_compra: teto(bruta / it.barra), unidade_compra: it.unidade_compra, conta }
    }
    // montante: (L ÷ espaçamento) × perda × PD × [2 se duplo] ÷ barra
    bruta = (L / faixa.espacamento) * perda * e.pe_direito * (faixa.duplo ? 2 : 1)
    conta = `(${r2(L)} m ÷ ${faixa.espacamento} m) × ${r2(perda)} (perda) × ${e.pe_direito} m${faixa.duplo ? ' × 2 (montante duplo)' : ''} ÷ ${it.barra} m por barra`
    return { chave: it.chave, nome: `${it.nome} ${faixa.bitola}${faixa.duplo ? ' duplo' : ''}`, quantidade_bruta: r2(bruta), quantidade_compra: teto(bruta / it.barra), unidade_compra: it.unidade_compra, conta }
  })
  return { area_m2: A, faixa, itens }
}
