/**
 * Gate de build (#340 · R.R): medição do escopo da obra pela NFS-e — a mesma regra do banco
 * (fn_nfse_obra_medicao_validar): soma dos itens = valor da nota (tolerância R$ 0,01), a mensagem diz quanto falta ou
 * sobra, e nenhum item passa do que falta medir. Decisão do CEO 29/09.
 *   tsx scripts/check-medicao-escopo-obra.ts
 */
import { conferirMedicaoEscopo } from '../../src/lib/fiscal/medicaoEscopoObra'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// exemplo do chamado: obra de R$ 10 milhões (20 pavimentos); medição de 2 pavimentos = R$ 2 milhões
const escopo = [
  { id: 'pav', descricao: 'Pavimento', preco_unitario: 500000, quantidade_a_medir: 20 },
  { id: 'mur', descricao: 'Muretas', preco_unitario: 100, quantidade_a_medir: 100 },
]
const a = conferirMedicaoEscopo(escopo, { pav: 4 }, 2000000)
ok(a.ok && a.soma === 2000000 && a.itens.length === 1, 'caso do chamado: 4 pavimentos × R$ 500 mil = nota de R$ 2 milhões → libera')
const falta = conferirMedicaoEscopo(escopo, { pav: 2 }, 1000500)
ok(!falta.ok && falta.erros[0].includes('faltam R$ 500,00'), 'soma menor que a nota → trava dizendo quanto FALTA')
const sobra = conferirMedicaoEscopo(escopo, { pav: 2, mur: 5 }, 1000000)
ok(!sobra.ok && sobra.erros[0].includes('sobram R$ 500,00'), 'soma maior que a nota → trava dizendo quanto SOBRA')
ok(conferirMedicaoEscopo(escopo, { mur: 3 }, 300.01).ok, 'diferença de R$ 0,01 → dentro da tolerância')
ok(!conferirMedicaoEscopo(escopo, { mur: 3 }, 300.02).ok, 'diferença de R$ 0,02 → trava')
const passa = conferirMedicaoEscopo(escopo, { pav: 21 }, 10500000)
ok(!passa.ok && passa.erros.some((e) => e.includes('passa do que falta medir')), 'item acima do que falta medir → trava')
ok(!conferirMedicaoEscopo(escopo, {}, 1000).ok && conferirMedicaoEscopo(escopo, {}, 1000).erros.length === 0, 'nenhum item marcado → não há medição (e nenhum erro de soma)')
ok(conferirMedicaoEscopo(escopo, { pav: 0, mur: 1 }, 100).itens.length === 1, 'quantidade zero não entra na medição')

if (falhas) { console.error(`\n[check-medicao-escopo-obra] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-medicao-escopo-obra] medição do escopo da obra conferida.')
