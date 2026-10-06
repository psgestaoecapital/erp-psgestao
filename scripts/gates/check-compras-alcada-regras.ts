/**
 * Gate (#1677 A): regras puras da alçada de compras — 3 orçamentos por padrão (1 só se configurado), urgência só para
 * itens liberados, solicitante não aprova a própria compra.
 */
import { orcamentosExigidos, orcamentosSuficientes, urgenciaPermitida, podeAprovar, ALCADA_PADRAO } from '../../src/lib/compras/alcada'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(orcamentosExigidos(null) === 3 && orcamentosExigidos(ALCADA_PADRAO) === 3, 'padrão exige 3 orçamentos')
ok(orcamentosExigidos({ min_orcamentos: 1 }) === 1, 'empresa configurada exige 1')
ok(!orcamentosSuficientes(2, ALCADA_PADRAO) && orcamentosSuficientes(3, ALCADA_PADRAO) && orcamentosSuficientes(1, { min_orcamentos: 1 }), 'suficiência de orçamentos')
const cfg = { urgencia_categorias: ['Combustível'], urgencia_produto_ids: ['p1'] }
ok(urgenciaPermitida([{ produto_id: 'p1' }, { categoria: 'combustivel' }], cfg), 'urgência com todos os itens liberados (acento/caixa ignorados)')
ok(!urgenciaPermitida([{ produto_id: 'p1' }, { produto_id: 'p2', categoria: 'Obra' }], cfg), 'um item não liberado barra a urgência')
ok(!urgenciaPermitida([{ produto_id: 'p1' }], { urgencia_categorias: [], urgencia_produto_ids: [] }) && !urgenciaPermitida([], cfg) && !urgenciaPermitida([{ produto_id: 'p1' }], null), 'lista vazia/sem itens/sem config = nada liberado')
ok(!podeAprovar('u1', 'u1') && podeAprovar('u1', 'u2') && !podeAprovar('u1', null), 'solicitante não aprova a própria compra')

if (falhas) { console.error(`\n[check-compras-alcada-regras] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compras-alcada-regras] regras da alçada conferidas.')
