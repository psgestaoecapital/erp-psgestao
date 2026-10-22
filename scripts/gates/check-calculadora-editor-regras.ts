// Gate (Hub HB2): editor de regras da calculadora — todo campo editável tem texto de "?" na migration; valor inválido nunca é salvo.
import { readFileSync } from 'node:fs'
import { CAMPOS_REGRA, chaveAjudaRegra, montarRegras, lerCampo } from '../../src/lib/calculadora/campos-regras'
import { regrasReferencia, type SistemaCalc } from '../../src/lib/calculadora/regras-empresa'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const sql = ['20261014170005_calculadora_regras_ajuda', '20261014190205_calculadora_regras_ajuda_aramado', '20261014200005_calculadora_parede_la_ajuda', '20261015000005_calculadora_revestimento_colado', '20261017000005_calculadora_revestimento_estruturado', '20261017180005_calculadora_parede_separativa_corta_fogo']
  .map(n => readFileSync(`supabase/migrations/${n}.sql`, 'utf8')).join('\n')
for (const s of ['parede', 'forro_f530', 'forro_aramado', 'revestimento_colado', 'revestimento_estruturado', 'parede_separativa', 'parede_corta_fogo'] as SistemaCalc[]) {
  const ref = regrasReferencia(s)
  const vals: Record<string, string> = {}
  for (const c of CAMPOS_REGRA[s]) {
    ok(lerCampo(ref, c.caminho) !== undefined, `${s}: campo ${c.caminho} existe na referência`)
    ok(sql.includes(`'${chaveAjudaRegra(s, c.caminho)}'`) && /^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(chaveAjudaRegra(s, c.caminho)), `${s}: "?" de ${c.caminho} na migration`)
    vals[c.caminho] = String(lerCampo(ref, c.caminho))
  }
  const r = montarRegras(ref, vals, s)
  ok(r.ok && Object.keys(r.regras).length === 0, `${s}: sem mudança não grava nada além da referência`)
  const alt = montarRegras(ref, { ...vals, perda: '1,08' }, s)
  ok(alt.ok && (alt.regras as { perda?: number }).perda === 1.08, `${s}: vírgula decimal aceita`)
  ok(!montarRegras(ref, { ...vals, perda: '-1' }, s).ok && !montarRegras(ref, { ...vals, perda: '' }, s).ok && !montarRegras(ref, { ...vals, perda: '0' }, s).ok, `${s}: negativo, vazio e zero recusados`)
}
for (const k of ['validada', 'salvar', 'restaurar']) ok(sql.includes(`'projetos.calculadora.regra.${k}'`), `"?" de ${k} na migration`)
ok(!/\b(UPDATE|DELETE|DROP|CREATE OR REPLACE)\b/i.test(sql.replace(/CREATE OR REPLACE FUNCTION public\.fn_calc_regra_salvar[\s\S]*?GRANT EXECUTE[^;]*;/g, '').replace(/DROP CONSTRAINT/g, '')), 'migration só insere ajuda (fora a guarda de sistemas)')
if (falhas) process.exit(1)
