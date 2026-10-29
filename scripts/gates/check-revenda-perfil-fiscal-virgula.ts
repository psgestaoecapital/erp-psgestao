// Gate (chamado #5620 Alliance): percentuais do Perfil fiscal da revenda aceitam vírgula (0,65) e a tela reabre com vírgula.
// A conversão vírgula→ponto é na tela, antes da RPC de salvar. Roda no build. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/revenda/fiscal/page.tsx', 'utf8')
for (const k of ['pis_pct', 'cofins_pct', 'irpj_pct', 'irpj_presuncao_pct', 'csll_pct', 'csll_presuncao_pct', 'icms_saida_pct', 'icms_reducao_base_pct', 'encargos_pct', 'coaf_limite_especie', 'reducao_base_icms_pct'])
  ok(src.slice(src.indexOf('const NUM_KEYS'), src.indexOf('const paraPonto')).includes(`'${k}'`), `${k} entra na conversão de vírgula`)
const salvar = src.slice(src.indexOf('async function salvar'), src.indexOf('async function enviar'))
ok(salvar.indexOf('normNum(f, paraPonto)') > -1 && salvar.indexOf('normNum(f, paraPonto)') < salvar.indexOf('fn_veic_perfil_fiscal_salvar'), 'dados passam por vírgula→ponto antes da RPC')
ok(salvar.includes('normNum(ops[o]'), 'operações também passam pela conversão')
ok(src.includes('paraVirgula) : {})'), 'ao reabrir, os percentuais voltam com vírgula')

if (falhas) process.exit(1)
