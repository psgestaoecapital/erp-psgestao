// Gate · NFS-e 603 da Pdois (08/10): data_competencia ficou vazia em erp_nfse_emitidas porque
// fn_registrar_nfse_emitida não a grava. A rota de emissão preenche (dia de Brasília, só se vazia). Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const rota = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')

const reg = rota.indexOf("'fn_registrar_nfse_emitida'")
const upd = rota.search(/update\(\{ data_competencia: dataBrasil\(\) \}\)/)
ok(reg > 0 && upd > reg, 'rota: grava data_competencia (dataBrasil) logo depois de registrar a nota')
ok(/update\(\{ data_competencia: dataBrasil\(\) \}\)\s*\.eq\('id', registroId\)\s*\.is\('data_competencia', null\)/.test(rota),
  'rota: só preenche se estiver vazia (nunca sobrescreve)')

if (falhas) { console.error(`\ncheck-nfse-data-competencia: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfse-data-competencia: ok')
