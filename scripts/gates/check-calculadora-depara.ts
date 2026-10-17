// Gate (Hub HB2 fatia 3): custo real da calculadora pelo de-para com o estoque; item sem vínculo avisa e fica fora do total.
import { calcularParede, REGRAS_PAREDE_SIMPLES_ST } from '../../src/lib/calculadora/motor'
import { custearItens, sugerirProduto } from '../../src/lib/calculadora/depara'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 })
if (!r.ok) ok(false, 'cálculo base')
else {
  const prods = new Map([['p1', { id: 'p1', nome: 'Chapa ST', unidade: 'pç', custo: 40 }], ['p2', { id: 'p2', nome: 'Guia', unidade: 'br', custo: 0 }]])
  const c = custearItens(r.itens, { chapa: 'p1', guia: 'p2', montante: 'p9' }, prods)
  ok(c.linhas.find(l => l.item.chave === 'chapa')!.total === 33 * 40, 'chapa: 33 × R$ 40 = R$ 1.320')
  ok(c.total === 1320, 'total soma só os itens com custo')
  ok(c.linhas.find(l => l.item.chave === 'guia')!.aviso === 'Produto sem custo cadastrado', 'custo zero avisa')
  ok(c.linhas.find(l => l.item.chave === 'montante')!.aviso !== null, 'vínculo órfão avisa')
  ok(c.semCusto === r.itens.length - 1, 'itens sem custo contados')
}
if (r.ok) {
  const chapa = r.itens.find(l => l.chave === 'chapa')!
  const lista = [{ id: 'a', nome: 'Parafuso', unidade: 'cx', custo: 10 }, { id: 'b', nome: 'Sem custo', unidade: 'pç', custo: 0 }]
  ok(sugerirProduto(chapa, lista) === null, 'sem palavra em comum: nenhuma sugestão')
  const prim = chapa.descricao.split(/\s+/).find(w => w.length >= 4) ?? 'chapa'
  const cand = [...lista, { id: 'c', nome: `${prim} 12,5`, unidade: 'pç', custo: 40 }]
  ok(sugerirProduto(chapa, cand)?.id === 'c', 'sugere pelo nome parecido com custo')
  ok(sugerirProduto(chapa, [{ id: 'z', nome: prim, unidade: 'pç', custo: 0 }]) === null, 'produto sem custo não é sugerido')
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
