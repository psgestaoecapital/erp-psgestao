// Gate (chamado #5620 Alliance): Perfil fiscal da revenda aceita "0,65" e "0.65" nos percentuais (vírgula → ponto antes de salvar)
// e reabre com vírgula. Roda no build. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/revenda/fiscal/page.tsx', 'utf8')
for (const k of ['pis_pct', 'cofins_pct', 'irpj_pct', 'irpj_presuncao_pct', 'csll_pct', 'csll_presuncao_pct', 'icms_saida_pct', 'icms_reducao_base_pct', 'encargos_pct', 'coaf_limite_especie'])
  ok(src.slice(src.indexOf('CAMPOS_NUM'), src.indexOf('function numParaBanco')).includes(`'${k}'`), `${k} é tratado como número pt-BR`)
const salvar = src.slice(src.indexOf('async function salvar'), src.indexOf('async function enviar'))
ok(salvar.includes('numParaBanco(f[k])') && salvar.indexOf('numParaBanco') < salvar.indexOf('fn_veic_perfil_fiscal_salvar'), 'salvar normaliza antes da RPC')
ok(salvar.includes('numParaBanco(x.reducao_base_icms_pct)'), 'redução de base por operação também é normalizada')
ok(src.includes('numParaTela(base[k])'), 'ao carregar, o valor reabre com vírgula')

if (falhas) process.exit(1)
