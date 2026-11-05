/**
 * Gate (Alliance, PF sem razão social): na NF-e da venda de veículo, o destinatário pessoa física usa
 * nome_fantasia ("Nome / Apelido") quando razao_social é NULL; PJ continua exigindo razão social.
 */
import { readFileSync } from 'node:fs'

const src = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
const ramo = src.slice(src.indexOf('} else if (input.vendaVeiculo) {'), src.indexOf('} else if (input.manual) {'))
let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(/\.select\('razao_social, nome_fantasia,/.test(ramo), 'ramo vendaVeiculo lê nome_fantasia do cliente')
ok(/razaoSocial: cli\.razao_social \|\| \(docLimpo\.length === 11 \? \(cli\.nome_fantasia/.test(ramo), 'PF (CPF de 11 dígitos) cai no nome do cadastro; PJ não')
ok(/Razao social destinatario obrigatoria/.test(readFileSync('src/lib/fiscal/nfe-validator.ts', 'utf8')), 'validador segue exigindo nome (PJ sem razão social continua barrado)')
if (falhas) process.exit(1)
