// Gate (#3862 complemento · FC Pisos): a emissão grava na NOTA o total retido e o LÍQUIDO (ISS retido + federais),
// para o título nascer pelo líquido. Antes: valor_retencoes = 0 e valor_liquido = NULL (NFS-e 422). Sem rede.
import { readFileSync } from 'node:fs'
import { totalizarRetencoesNota } from '../../src/lib/fiscal/retencoesFederaisNfse'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// caso real: NFS-e 422 — serviço 98.165,70 · ISS retido 2.944,97 · INSS 10.798,23
const t = totalizarRetencoesNota(98165.70, { issRetido: 2944.97, inss: 10798.23 })
ok(t.valorRetencoes === 13743.2, `retenções somadas = 13.743,20 (veio ${t.valorRetencoes})`)
ok(t.valorLiquido === 84422.5, `líquido = 84.422,50 (veio ${t.valorLiquido})`)

const todas = totalizarRetencoesNota(1000, { issRetido: 30, inss: 110, irrf: 15, pis: 6.5, cofins: 30, csll: 10 }, 20, 50)
ok(todas.valorRetencoes === 201.5 && todas.valorLiquido === 728.5, 'todas as retenções + dedução + desconto')
ok(totalizarRetencoesNota(100, { inss: 500 }).valorLiquido === 0, 'líquido nunca fica negativo')
ok(totalizarRetencoesNota(100, {}).valorLiquido === 100, 'sem retenção, líquido = bruto')

const rota = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')
ok(/totalizarRetencoesNota\(/.test(rota) && /valor_liquido: tot\.valorLiquido/.test(rota), 'a rota de emissão grava valor_retencoes e valor_liquido')
ok(/\.eq\('financeiro_gerado', false\)/.test(rota), 'não mexe em nota que já gerou financeiro')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
