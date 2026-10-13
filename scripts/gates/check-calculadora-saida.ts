// Gate (Hub HB2 fatia 4): saída da calculadora — itens do orçamento e lista de compra.
import { calcularParede, REGRAS_PAREDE_SIMPLES_ST } from '../../src/lib/calculadora/motor'
import { custearItens } from '../../src/lib/calculadora/depara'
import { itensParaOrcamento, listaDeCompra } from '../../src/lib/calculadora/saida'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 })
if (!r.ok) ok(false, 'cálculo base')
else {
  const prods = new Map([['p1', { id: 'p1', nome: 'Chapa ST 12,5', unidade: 'pç', custo: 40 }]])
  const c = custearItens(r.itens, { chapa: 'p1' }, prods)
  const it = itensParaOrcamento(c.linhas, 'o1', 'c1', 3)
  ok(it.length === r.itens.length, 'um item de orçamento por material (nenhum descartado)')
  const ch = it.find(x => x.produto_id === 'p1')!
  ok(ch.quantidade === 33 && ch.subtotal === 1320 && ch.preco_custo === 40, 'chapa: 33 × R$ 40 = R$ 1.320')
  ok(it[0].ordem === 4 && it.every(x => x.orcamento_id === 'o1' && x.company_id === 'c1'), 'ordem continua e empresa/orçamento preenchidos')
  const sem = it.find(x => x.produto_id === null)!
  ok(sem.preco_unitario === 0 && sem.subtotal === 0 && sem.produto_nome.length > 0, 'sem vínculo entra com preço 0 e descrição do material')
  ok(listaDeCompra(c.linhas, 'Parede').split('\n').length === r.itens.length + 1, 'lista de compra: título + uma linha por item')
  ok(listaDeCompra(c.linhas, 'Parede').includes('Chapa ST 12,5'), 'lista usa o nome do produto vinculado')
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
