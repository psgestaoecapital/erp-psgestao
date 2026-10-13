// Gate (Hub HB2 fatia 6): regras da calculadora editáveis por empresa — override só de coeficientes numéricos válidos.
import { calcularParede, REGRAS_PAREDE_SIMPLES_ST, REGRAS_FORRO_F530 } from '../../src/lib/calculadora/motor'
import { camposEditaveis, diferencas, mesclarRegras } from '../../src/lib/calculadora/regras'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ent = { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 }
ok(camposEditaveis(REGRAS_PAREDE_SIMPLES_ST).includes('perda') && !camposEditaveis(REGRAS_PAREDE_SIMPLES_ST).includes('faixas'), 'campos editáveis: números, sem faixas')
ok(camposEditaveis(REGRAS_FORRO_F530).includes('perfilF530MM2'), 'forro expõe seus coeficientes')
ok(mesclarRegras(REGRAS_PAREDE_SIMPLES_ST, null).perda === 1.05, 'sem override = referência')
const m = mesclarRegras(REGRAS_PAREDE_SIMPLES_ST, { perda: 1.1, faixas: 'x', tipo: 'y', inexistente: 3, massaKgM2: -1, baldeKg: 'abc' })
ok(m.perda === 1.1 && m.massaKgM2 === 0.94 && m.baldeKg === 22 && m.tipo === 'parede' && Array.isArray(m.faixas), 'override inválido/desconhecido é ignorado')
const a = calcularParede(REGRAS_PAREDE_SIMPLES_ST, ent), b = calcularParede(m, ent)
ok(a.ok && b.ok && b.itens.find(i => i.chave === 'chapa')!.quantidade >= a.itens.find(i => i.chave === 'chapa')!.quantidade, 'perda maior não reduz a chapa')
const d = diferencas(REGRAS_PAREDE_SIMPLES_ST, { perda: 1.05, massaKgM2: 1, faixas: 3 as never })
ok(Object.keys(d).length === 1 && d.massaKgM2 === 1, 'só o que difere da referência é gravado')
// nunca travar: pé-direito de 0,05 em 0,05 com override extremo
let travou = false
for (let pd = 0.2; pd <= 4.6001; pd += 0.05) { try { calcularParede(mesclarRegras(REGRAS_PAREDE_SIMPLES_ST, { perda: 9, areaChapa: 0.01 }), { ...ent, peDireito: Math.round(pd * 100) / 100 }) } catch { travou = true } }
ok(!travou, 'override extremo nunca lança exceção')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
