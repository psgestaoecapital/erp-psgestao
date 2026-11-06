// Calculadora de Obra — validação das fórmulas contra uma REFERÊNCIA travada (NBR 15758/14715, a validar com o
// fabricante de cada empresa). Cada caso canônico fixa a entrada e as quantidades esperadas (compra, arredondadas para
// cima por embalagem) que o motor deve devolver com as regras de referência. O gate scripts/gates/check-calc-formulas.ts
// roda estes casos no build: se uma fórmula mudar e divergir da referência, o build quebra. A tela usa RESUMO_VALIDACAO
// para dizer "fórmula validada contra a referência" quando a empresa não editou as regras.
import {
  calcularParede, calcularForroF530, calcularForroAramado, calcularRevestimentoColado, calcularRevestimentoEstruturado,
  REGRAS_PAREDE_SIMPLES_ST, REGRAS_PAREDE_SEPARATIVA, REGRAS_PAREDE_CORTA_FOGO, REGRAS_FORRO_F530, REGRAS_FORRO_ARAMADO,
  REGRAS_REVESTIMENTO_COLADO, REGRAS_REVESTIMENTO_ESTRUTURADO, type Resultado,
} from './motor'

export type CasoValidacao = {
  chave: string
  rotulo: string
  entrada: string      // descrição legível da entrada
  area: number
  itens: Record<string, number>   // chave do item → quantidade de compra esperada
  rodar: () => Resultado
}

// Valores travados a partir da referência (motor com as REGRAS_* padrão). Área de parede 5,0 × 2,7 = 13,5 m², etc.
export const CASOS_VALIDACAO: CasoValidacao[] = [
  { chave: 'parede', rotulo: 'Parede simples ST', entrada: '5,0 m × pé-direito 2,7 m', area: 13.5,
    itens: { chapa: 14, guia: 4, montante: 12, banda: 2, parafuso: 4, massa: 1, fita: 1 },
    rodar: () => calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 5, peDireito: 2.7 }) },
  { chave: 'parede_la', rotulo: 'Parede simples com lã', entrada: '5,0 m × pé-direito 2,7 m, com lã', area: 13.5,
    itens: { chapa: 14, guia: 4, montante: 12, banda: 2, la: 2, parafuso: 4, massa: 1, fita: 1 },
    rodar: () => calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 5, peDireito: 2.7, comLa: true }) },
  { chave: 'parede_separativa', rotulo: 'Parede separativa', entrada: '5,0 m × pé-direito 3,0 m', area: 15,
    itens: { chapa: 15, guia: 4, montante: 14, banda: 2, parafuso: 4, massa: 1, fita: 1 },
    rodar: () => calcularParede(REGRAS_PAREDE_SEPARATIVA, { comprimento: 5, peDireito: 3.0 }) },
  { chave: 'parede_corta_fogo', rotulo: 'Parede corta-fogo (2 chapas/face)', entrada: '5,0 m × pé-direito 3,0 m', area: 15,
    itens: { chapa: 30, guia: 4, montante: 9, banda: 2, parafuso: 4, massa: 1, fita: 1 },
    rodar: () => calcularParede(REGRAS_PAREDE_CORTA_FOGO, { comprimento: 5, peDireito: 3.0 }) },
  { chave: 'forro_f530', rotulo: 'Forro F530', entrada: '4,0 × 5,0 m', area: 20,
    itens: { chapa: 10, perfil_f530: 12, tabica: 7, pendural: 25, tirante: 25, uniao: 9, ppa25: 3, pfm13: 1, massa: 1, fita: 1 },
    rodar: () => calcularForroF530(REGRAS_FORRO_F530, { largura: 4, comprimento: 5 }) },
  { chave: 'forro_aramado', rotulo: 'Forro aramado', entrada: '4,0 × 5,0 m', area: 20,
    itens: { chapa: 18, nervura: 2, juncao_h: 90, arame: 3, gesso_cola: 5, massa: 1, fita: 1 },
    rodar: () => calcularForroAramado(REGRAS_FORRO_ARAMADO, { largura: 4, comprimento: 5 }) },
  { chave: 'revestimento_colado', rotulo: 'Revestimento colado', entrada: '5,0 m × altura 2,7 m', area: 13.5,
    itens: { chapa: 7, gesso_cola: 34, massa: 1, fita: 1 },
    rodar: () => calcularRevestimentoColado(REGRAS_REVESTIMENTO_COLADO, { comprimento: 5, peDireito: 2.7 }) },
  { chave: 'revestimento_estruturado', rotulo: 'Revestimento estruturado (1 chapa)', entrada: '5,0 m × altura 2,0 m', area: 10,
    itens: { chapa: 5, guia: 4, montante: 12, banda: 2, parafuso: 2, massa: 1, fita: 1 },
    rodar: () => calcularRevestimentoEstruturado(REGRAS_REVESTIMENTO_ESTRUTURADO, { comprimento: 5, peDireito: 2.0 }) },
  { chave: 'revestimento_estruturado_2ch', rotulo: 'Revestimento estruturado (2 chapas)', entrada: '5,0 m × altura 2,0 m, 2 chapas', area: 10,
    itens: { chapa: 10, guia: 4, montante: 6, banda: 2, parafuso: 1, parafuso_ppa35: 2, massa: 1, fita: 1 },
    rodar: () => calcularRevestimentoEstruturado(REGRAS_REVESTIMENTO_ESTRUTURADO, { comprimento: 5, peDireito: 2.0, camadas: 2 }) },
]

export type FalhaValidacao = { caso: string; detalhe: string }

// Roda todos os casos e compara com o esperado. Devolve as falhas (vazio = tudo bate com a referência).
export function validarFormulas(): FalhaValidacao[] {
  const falhas: FalhaValidacao[] = []
  for (const c of CASOS_VALIDACAO) {
    const r = c.rodar()
    if (!r.ok) { falhas.push({ caso: c.chave, detalhe: `erro inesperado: ${r.erro}` }); continue }
    if (Math.abs(r.area - c.area) > 1e-9) falhas.push({ caso: c.chave, detalhe: `área ${r.area} ≠ esperado ${c.area}` })
    const obtido = Object.fromEntries(r.itens.map((i) => [i.chave, i.quantidade]))
    const chavesEsperadas = Object.keys(c.itens)
    for (const k of chavesEsperadas) {
      if (obtido[k] !== c.itens[k]) falhas.push({ caso: c.chave, detalhe: `item "${k}": ${obtido[k] ?? '—'} ≠ esperado ${c.itens[k]}` })
    }
    const extras = r.itens.map((i) => i.chave).filter((k) => !(k in c.itens))
    if (extras.length) falhas.push({ caso: c.chave, detalhe: `itens a mais não previstos na referência: ${extras.join(', ')}` })
  }
  return falhas
}

// Resumo para a tela: a suíte de referência está travada no gate do build, então aqui é sempre verdadeira em produção
// (o build não passa se divergir). Mantém a contagem para o rótulo "validado contra a referência · N casos".
export const RESUMO_VALIDACAO = { total: CASOS_VALIDACAO.length, norma: 'NBR 15758/14715' }
