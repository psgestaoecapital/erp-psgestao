// Gate (Hub HB2, Parte O.3 item 9): a calculadora nunca trava em nenhum pé-direito (0,05 em 0,05 m) e a prova do CEO fecha.
import { calcular } from '../../src/lib/calculadora-obra/motor'
import { PAREDE_SIMPLES_ST_1CHAPA as R } from '../../src/lib/calculadora-obra/regras-referencia'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

let travou = ''
for (let i = 4; i <= 92; i++) { // 0,20 a 4,60 m
  const pd = Math.round(i * 5) / 100
  try { const r = calcular(R, { comprimento: 5, pe_direito: pd }); if (!r.itens.every((x) => x.quantidade_compra > 0)) travou += ` ${pd}` } catch { travou += ` ${pd}` }
}
ok(travou === '', `sem travar em nenhuma faixa de pé-direito 0,20–4,60${travou && ':' + travou}`)

// Prova da Tryo/DEMO: parede 12,5 × 2,8 m com porta 0,8 × 2,1 m
const r = calcular(R, { comprimento: 12.5, pe_direito: 2.8, vaos_m2: 0.8 * 2.1 })
const q = (k: string) => r.itens.find((x) => x.chave === k)!.quantidade_compra
ok(r.area_m2 === 33.32, `área líquida 33,32 m² (veio ${r.area_m2})`)
ok(r.faixa.bitola === 'M70' && r.faixa.espacamento === 0.6, 'faixa 2,8 m = M70 @600')
ok(q('chapa') === Math.ceil(Math.round(33.32 * 2 * 1.05 * 100) / 100 / 2.16), `chapas = ${q('chapa')} (⌈33,32×2×1,05÷2,16⌉ = 33)`)
ok(q('chapa') === 33, 'chapas = 33')
ok(q('guia') === 9, `guias = 9 barras (veio ${q('guia')})`)
ok(q('montante') === 21, `montantes = 21 barras (⌈(12,5÷0,6)×1,05×2,8÷3⌉; veio ${q('montante')})`)
ok(r.itens.every((x) => x.conta.length > 0), '"ver a conta" presente em todo item')
let erro = false
try { calcular(R, { comprimento: 0, pe_direito: 2.8 }) } catch { erro = true }
ok(erro, 'entrada inválida recusada com mensagem')
if (falhas) process.exit(1)
