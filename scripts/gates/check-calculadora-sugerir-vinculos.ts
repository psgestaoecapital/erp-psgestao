// Gate (Hub, chamado #3340): sugestão de vínculo item × produto do estoque; só itens sem vínculo, nunca troca o existente.
import { calcularParede, REGRAS_PAREDE_SIMPLES_ST } from '../../src/lib/calculadora/motor'
import { sugerirVinculos } from '../../src/lib/calculadora/depara'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 })
if (!r.ok) ok(false, 'cálculo base')
else {
  const chapa = r.itens.find(i => i.chave === 'chapa')!
  const produtos = [
    { id: 'a', nome: chapa.descricao, unidade: 'pç', custo: 40 },
    { id: 'b', nome: 'Cimento CP II 50kg', unidade: 'sc', custo: 30 },
  ]
  const s = sugerirVinculos(r.itens, {}, produtos)
  ok(s['chapa'] === 'a', 'chapa sugere o produto de mesmo nome')
  ok(!Object.values(s).includes('b'), 'produto sem relação não é sugerido')
  ok(Object.keys(sugerirVinculos(r.itens, { chapa: 'zz' }, produtos)).every(k => k !== 'chapa'), 'vínculo existente nunca é trocado')
  ok(Object.keys(sugerirVinculos(r.itens, {}, [])).length === 0, 'sem produtos, sem sugestão')
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
