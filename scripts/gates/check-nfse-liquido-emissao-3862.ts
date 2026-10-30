// Gate (#3862 complemento): a emissão da NFS-e grava valor_retencoes e valor_liquido (ISS retido + federais) e o
// "Gerar financeiro" usa o ISS retido gravado na nota. Caso real: FC Pisos, NFS-e 422 (98.165,70 · ISS 2.944,97 · INSS 10.798,23). Sem rede.
import { readFileSync } from 'node:fs'
import { totaisLiquidosNfse } from '../../src/lib/fiscal/retencoesFederaisNfse'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const t = totaisLiquidosNfse(98165.7, { totalRetido: 10798.23 }, 2944.97)
ok(t.valorRetencoes === 13743.2 && t.valorLiquido === 84422.5, 'NFS-e 422: retenções 13.743,20 · líquido 84.422,50')
ok(totaisLiquidosNfse(1000, null, 0).valorLiquido === 1000, 'sem retenção, líquido = serviço')
ok(totaisLiquidosNfse(100, { totalRetido: 500 }, 0).valorLiquido === 0, 'líquido nunca negativo')

const emitir = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')
ok(/valor_retencoes: t\.valorRetencoes, valor_liquido: t\.valorLiquido/.test(emitir), 'emitir grava valor_retencoes e valor_liquido')
const fin = readFileSync('src/app/api/fiscal/nfse/gerar-financeiro/route.ts', 'utf8')
ok(/valor_iss_retido/.test(fin) && /iss: num\(body\.retencoes\?\.iss\) \|\| Number\(n\.valor_iss_retido/.test(fin), 'gerar-financeiro usa o ISS retido gravado na nota')

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
