/**
 * Gate (#3862): a emissão da NFS-e grava valor_retencoes e valor_liquido na nota (mesma função do "Gerar financeiro"),
 * para o título nascer pelo líquido. A NFS-e 422 da FC Pisos ficou com retenções 0 e líquido NULL.
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const rota = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')
const i = rota.indexOf("fn_nfse_retencoes_totalizar")
ok(i > 0, 'a emissão totaliza as retenções com fn_nfse_retencoes_totalizar')
const bloco = rota.slice(i, i + 1200)
ok(/valor_retencoes:\s*t\.retencoes_total/.test(bloco) && /valor_liquido:\s*t\.valor_liquido/.test(bloco), 'grava valor_retencoes e valor_liquido na nota')
ok(/p_iss_retido:\s*issRetido/.test(bloco) && /p_inss:\s*retencoesCalculadas\?\.valorCp/.test(bloco), 'ISS retido e INSS entram na conta')
ok(rota.slice(i - 400, i).includes("!== 'rejeitada'") || rota.slice(i - 600, i).includes("resposta.status !== 'rejeitada'"), 'nota rejeitada não grava líquido')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
