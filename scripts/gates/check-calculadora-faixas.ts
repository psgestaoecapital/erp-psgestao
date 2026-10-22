// Gate (Hub HB2, Calculadora de Obra PS) — a calculadora nunca trava por pé-direito: 0,05 em 0,05 m, de 0,20 a 4,60 m,
// parede simples e forro F530 devolvem resultado (ou erro explicado fora das faixas), sem NaN, quantidades inteiras ≥ 1.
import {
  calcularForroF530, calcularParede, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, faixaDoPeDireito,
} from '../../src/lib/calculadora/motor'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// parede de referência do CEO: 12,5 × 2,8 m com porta 0,8 × 2,1 m
const ref = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 0.8 * 2.1 })
ok(ref.ok && ref.area === 33.32, `parede 12,5 × 2,8 com porta: área ${ref.ok ? ref.area : ref.erro} = 33,32 m²`)

let semFaixa = 0
for (let i = 4; i <= 92; i++) {
  const pd = Math.round(i * 5) / 100
  const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 10, peDireito: pd })
  const dentro = faixaDoPeDireito(REGRAS_PAREDE_SIMPLES_ST.faixas, pd) !== null
  if (!dentro) { semFaixa++; ok(!r.ok && r.erro.length > 0, `pé-direito ${pd}: fora das faixas → erro explicado`); continue }
  const bom = r.ok && r.itens.length === 7 && r.itens.every((x) =>
    Number.isFinite(x.quantidade) && Number.isInteger(x.quantidade) && x.quantidade >= 1 && x.conta.length > 0)
  if (!bom) ok(false, `pé-direito ${pd}: resultado inválido`)
}
ok(semFaixa < 10, `só os pés-direito realmente fora das faixas recusam (${semFaixa})`)
for (const pd of [2.5, 2.55, 2.7, 2.75, 3.0, 3.05, 4.05, 4.1, 4.6]) {
  ok(calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 5, peDireito: pd }).ok, `pé-direito ${pd} m calcula (fronteira de faixa)`)
}
const fo = calcularForroF530(REGRAS_FORRO_F530, { largura: 3, comprimento: 4 })
ok(fo.ok && fo.itens.length === 10 && fo.itens.every((x) => Number.isInteger(x.quantidade) && x.quantidade >= 1), 'forro F530 3 × 4: 10 itens inteiros')
ok(!calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 1, peDireito: 2.8, vaos: 5 }).ok, 'vão maior que a parede → erro explicado')

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
