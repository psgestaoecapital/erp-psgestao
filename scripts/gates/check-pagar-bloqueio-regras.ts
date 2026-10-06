/**
 * Gate (#1672): regras puras do bloqueio de pagamento — título bloqueado fica fora da remessa e o aviso diz quantos.
 */
import { motivoValido, separarBloqueados, avisoBloqueadosFora } from '../../src/lib/financeiro/bloqueioPagamento'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(!motivoValido('') && !motivoValido('  ') && !motivoValido(null) && !motivoValido('ab'), 'motivo vazio/curto → recusa')
ok(motivoValido('Aguardando NF'), 'motivo preenchido → aceita')
const r = separarBloqueados([{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Set(['b']))
ok(r.livres.map((t) => t.id).join() === 'a,c' && r.fora === 1, 'remessa exclui o bloqueado e conta 1 de fora')
ok(separarBloqueados([{ id: 'a' }], new Set()).fora === 0, 'sem bloqueados → nada fora')
ok(avisoBloqueadosFora(0) === null, 'sem bloqueados → sem aviso')
ok(/2 contas bloqueadas ficaram/.test(avisoBloqueadosFora(2) ?? ''), 'aviso informa quantas ficaram de fora')

if (falhas) { console.error(`\n[check-pagar-bloqueio-regras] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-pagar-bloqueio-regras] regras do bloqueio conferidas.')
