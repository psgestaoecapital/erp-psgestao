// Gate (#3862 complemento): a emissão da NFS-e grava valor_retencoes e valor_liquido na nota (mesma fórmula do banco,
// fn_nfse_retencoes_totalizar), para o título nascer pelo LÍQUIDO. Antes ficavam 0/NULL (NFS-e 422 da FC Pisos). Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')
ok(/fn_nfse_retencoes_totalizar/.test(src), 'a emissão usa a fórmula única do banco (fn_nfse_retencoes_totalizar)')
ok(/valor_retencoes:[^}]*valor_liquido:/.test(src), 'a emissão grava valor_retencoes e valor_liquido na nota')
ok(/p_iss_retido: issRetido > 0 \? issRetido : 0/.test(src), 'o ISS retido entra no total retido')
ok(/retTotalNota > 0 && resposta\.status !== 'rejeitada'/.test(src), 'só grava em nota com retenção e não rejeitada')

if (falhas) process.exit(1)
