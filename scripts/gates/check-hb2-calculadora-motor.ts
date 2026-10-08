// Gate HB2 — Calculadora de Obra PS, motor genérico: prova (RD-83 Tryo) e varredura de pé-direito de 0,05 em 0,05 m
// (nunca trava como o site da referência).
import { calcular, embalar } from '../../src/lib/hub/calculadora/motor'
import { PAREDE_SIMPLES, FORRO_F530 } from '../../src/lib/hub/calculadora/referencia'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const qtd = (r: ReturnType<typeof calcular>, k: string) => r.itens.find(i => i.chave === k)?.quantidade

// Parede 12,5 × 2,8 m com porta 0,8 × 2,1 m (Construtora Modelo - DEMO / Tryo)
const p = calcular(PAREDE_SIMPLES, { comprimento: 12.5, altura: 2.8, vaos: [{ largura: 0.8, altura: 2.1 }] })
ok(p.ok && p.area === 33.32, 'área = 35 − 1,68 = 33,32 m²')
ok(p.faixa?.bitola === 'M70' && p.faixa.espacamento === 600, 'pé-direito 2,8 → M70 @600')
ok(qtd(p, 'chapa') === 33, 'chapas = ⌈33,32 × 2 × 1,05 ÷ 2,16⌉ = 32,4→33')
ok(qtd(p, 'guia') === 9, 'guias = ⌈12,5 × 2 × 1,05 ÷ 3⌉ = 9')
ok(qtd(p, 'montante') === 21, 'montantes = ⌈(12,5 ÷ 0,6) × 2,8 × 1,05 ÷ 3⌉ = 20,4→21')
ok(qtd(p, 'parafuso_ppa25') === 8, 'parafusos 22 un/m² × 33,32 = 733 → 8 centos')
ok(qtd(p, 'la') === undefined, 'lã só entra quando ligada')
ok(qtd(calcular(PAREDE_SIMPLES, { comprimento: 12.5, altura: 2.8, opcoes: ['la', 'banda'] }), 'la') === 37, 'lã ligada = ⌈35 × 1,05⌉ = 37')
ok(p.itens.every(i => i.conta.length > 20), '"ver a conta" em todo item')

// Forro F530 4 × 5 m
const fo = calcular(FORRO_F530, { comprimento: 5, altura: 4 })
ok(fo.ok && fo.area === 20, 'forro 20 m²')
ok(qtd(fo, 'chapa') === 10, 'forro: ⌈20 × 1,05 ÷ 2,16⌉ = 10')
ok(qtd(fo, 'tabica') === 6, 'tabica pelo perímetro real: 18 m ÷ 3 = 6')
ok(qtd(fo, 'pendural') === 25, 'pendural 1,25 × 20 = 25')

// Erros claros, nunca exceção
ok(!calcular(PAREDE_SIMPLES, { comprimento: 0, altura: 2.8 }).ok, 'entrada zero → erro claro')
ok(!calcular(PAREDE_SIMPLES, { comprimento: 1, altura: 2.8, vaos: [{ largura: 2, altura: 2.8 }] }).ok, 'vão maior que a área → erro claro')
ok(embalar(2.01) === 3 && embalar(2.001) === 2, 'arredonda a 2 casas e depois para cima')

// Varredura 0,2 → 4,6 m, passo 0,05: nunca trava, sempre devolve bitola e itens
let travou: string[] = []
for (let pd = 0.2; pd <= 4.6001; pd += 0.05) {
  const h = Math.round(pd * 100) / 100
  const r = calcular(PAREDE_SIMPLES, { comprimento: 10, altura: h })
  if (!r.ok || !r.faixa || r.itens.length < 6 || r.itens.some(i => !(i.quantidade > 0))) travou.push(String(h))
}
ok(travou.length === 0, `varredura de pé-direito sem travar${travou.length ? ': ' + travou.join(', ') : ''}`)
// monotonia: mais alto nunca pede menos chapa
let mono = true, ant = 0
for (let pd = 0.2; pd <= 4.6001; pd += 0.05) { const q = qtd(calcular(PAREDE_SIMPLES, { comprimento: 10, altura: pd }), 'chapa') ?? 0; if (q < ant) mono = false; ant = q }
ok(mono, 'chapas crescem com o pé-direito')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
