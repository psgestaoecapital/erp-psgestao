// Gate (Hub HB2): regras da calculadora editáveis por empresa — mescla segura e migration com RLS/REVOKE anon.
import { readFileSync } from 'node:fs'
import { mesclarRegras } from '../../src/lib/calculadora/regras-empresa'
import { REGRAS_PAREDE_SIMPLES_ST, calcularParede } from '../../src/lib/calculadora/motor'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const m = mesclarRegras(REGRAS_PAREDE_SIMPLES_ST, { perda: 1.1, massaKgM2: -3, faixas: [], lixo: 1, tipo: 'x', parafusoPorM2: { '0.6': 20 } })
ok(m.perda === 1.1, 'perda da empresa sobrepõe a referência')
ok(m.massaKgM2 === REGRAS_PAREDE_SIMPLES_ST.massaKgM2, 'valor negativo é ignorado')
ok(m.faixas.length === REGRAS_PAREDE_SIMPLES_ST.faixas.length && m.tipo === 'parede', 'lista vazia e tipo não são aceitos')
ok(m.parafusoPorM2['0.6'] === 20 && m.parafusoPorM2['0.4'] === 25, 'objeto aninhado mescla campo a campo')
ok(mesclarRegras(REGRAS_PAREDE_SIMPLES_ST, null) === REGRAS_PAREDE_SIMPLES_ST, 'sem regra salva usa a referência')
ok(calcularParede(m, { comprimento: 12.5, peDireito: 2.8, vaos: 1.68 }).ok, 'motor calcula com a regra da empresa')
const sql = readFileSync('supabase/migrations/20261014150005_calculadora_regras_empresa.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL ON public\.erp_calc_regra FROM anon/.test(sql), 'migration: RLS ligada e REVOKE anon')
ok(/get_user_company_ids/.test(sql) && !/UPDATE\s+erp_(?!calc_regra)/i.test(sql), 'migration: guarda por empresa, sem tocar dado de cliente')
if (falhas) process.exit(1)
