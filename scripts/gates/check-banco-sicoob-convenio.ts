// Gate (chamado #3864 · Sicoob: código do beneficiário e convênio são campos distintos). Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const pg = readFileSync('src/app/dashboard/financeiro/conexoes-bancarias/page.tsx', 'utf8')
const sicoob = pg.match(/sigla: 'sicoob'[\s\S]*?campos: \[([^\]]*)\]/)?.[1] ?? ''
ok(sicoob.includes("'codigo_beneficiario'") && sicoob.includes("'convenio'"), 'Sicoob oferece os dois campos na tela')
ok(/label="Código do beneficiário" ajuda="banco\.codigo_beneficiario"/.test(pg), 'campo "Código do beneficiário" com "?" (RD-95)')
ok(!/label=\{banco\.sigla === 'sicoob' \? 'Convênio de cobrança'/.test(pg), 'rótulo "Convênio" não é mais colado no código do beneficiário')
ok(/p_codigo_beneficiario: cs\.includes\('codigo_beneficiario'\) \? \(codBenef/.test(pg) && /p_convenio: cs\.includes\('convenio'\) \? \(convenio/.test(pg), 'cada campo grava na sua coluna')

const mig = readFileSync('supabase/migrations/20261020193030_ajuda_banco_codigo_beneficiario.sql', 'utf8')
ok(/'banco\.codigo_beneficiario'/.test(mig) && /ON CONFLICT \(chave\) DO NOTHING/.test(mig), 'texto do "?" no banco, aditivo')

if (falhas) { console.error(`check-banco-sicoob-convenio: ${falhas} falha(s)`); process.exit(1) }
console.log('check-banco-sicoob-convenio: ok')
