// Gate (Hub HB2, Parte O): motor da Calculadora de Obra nunca trava — varre o pé-direito de 0,20 a 4,60 m de 0,05 em 0,05
// (parede simples) e confere o caso do Eng. Chefe: parede 12,5 × 2,8 m com porta 0,8 × 2,1 m.
import { REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede } from '../../src/lib/calculadora/motor'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

let travou = 0
for (let i = 4; i <= 92; i++) {
  const pd = Math.round(i * 5) / 100
  const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 10, peDireito: pd })
  if (!r.ok || r.itens.some(x => !(x.quantidade > 0))) { travou++; console.error('  travou em', pd, r.ok ? '' : r.erro) }
}
ok(travou === 0, 'parede simples: nenhum pé-direito de 0,20 a 4,60 m (passo 0,05) trava')
ok(!calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 5, peDireito: 6 }).ok, 'pé-direito fora das faixas devolve erro claro, não exceção')

const p = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 0.8 * 2.1 })
if (!p.ok) ok(false, 'caso Tryo calcula')
else {
  const q = (k: string) => p.itens.find(i => i.chave === k)!.quantidade
  ok(p.area === 33.32, `área descontando a porta = 33,32 m² (veio ${p.area})`)
  ok(q('chapa') === 33, `chapas = ⌈33,32×2×1,05÷2,16⌉ = 33 (veio ${q('chapa')})`)
  ok(q('guia') === 9, `guias = ⌈12,5×2×1,05÷3⌉ = 9 (veio ${q('guia')})`)
  ok(q('montante') === 21, `montantes M70 @600 = ⌈(12,5÷0,6)×1,05×2,8÷3⌉ = 21 (veio ${q('montante')})`)
}
const forro = calcularForroF530(REGRAS_FORRO_F530, { largura: 3, comprimento: 4 })
ok(forro.ok && forro.itens.find(i => i.chave === 'chapa')!.quantidade === 6, 'forro F530 3×4 m: 12 m² → 6 chapas')
ok(forro.ok && forro.itens.find(i => i.chave === 'tabica')!.quantidade === 5, 'forro F530 3×4 m: tabica pelo perímetro real = 5 barras')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
