// Gate (Hub HB2, Parte O): motor da Calculadora de Obra nunca trava — varre o pé-direito de 0,20 a 4,60 m de 0,05 em 0,05
// (parede simples) e confere o caso do Eng. Chefe: parede 12,5 × 2,8 m com porta 0,8 × 2,1 m.
import { REGRAS_FORRO_ARAMADO, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroAramado, calcularRevestimentoColado, REGRAS_REVESTIMENTO_COLADO, calcularForroF530, calcularParede } from '../../src/lib/calculadora/motor'

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
const comLa = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 0.8 * 2.1, comLa: true })
ok(comLa.ok && comLa.itens.find(i => i.chave === 'la')?.quantidade === 5, 'parede com lã 33,32 m²: ⌈33,32×1,05÷7,2⌉ = 5 rolos')
ok(p.ok && !p.itens.some(i => i.chave === 'la'), 'parede sem lã não traz o item lã')
let travouLa = 0
for (let i = 4; i <= 92; i++) { const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 10, peDireito: Math.round(i * 5) / 100, comLa: true }); if (!r.ok || r.itens.some(x => !(x.quantidade > 0))) travouLa++ }
ok(travouLa === 0, 'parede com lã: nenhum pé-direito de 0,20 a 4,60 m trava')
const dupla = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 0.8 * 2.1, camadas: 2 })
ok(dupla.ok && dupla.itens.find(i => i.chave === 'chapa')?.quantidade === 65, 'parede com 2 camadas por face: ⌈33,32×4×1,05÷2,16⌉ = 65 chapas')
ok(dupla.ok && dupla.itens.find(i => i.chave === 'guia')?.quantidade === 9, 'parede dupla: guias não mudam')
let travouD = 0
for (let i = 4; i <= 92; i++) { const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 10, peDireito: Math.round(i * 5) / 100, camadas: 2, comLa: true }); if (!r.ok || r.itens.some(x => !(x.quantidade > 0))) travouD++ }
ok(travouD === 0, 'parede dupla: nenhum pé-direito de 0,20 a 4,60 m trava')
const sep = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 0.8 * 2.1, estruturaDupla: true })
const simp = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 12.5, peDireito: 2.8, vaos: 0.8 * 2.1 })
const qs = (r: typeof sep, k: string) => r.ok ? r.itens.find(i => i.chave === k)!.quantidade : -1
ok(qs(sep, 'guia') > qs(simp, 'guia') && qs(sep, 'montante') > qs(simp, 'montante') && qs(sep, 'banda') >= qs(simp, 'banda'), 'estrutura dupla: guias, montantes e banda aumentam')
ok(qs(sep, 'chapa') === qs(simp, 'chapa') && qs(sep, 'parafuso') === qs(simp, 'parafuso'), 'estrutura dupla: chapas e parafusos não mudam')
let travouE = 0
for (let i = 4; i <= 92; i++) { const r = calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: 10, peDireito: Math.round(i * 5) / 100, estruturaDupla: true, comLa: true }); if (!r.ok || r.itens.some(x => !(x.quantidade > 0))) travouE++ }
ok(travouE === 0, 'estrutura dupla: nenhum pé-direito de 0,20 a 4,60 m trava')
const forro = calcularForroF530(REGRAS_FORRO_F530, { largura: 3, comprimento: 4 })
ok(forro.ok && forro.itens.find(i => i.chave === 'chapa')!.quantidade === 6, 'forro F530 3×4 m: 12 m² → 6 chapas')
ok(forro.ok && forro.itens.find(i => i.chave === 'tabica')!.quantidade === 5, 'forro F530 3×4 m: tabica pelo perímetro real = 5 barras')
const ar = calcularForroAramado(REGRAS_FORRO_ARAMADO, { largura: 3, comprimento: 4 })
const qa = (k: string) => ar.ok ? ar.itens.find(i => i.chave === k)!.quantidade : -1
ok(ar.ok && qa('chapa') === 11, `forro aramado 3×4 m: ⌈12×1,05÷1,2⌉ = 11 chapas (veio ${qa('chapa')})`)
ok(qa('nervura') === 1, `forro aramado 3×4 m: nervura arredonda para CIMA, ⌈12×0,09÷1,2⌉ = 1 (veio ${qa('nervura')})`)
ok(qa('gesso_cola') === 3, `forro aramado 3×4 m: gesso cola ⌈12×1,25÷5⌉ = 3 sacos (veio ${qa('gesso_cola')})`)
ok(calcularForroAramado(REGRAS_FORRO_ARAMADO, { largura: 0, comprimento: 4 }).ok === false, 'forro aramado: medida zero devolve erro claro')
let travouA = 0
for (let l = 0.5; l <= 20; l += 0.5) for (const c of [0.6, 1, 2.5, 7.35, 12]) { const r = calcularForroAramado(REGRAS_FORRO_ARAMADO, { largura: l, comprimento: c }); if (!r.ok || r.itens.some(x => !(x.quantidade > 0))) travouA++ }
ok(travouA === 0, 'forro aramado: nenhuma medida de 0,5 a 20 m trava nem zera item')
const rc = calcularRevestimentoColado(REGRAS_REVESTIMENTO_COLADO, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 })
const qr = (k: string) => rc.ok ? rc.itens.find(i => i.chave === k)!.quantidade : -1
ok(rc.ok && rc.area === 33.32 && qr('chapa') === 17 && qr('gesso_cola') === 84, `revestimento colado 12,5×2,8 − 1,68 m²: 33,32 m² → 17 chapas e 84 sacos de gesso cola (veio ${qr('chapa')}/${qr('gesso_cola')})`)
ok(!calcularRevestimentoColado(REGRAS_REVESTIMENTO_COLADO, { comprimento: 1, peDireito: 1, vaos: 5 }).ok, 'revestimento colado: vão maior que a parede devolve erro claro')
let travouR = 0
for (let i = 4; i <= 92; i++) { const r = calcularRevestimentoColado(REGRAS_REVESTIMENTO_COLADO, { comprimento: 10, peDireito: Math.round(i * 5) / 100 }); if (!r.ok || r.itens.some(x => !(x.quantidade > 0))) travouR++ }
ok(travouR === 0, 'revestimento colado: nenhuma altura de 0,20 a 4,60 m trava')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
