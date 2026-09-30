/**
 * Gate de build (#287 · Gean): no retorno de remessa, o título que o banco não confirmou aparece com fornecedor, valor e
 * vencimento (antes só a descrição — e o Gean não conseguia saber qual era).
 *   tsx scripts/check-retorno-titulo.ts
 */
import { linhaTituloRetorno } from '../../src/lib/financeiro/retornoTitulo'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// caso real do chamado (retorno da remessa 65 da KGF, 25/09): código ZI, título da Sinuelo
const l = linhaTituloRetorno({ fornecedor: 'SINUELO AUTO PECAS', descricao: 'SINUELO AUTO PECAS', valor: 1984.22, vencimento: '2026-10-01', remessa: 65, ocorrencia: '000/ZI' })
ok(l.includes('SINUELO AUTO PECAS'), 'mostra o fornecedor')
ok(l.includes('R$ 1.984,22'), 'mostra o valor em reais')
ok(l.includes('vence 01/10/2026'), 'mostra o vencimento em dd/mm/aaaa')
ok(l.includes('remessa Nº 65') && l.includes('código do banco 000/ZI'), 'mostra a remessa e o código que o banco devolveu')
ok(linhaTituloRetorno({ descricao: 'Aluguel', valor: 10 }).startsWith('Aluguel · R$ 10,00'), 'sem fornecedor usa a descrição')
ok(linhaTituloRetorno({}).startsWith('Título sem fornecedor'), 'sem nada ainda diz que é um título (nunca linha vazia)')

if (falhas) { console.error(`\n[check-retorno-titulo] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-retorno-titulo] linha do título do retorno conferida.')
