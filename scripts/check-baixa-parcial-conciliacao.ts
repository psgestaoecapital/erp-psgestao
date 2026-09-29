/**
 * Gate de build (#145 · André): "Vincular vários" com baixa PARCIAL por conta — o valor digitado não passa do saldo
 * do título, e o que sobra fica em aberto (título parcial).
 *   tsx scripts/check-baixa-parcial-conciliacao.ts
 */
import { conferirBaixaParcial, saldoTitulo } from '../src/lib/conciliacao/baixaParcial'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(saldoTitulo({ valor: 800, valor_pago: 0 }) === 800, 'saldo = valor quando nada foi pago')
ok(saldoTitulo({ valor: 1000, juros: 10, multa: 5, desconto: 15, valor_pago: 250 }) === 750, 'saldo = valor + juros + multa − desconto − pago')
const p = conferirBaixaParcial(800, 500)
ok(p.ok && p.parcial && p.restante === 300, 'baixa de R$ 500 num título de R$ 800 → parcial, restam R$ 300')
const q = conferirBaixaParcial(800, 800)
ok(q.ok && !q.parcial && q.restante === 0, 'valor cheio → quita o título')
ok(!conferirBaixaParcial(800, 800.02).ok, 'passar do saldo → recusa')
ok(conferirBaixaParcial(800, 800.01).ok, 'R$ 0,01 de arredondamento → aceita')
ok(!conferirBaixaParcial(800, 0).ok && !conferirBaixaParcial(800, -5).ok, 'zero ou negativo → recusa')

if (falhas) { console.error(`\n[check-baixa-parcial-conciliacao] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-baixa-parcial-conciliacao] baixa parcial na fatura agrupada conferida.')
