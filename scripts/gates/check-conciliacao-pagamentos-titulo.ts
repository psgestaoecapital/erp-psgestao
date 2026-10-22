/**
 * Gate de build (#106 · Jordana · Gean): na conciliação, o título a receber PARCIAL mostra cada pagamento já
 * registrado separado do saldo em aberto, e o crédito é comparado com o pagamento certo (não com o valor cheio).
 *   npm run gates -- conciliacao-pagamentos-titulo
 */
import { readFileSync } from 'node:fs'
import { linhasDoTitulo, saldoAberto, valorReferencia, type BaixaTitulo } from '../../src/lib/conciliacao/baixasTitulo'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// caso do chamado: R$ 4.703 com R$ 2.255 já marcado pelo atendente, extrato traz + R$ 2.255
const titulo = { valor: 4703, valor_pago: 2255 }
const baixas: BaixaTitulo[] = [{ id: 'b1', valor: 2255, data: '2026-09-30', forma: 'pix', movimento_banco_id: null }]
const l = linhasDoTitulo(titulo, baixas)
ok(l.length === 2 && l[0].tipo === 'pago' && l[0].valor === 2255 && l[0].baixa_id === 'b1', 'pagamento registrado vira linha "pago" própria')
ok(l[1].tipo === 'aberto' && l[1].valor === 2448, 'saldo em aberto em linha separada (4.703 − 2.255 = 2.448)')
ok(valorReferencia(titulo, baixas, 2255) === 2255, 'crédito de R$ 2.255 compara com o pagamento, não com o valor cheio')
ok(valorReferencia(titulo, baixas, 2448) === 2448, 'crédito do restante compara com o saldo aberto')
ok(valorReferencia({ valor: 800, valor_pago: 0 }, [], 800) === 800, 'título sem pagamento segue pelo valor cheio')

// baixa já ligada a crédito = conciliada, não é candidata
const b2: BaixaTitulo[] = [
  { id: 'a', valor: 500, data: '2026-10-02', forma: null, movimento_banco_id: 'mov1' },
  { id: 'b', valor: 300, data: '2026-10-01', forma: null, movimento_banco_id: null },
]
const l2 = linhasDoTitulo({ valor: 1500, valor_pago: 800 }, b2)
ok(l2[0].baixa_id === 'b' && l2[1].tipo === 'conciliado', 'linhas em ordem de data; baixa com crédito = "conciliado"')
ok(valorReferencia({ valor: 1500, valor_pago: 800 }, b2, 500) === 300 || valorReferencia({ valor: 1500, valor_pago: 800 }, b2, 500) === 700, 'baixa já conciliada não serve de referência')
ok(linhasDoTitulo({ valor: 1000, valor_pago: 1000 }, [{ id: 'x', valor: 1000, data: null, forma: null, movimento_banco_id: null }]).every((x) => x.tipo !== 'aberto'), 'título quitado não mostra saldo')
ok(saldoAberto({ valor: 1000, juros: 10, desconto: 10, valor_pago: 250 }) === 750, 'saldo = valor + juros + multa − desconto − pago')

// a tela usa o componente e o valor de referência
const inbox = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
ok(/<PagamentosDoTitulo[\s\S]{0,200}receberId=\{sug\.lancamento_id\}/.test(inbox), 'inbox mostra os pagamentos sob cada sugestão de conta a receber')
ok(/valorReferencia\(t as TituloReceber/.test(inbox), '"Conciliar" da sugestão principal compara com o pagamento/saldo')
const comp = readFileSync('src/components/conciliacao/PagamentosDoTitulo.tsx', 'utf8')
ok(comp.includes('chave="conciliacao.pagamentos_titulo"'), 'ação nova tem o "?" (RD-95)')
ok(!/\.(insert|update|delete|upsert)\(/.test(comp), 'componente só lê (concilia pelo mesmo caminho do "Conciliar")')

if (falhas) { console.error(`\n[check-conciliacao-pagamentos-titulo] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-conciliacao-pagamentos-titulo] pagamentos do título parcial separados do saldo na conciliação.')
